import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db/client";
import { SYNC_CONFLICT_STATUSES, deviceRegistrations, sites, syncCommands, syncConflicts, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthContext, buildContextForUser } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { createAdjustment } from "@/modules/inventory";
import { openDeviation } from "@/modules/quality";
import { OFFLINE_COMMANDS, isOfflineCommandType } from "../protocol";
import { runResolutionCommand } from "./replay";

/**
 * Conflict review queue (US-7-05, docs/offline-sync.md §5, data-model §11.3). Reviewers hold
 * `platform.sync_conflict.view` at the site; the person who queued a command always sees their own
 * conflicts (self-service). Resolving needs `platform.sync_conflict.approve` at the site, a note,
 * and is refused to the originating person, except a discard when
 * `offline.allow_self_resolve_discard` is on (A-DM-11). Every resolution writes
 * `platform.sync_conflict.resolved`; the original command is never applied silently.
 */
export type ConflictStatus = (typeof SYNC_CONFLICT_STATUSES)[number];
const queuer = alias(users, "queuer");
const resolver = alias(users, "resolver");

function viewableSiteIds(ctx: AuthContext) {
  return ctx.allowedSiteIds.filter((s) => ctx.canAt("platform.sync_conflict.view", s));
}

const listColumns = {
  id: syncConflicts.id,
  siteId: syncConflicts.siteId,
  siteCode: sites.code,
  commandType: syncConflicts.commandType,
  reasonCode: syncConflicts.reasonCode,
  reasonMessage: syncConflicts.reasonMessage,
  status: syncConflicts.status,
  relatedEntityType: syncConflicts.relatedEntityType,
  relatedEntityNumber: syncConflicts.relatedEntityNumber,
  createdAt: syncConflicts.createdAt,
  resolvedAt: syncConflicts.resolvedAt,
  userId: syncConflicts.userId,
  userName: queuer.displayName,
  deviceLabel: deviceRegistrations.label,
  clientCreatedAt: syncCommands.clientCreatedAt,
};

/** The site queue for reviewers (open first by default). */
export async function listConflicts(ctx: AuthContext, f: { status?: string | null } = {}) {
  ctx.require("platform.sync_conflict.view");
  const siteIds = viewableSiteIds(ctx);
  if (!siteIds.length) return [];
  const conds = [eq(syncConflicts.organizationId, ctx.organizationId), inArray(syncConflicts.siteId, siteIds)];
  if (f.status === "resolved") conds.push(sql`${syncConflicts.status} <> 'open'`);
  else if (f.status !== "all") conds.push(eq(syncConflicts.status, "open"));
  return db
    .select(listColumns)
    .from(syncConflicts)
    .innerJoin(sites, eq(sites.id, syncConflicts.siteId))
    .innerJoin(queuer, eq(queuer.id, syncConflicts.userId))
    .innerJoin(syncCommands, eq(syncCommands.id, syncConflicts.syncCommandId))
    .leftJoin(deviceRegistrations, eq(deviceRegistrations.id, syncConflicts.deviceRegistrationId))
    .where(and(...conds))
    .orderBy(desc(syncConflicts.createdAt))
    .limit(300);
}

/** The signed-in person's own conflicts (self-service, no permission needed). */
export async function listMyConflicts(ctx: AuthContext, f: { openOnly?: boolean } = {}) {
  const conds = [eq(syncConflicts.organizationId, ctx.organizationId), eq(syncConflicts.userId, ctx.userId)];
  if (f.openOnly) conds.push(eq(syncConflicts.status, "open"));
  return db
    .select(listColumns)
    .from(syncConflicts)
    .innerJoin(sites, eq(sites.id, syncConflicts.siteId))
    .innerJoin(queuer, eq(queuer.id, syncConflicts.userId))
    .innerJoin(syncCommands, eq(syncCommands.id, syncConflicts.syncCommandId))
    .leftJoin(deviceRegistrations, eq(deviceRegistrations.id, syncConflicts.deviceRegistrationId))
    .where(and(...conds))
    .orderBy(desc(syncConflicts.createdAt))
    .limit(100);
}

/** Open conflicts per site for the action centre and diagnostics (reviewer scope). */
export async function openConflictCount(ctx: AuthContext): Promise<number> {
  const siteIds = viewableSiteIds(ctx);
  const conds = [eq(syncConflicts.organizationId, ctx.organizationId), eq(syncConflicts.status, "open")];
  const scope = siteIds.length ? or(inArray(syncConflicts.siteId, siteIds), eq(syncConflicts.userId, ctx.userId)) : eq(syncConflicts.userId, ctx.userId);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(syncConflicts).where(and(...conds, scope!));
  return r?.n ?? 0;
}

const isUuid = (v: string) => z.uuid().safeParse(v).success;

export async function getConflict(ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Conflict not found in your sites.");
  const [r] = await db
    .select({ c: syncConflicts, cmd: syncCommands, siteCode: sites.code, userName: queuer.displayName, resolvedByName: resolver.displayName, deviceLabel: deviceRegistrations.label })
    .from(syncConflicts)
    .innerJoin(syncCommands, eq(syncCommands.id, syncConflicts.syncCommandId))
    .innerJoin(sites, eq(sites.id, syncConflicts.siteId))
    .innerJoin(queuer, eq(queuer.id, syncConflicts.userId))
    .leftJoin(resolver, eq(resolver.id, syncConflicts.resolvedBy))
    .leftJoin(deviceRegistrations, eq(deviceRegistrations.id, syncConflicts.deviceRegistrationId))
    .where(eq(syncConflicts.id, id))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Conflict not found in your sites.");
  const own = r.c.userId === ctx.userId;
  if (r.c.organizationId !== ctx.organizationId || (!own && !(ctx.allowedSiteIds.includes(r.c.siteId) && ctx.canAt("platform.sync_conflict.view", r.c.siteId)))) {
    throw new DomainError("not_found", "Conflict not found in your sites.");
  }
  const [resolution] = r.c.resolutionCommandId ? await db.select().from(syncCommands).where(eq(syncCommands.id, r.c.resolutionCommandId)).limit(1) : [];
  const attempts = await db
    .select({ id: syncCommands.id, status: syncCommands.status, errorMessage: syncCommands.errorMessage, receivedAt: syncCommands.receivedAt, payload: syncCommands.payload })
    .from(syncCommands)
    .where(eq(syncCommands.resolutionOfConflictId, r.c.id))
    .orderBy(desc(syncCommands.receivedAt));
  const selfResolveDiscard = await getSetting(db, ctx.organizationId, "offline.allow_self_resolve_discard");
  const canApprove = ctx.allowedSiteIds.includes(r.c.siteId) && ctx.canAt("platform.sync_conflict.approve", r.c.siteId);
  return {
    ...r.c,
    command: r.cmd,
    siteCode: r.siteCode,
    userName: r.userName,
    resolvedByName: r.resolvedByName,
    deviceLabel: r.deviceLabel,
    resolution: resolution ?? null,
    attempts,
    canResolve: r.c.status === "open" && canApprove && !own,
    canDiscardOwn: r.c.status === "open" && own && selfResolveDiscard,
    isOwn: own,
  };
}

export type ConflictDetail = Awaited<ReturnType<typeof getConflict>>;

export type ResolveInput =
  | { conflictId: string; action: "discard"; note: string }
  | { conflictId: string; action: "reapply"; note: string; overrides?: Record<string, string> }
  | { conflictId: string; action: "escalate_deviation"; note: string }
  | { conflictId: string; action: "escalate_adjustment"; note: string; direction: "increase" | "decrease"; qty: string; reasonCode: string };

/**
 * Resolves an open conflict one of four ways. Re-apply runs a NEW command as the person who queued
 * it, with their CURRENT permissions (system actor `sync.reapply` on behalf of the reviewer); a
 * failure leaves the conflict open and is returned as `{ ok: false }`.
 */
export async function resolveConflict(ctx: AuthContext, input: ResolveInput): Promise<{ ok: true; status: ConflictStatus; message: string } | { ok: false; message: string }> {
  ctx.assertWritable();
  const note = input.note?.trim() ?? "";
  if (note.length < 5) throw new DomainError("validation", "Write a resolution note (at least 5 characters).", { field: "note" });
  if (!isUuid(input.conflictId)) throw new DomainError("not_found", "Conflict not found in your sites.");
  const [c0] = await db.select().from(syncConflicts).where(eq(syncConflicts.id, input.conflictId)).limit(1);
  const own = c0?.userId === ctx.userId;
  if (!c0 || c0.organizationId !== ctx.organizationId || (!own && !ctx.allowedSiteIds.includes(c0.siteId))) throw new DomainError("not_found", "Conflict not found in your sites.");
  if (own) {
    const selfDiscard = await getSetting(db, ctx.organizationId, "offline.allow_self_resolve_discard");
    if (!(input.action === "discard" && selfDiscard)) throw new DomainError("separation_of_duties", "Someone other than the person who queued this change must resolve it.");
  } else {
    ctx.requireAt("platform.sync_conflict.approve", c0.siteId);
  }
  if (c0.status !== "open") throw new DomainError("state", "This conflict is already resolved.");
  const [original] = await db.select().from(syncCommands).where(eq(syncCommands.id, c0.syncCommandId)).limit(1);

  if (input.action === "reapply") {
    if (!isOfflineCommandType(original.commandType)) throw new DomainError("validation", "This command type cannot run from the sync queue; discard it and do the work online.");
    const base = (original.payload ?? {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = { ...base };
    let amended = false;
    for (const [k, v] of Object.entries(input.overrides ?? {})) {
      if (!(k in base) || typeof base[k] !== "string") continue;
      const nv = v.trim();
      if (nv !== base[k]) {
        payload[k] = nv;
        amended = true;
      }
    }
    const check = OFFLINE_COMMANDS[original.commandType].payload.safeParse(payload);
    if (!check.success) throw new DomainError("validation", check.error.issues[0]?.message ?? "Check the corrected values.");
    const runAs = await buildContextForUser(original.userId, original.siteId, { actor: { kind: "system", code: "sync.reapply", onBehalfOf: ctx.userId }, correlationId: ctx.correlationId });
    if (!runAs) return { ok: false, message: "The person who queued this change is no longer active or has no site; re-apply is not possible. Discard or escalate it." };
    const { commandId, outcome } = await runResolutionCommand(runAs, { original, payload, createdBy: ctx.userId, conflictId: c0.id, sessionId: ctx.sessionId, requestId: ctx.correlationId ?? undefined });
    if (outcome.status !== "applied") {
      await audit(db, ctx, {
        action: "platform.sync_conflict.reapply_failed",
        entityType: "sync_conflict",
        entityId: c0.id,
        entityNumber: c0.relatedEntityNumber,
        siteId: c0.siteId,
        reason: note,
        after: { originalCommandId: original.id, resolutionCommandId: commandId, error: outcome.errorMessage, reason: outcome.reason ?? null },
      });
      return { ok: false, message: `Re-apply was not accepted: ${outcome.errorMessage ?? "unknown reason"} The conflict stays open.` };
    }
    const status: ConflictStatus = amended ? "resolved_amended" : "resolved_applied";
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(syncConflicts).where(eq(syncConflicts.id, c0.id)).for("update").limit(1);
      if (locked.status !== "open") throw new DomainError("state", "This conflict was resolved meanwhile.");
      const now = new Date();
      await tx.update(syncConflicts).set({ status, resolvedBy: ctx.userId, resolvedAt: now, resolutionNote: note, resolutionCommandId: commandId, updatedAt: now }).where(eq(syncConflicts.id, c0.id));
      await tx.update(syncCommands).set({ status: "superseded" }).where(and(eq(syncCommands.id, original.id), inArray(syncCommands.status, ["rejected", "conflict"])));
      await audit(tx, ctx, {
        action: "platform.sync_conflict.resolved",
        entityType: "sync_conflict",
        entityId: c0.id,
        entityNumber: c0.relatedEntityNumber,
        siteId: c0.siteId,
        reason: note,
        before: { status: "open", payload: base },
        after: { status, choice: amended ? "reapply_amended" : "reapply", originalCommandId: original.id, resolutionCommandId: commandId, payload },
      });
    });
    return { ok: true, status, message: amended ? "Re-applied with the corrected values as a new change." : "Re-applied as a new change." };
  }

  let escalated: { type: "deviation" | "stock_adjustment"; id: string; number: string } | null = null;
  if (input.action === "escalate_deviation") {
    const state = (c0.serverState ?? {}) as Record<string, unknown>;
    const p = (original.payload ?? {}) as Record<string, unknown>;
    if (typeof state.deviationId === "string") {
      escalated = { type: "deviation", id: state.deviationId, number: String(state.deviationNumber ?? "") };
    } else {
      const batchId = c0.relatedEntityType === "batch" ? c0.relatedEntityId : typeof p.batchId === "string" ? p.batchId : null;
      const lotId = c0.relatedEntityType === "inventory_lot" ? c0.relatedEntityId : typeof p.lotId === "string" ? p.lotId : null;
      if (!batchId && !lotId) throw new DomainError("validation", "This change names no batch or lot; escalate it to a stock adjustment or discard it.");
      const d = await openDeviation(siteCtx(ctx, c0.siteId), {
        batchId,
        lotId,
        source: "other",
        stepRef: "Offline sync conflict",
        description: `Sync conflict (${c0.reasonCode}): ${c0.reasonMessage} Reviewer note: ${note}`,
        idempotencyKey: `sync-conflict:${c0.id}`,
      });
      escalated = { type: "deviation", id: d.deviationId, number: d.deviationNumber };
    }
  } else if (input.action === "escalate_adjustment") {
    const p = (original.payload ?? {}) as Record<string, unknown>;
    const lotId = typeof p.lotId === "string" ? p.lotId : null;
    const locationId = typeof p.locationId === "string" ? p.locationId : typeof p.fromLocationId === "string" ? p.fromLocationId : null;
    if (!lotId || !locationId) throw new DomainError("validation", "This change names no lot and location; escalate it to a deviation or discard it.");
    const a = await createAdjustment(siteCtx(ctx, c0.siteId), {
      reasonCode: input.reasonCode,
      reasonNote: `Sync conflict review: ${note}`,
      lines: [{ lotId, locationId, direction: input.direction, qty: input.qty, note: `From offline change ${original.id}` }],
      idempotencyKey: `sync-conflict:${c0.id}`,
    });
    escalated = { type: "stock_adjustment", id: a.id, number: a.adjustmentNumber };
  } else if (input.action !== "discard") {
    throw new DomainError("validation", "Choose how to resolve the conflict.");
  }

  const status: ConflictStatus = escalated ? "escalated" : "resolved_discarded";
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(syncConflicts).where(eq(syncConflicts.id, c0.id)).for("update").limit(1);
    if (locked.status !== "open") throw new DomainError("state", "This conflict was resolved meanwhile.");
    const now = new Date();
    await tx
      .update(syncConflicts)
      .set({ status, resolvedBy: ctx.userId, resolvedAt: now, resolutionNote: note, escalatedEntityType: escalated?.type ?? null, escalatedEntityId: escalated?.id ?? null, updatedAt: now })
      .where(eq(syncConflicts.id, c0.id));
    await audit(tx, ctx, {
      action: "platform.sync_conflict.resolved",
      entityType: "sync_conflict",
      entityId: c0.id,
      entityNumber: c0.relatedEntityNumber,
      siteId: c0.siteId,
      reason: note,
      before: { status: "open" },
      after: { status, choice: input.action, originalCommandId: original.id, escalated },
    });
  });
  return {
    ok: true,
    status,
    message: escalated ? `Escalated to ${escalated.type === "deviation" ? "deviation" : "stock adjustment"} ${escalated.number}.` : "Discarded. The device's version was not applied; the server's stays.",
  };
}

function siteCtx(ctx: AuthContext, siteId: string): AuthContext {
  return new AuthContext(ctx.userId, ctx.organizationId, ctx.displayName, ctx.email, ctx.roleCodes, ctx.permissions, ctx.allowedSites, siteId, ctx.options);
}

/** Device-side discards (logout warning, "Remove from queue"): never sent, so only the audit records them. */
const DiscardSchema = z
  .object({
    reason: z.enum(["signed_out", "removed_from_queue", "device_reset"]),
    commands: z
      .array(
        z
          .object({
            id: z.uuid(),
            type: z.string().max(100),
            siteId: z.uuid(),
            clientCreatedAt: z.iso.datetime({ offset: true }),
            summary: z.string().max(300).optional(),
            status: z.string().max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export async function recordDiscardedCommands(ctx: AuthContext, input: unknown) {
  const p = DiscardSchema.safeParse(input);
  if (!p.success) throw new DomainError("validation", "The discard list is malformed.");
  const orgSites = new Set((await db.select({ id: sites.id }).from(sites).where(eq(sites.organizationId, ctx.organizationId))).map((s) => s.id));
  await db.transaction(async (tx) => {
    for (const c of p.data.commands) {
      await audit(tx, ctx, {
        action: "platform.sync_command.discarded",
        entityType: "sync_command",
        entityId: c.id,
        entityNumber: c.type,
        siteId: orgSites.has(c.siteId) ? c.siteId : null,
        reason: p.data.reason,
        after: { commandType: c.type, clientCreatedAt: c.clientCreatedAt, summary: c.summary ?? null, deviceStatus: c.status ?? null, neverSent: true },
      });
    }
  });
  return { discarded: p.data.commands.length };
}

/** Diagnostics Sync card (FR-platform-09 Phase 7 part): counts only, no payloads, no secrets. */
export async function syncDiagnostics(ctx: AuthContext) {
  ctx.require("platform.diagnostics.view");
  const org = ctx.organizationId;
  const siteIds = ctx.allowedSiteIds;
  const [cmd] = await db
    .select({
      backlog: sql<number>`count(*) filter (where ${syncCommands.status} = 'received')::int`,
      stuck: sql<number>`count(*) filter (where ${syncCommands.status} = 'received' and ${syncCommands.receivedAt} < now() - interval '5 minutes')::int`,
      applied24h: sql<number>`count(*) filter (where ${syncCommands.status} = 'applied' and ${syncCommands.receivedAt} > now() - interval '24 hours')::int`,
      refused24h: sql<number>`count(*) filter (where ${syncCommands.status} in ('rejected','conflict') and ${syncCommands.receivedAt} > now() - interval '24 hours')::int`,
      skewFlagged24h: sql<number>`count(*) filter (where ${syncCommands.isClockSkewFlagged} and ${syncCommands.receivedAt} > now() - interval '24 hours')::int`,
    })
    .from(syncCommands)
    .where(and(eq(syncCommands.organizationId, org), inArray(syncCommands.siteId, siteIds)));
  const [conf] = await db
    .select({ open: sql<number>`count(*) filter (where ${syncConflicts.status} = 'open')::int`, oldestOpen: sql<string | null>`min(${syncConflicts.createdAt}) filter (where ${syncConflicts.status} = 'open')` })
    .from(syncConflicts)
    .where(and(eq(syncConflicts.organizationId, org), inArray(syncConflicts.siteId, siteIds)));
  const [dev] = await db
    .select({
      active: sql<number>`count(*) filter (where ${deviceRegistrations.status} = 'active')::int`,
      pending: sql<number>`count(*) filter (where ${deviceRegistrations.status} = 'pending')::int`,
      suspended: sql<number>`count(*) filter (where ${deviceRegistrations.status} = 'suspended')::int`,
      stale: sql<number>`count(*) filter (where ${deviceRegistrations.status} = 'active' and (${deviceRegistrations.lastSyncAt} is null or ${deviceRegistrations.lastSyncAt} < now() - interval '24 hours'))::int`,
      maxSkew: sql<number>`coalesce(max(${deviceRegistrations.maxClockSkewSeenSeconds}), 0)::int`,
    })
    .from(deviceRegistrations)
    .where(and(eq(deviceRegistrations.organizationId, org), inArray(deviceRegistrations.siteId, siteIds)));
  return {
    backlog: cmd?.backlog ?? 0,
    stuck: cmd?.stuck ?? 0,
    applied24h: cmd?.applied24h ?? 0,
    refused24h: cmd?.refused24h ?? 0,
    skewFlagged24h: cmd?.skewFlagged24h ?? 0,
    openConflicts: conf?.open ?? 0,
    oldestOpenConflictAt: conf?.oldestOpen ? new Date(conf.oldestOpen) : null,
    devices: { active: dev?.active ?? 0, pending: dev?.pending ?? 0, suspended: dev?.suspended ?? 0, stale: dev?.stale ?? 0, maxClockSkewSeconds: dev?.maxSkew ?? 0 },
  };
}
