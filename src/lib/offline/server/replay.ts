import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { sessions, sites, syncCommands, syncConflicts, users } from "@/db/schema";
import { type ApiError, type ApiResult, errorResult, executeCommand } from "@/lib/api/server";
import { audit } from "@/lib/audit";
import { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { OFFLINE_COMMANDS, SyncBatchWire, isOfflineCommandType, type OfflineCommandType, type SyncCommandWire, type SyncConflictReason, type SyncItemResult } from "../protocol";
import { OFFLINE_HANDLERS, type RelatedRecord } from "./commands";
import { type DeviceRow, effectiveWorkflows, findDeviceByKey, touchDevice } from "./devices";
import { buildAuthSnapshot, offlinePolicy } from "./snapshot";

/**
 * `POST /api/v1/sync/commands` (US-7-02, US-7-03; docs/offline-sync.md §4, data-model §11.5).
 *
 * For each command, in `clientSequence` order:
 *  0. record it (`sync_commands`, status `received`) in its own statement, or answer a resend from the stored row;
 *  1. dependency: a command whose `dependsOn` was not applied is `conflict: dependency_failed`;
 *  2. authorization snapshot: same person as the session, snapshot not older than
 *     `offline.auth_snapshot_max_age_hours` when the work was captured, queue age within
 *     `offline.max_queue_age_hours`, the snapshot's session neither revoked nor past its absolute expiry;
 *  3. device and site policy: workflow allowed at the site and granted to the (active) device;
 *  4. re-authorization with the CURRENT context: site in scope, permission at the site (else `PERMISSIONS_CHANGED`);
 *  5. the ordinary command pipeline (`executeCommand`: idempotency key, validation, the module service, audit);
 *  6. outcome on the row; a `sync_conflicts` row for every rejection or conflict; audit
 *     `platform.sync_command.replay_accepted` / `replay_rejected`.
 * Transient server problems (read-only window, a concurrent duplicate) answer `retry` and leave the
 * row `received`, so the device resends the same command later. Nothing is ever applied silently
 * under another person's identity or an expired authorization.
 */

type Outcome = {
  status: "applied" | "rejected" | "conflict" | "retry";
  reason?: SyncConflictReason;
  errorCode?: string | null;
  errorMessage?: string | null;
  serverResult?: unknown;
  applied?: { type: string; id: string | null; number: string | null } | null;
  related?: RelatedRecord;
  extraState?: Record<string, unknown> | null;
  permissionsChanged?: boolean;
};

const CONFLICT_REASONS: readonly SyncConflictReason[] = ["state_changed", "stock_not_eligible", "insufficient_stock", "out_of_tolerance", "wrong_lot", "dependency_failed", "count_closed"];
const REASON_BY_CODE: Record<string, SyncConflictReason> = {
  VALIDATION: "validation_failed",
  PERMISSION_DENIED: "permission_denied",
  NOT_FOUND: "validation_failed",
  INVALID_STATE: "state_changed",
  CONFLICT: "state_changed",
  STOCK_NOT_ELIGIBLE: "stock_not_eligible",
  STOCK_INSUFFICIENT: "insufficient_stock",
  OUT_OF_TOLERANCE: "out_of_tolerance",
  SEPARATION_OF_DUTIES: "validation_failed",
  IDEMPOTENCY_KEY_REUSED: "duplicate_key_mismatch",
  REAUTH_REQUIRED: "session_revoked",
  UNAUTHENTICATED: "session_revoked",
};
const TRANSIENT_CODES = new Set(["READ_ONLY_MODE", "INTERNAL", "IDEMPOTENCY_IN_PROGRESS", "RATE_LIMITED", "SETUP_REQUIRED"]);

const refuse = (reason: SyncConflictReason, errorCode: string, errorMessage: string, extra: Partial<Outcome> = {}): Outcome => ({
  status: CONFLICT_REASONS.includes(reason) ? "conflict" : "rejected",
  reason,
  errorCode,
  errorMessage,
  ...extra,
});

/** Maps a command pipeline answer to an outcome (rejected for validation, scope and authorization; conflict when the record changed). */
export function outcomeOf(type: OfflineCommandType, result: ApiResult): Outcome {
  const body = result.body;
  if (body.ok) return { status: "applied", serverResult: body.data };
  const e: ApiError = body.error;
  if (TRANSIENT_CODES.has(e.code) || result.status >= 500 || result.status === 429) return { status: "retry", errorCode: e.code, errorMessage: e.message };
  const base = REASON_BY_CODE[e.code] ?? "other";
  const reason = OFFLINE_HANDLERS[type].reason?.(e, base) ?? base;
  return refuse(reason, e.code, e.message, { serverResult: { error: e } });
}

type Prepared = { cmd: SyncCommandWire; row: typeof syncCommands.$inferSelect };

/** Runs one recorded command through the checks and the module service (no writes to the sync tables). */
async function evaluate(
  ctx: AuthContext,
  p: Prepared,
  o: { device: DeviceRow | null; serverCreated: boolean; requestId: string; now: Date; policy: Awaited<ReturnType<typeof offlinePolicy>> },
): Promise<Outcome> {
  const { cmd, row } = p;
  if (cmd.dependsOn) {
    const [dep] = await db.select({ status: syncCommands.status, org: syncCommands.organizationId }).from(syncCommands).where(eq(syncCommands.id, cmd.dependsOn)).limit(1);
    if (!dep || dep.org !== ctx.organizationId) return refuse("dependency_failed", "DEPENDENCY_FAILED", "The change this one depends on never reached the server, so it was not applied.");
    if (dep.status === "received") return { status: "retry", errorCode: "DEPENDENCY_PENDING", errorMessage: "Waiting for the earlier change to finish." };
    if (dep.status !== "applied") return refuse("dependency_failed", "DEPENDENCY_FAILED", "An earlier change this one depends on was not accepted, so this one was not applied either.");
  }

  if (!o.serverCreated) {
    if (cmd.authSnapshotUserId !== ctx.userId) {
      return refuse("session_revoked", "DEVICE_USER_CHANGED", "This change was queued by another person on this device. It was not applied under your sign-in; a supervisor reviews it.");
    }
    const issued = new Date(cmd.authSnapshotIssuedAt).getTime();
    const created = new Date(cmd.clientCreatedAt).getTime();
    const maxAge = o.policy.snapshotMaxAgeHours * 3_600_000;
    if (issued > o.now.getTime() + 10 * 60_000) return refuse("validation_failed", "SNAPSHOT_INVALID", "The device's offline sign-in time is in the future; check the device clock.");
    if (created - issued > maxAge) {
      return refuse("auth_snapshot_expired", "AUTH_SNAPSHOT_EXPIRED", `Captured ${Math.floor((created - issued) / 3_600_000)} h after the device last reached the server (limit ${o.policy.snapshotMaxAgeHours} h). Review before applying.`);
    }
    if (o.now.getTime() - created > o.policy.maxQueueAgeHours * 3_600_000) {
      return refuse("auth_snapshot_expired", "QUEUE_AGE_EXCEEDED", `Queued more than ${o.policy.maxQueueAgeHours} h ago. Review before applying.`);
    }
    if (cmd.authSnapshotSessionId && cmd.authSnapshotSessionId !== ctx.sessionId) {
      const [s] = await db.select({ userId: sessions.userId, revokedAt: sessions.revokedAt, revokedReason: sessions.revokedReason, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, cmd.authSnapshotSessionId)).limit(1);
      if (!s || s.userId !== ctx.userId) return refuse("session_revoked", "SESSION_UNKNOWN", "The sign-in this change was captured under is unknown. Review before applying.");
      if (s.revokedAt) return refuse("session_revoked", "SESSION_REVOKED", `The sign-in this change was captured under was ended (${s.revokedReason ?? "revoked"}). Review before applying.`);
      if (created > s.expiresAt.getTime()) return refuse("session_revoked", "SESSION_EXPIRED", "Captured after the sign-in had expired. Review before applying.");
    }
  }

  if (!isOfflineCommandType(cmd.type)) {
    return refuse("validation_failed", "ONLINE_ONLY", `Needs a connection: ${cmd.type} cannot be queued offline. Do it again online.`);
  }
  const def = OFFLINE_COMMANDS[cmd.type];
  const handler = OFFLINE_HANDLERS[cmd.type];
  const related = await handler.related(cmd.payload).catch(() => null);

  if (!ctx.allowedSiteIds.includes(cmd.siteId)) return refuse("site_not_allowed", "SITE_NOT_ALLOWED", "This site is no longer one of your sites.", { related: null });

  if (!o.serverCreated) {
    const siteWorkflows = (await getSetting(db, ctx.organizationId, "offline.workflows", cmd.siteId)) as string[];
    if (!siteWorkflows.includes(def.workflow)) return refuse("permission_denied", "WORKFLOW_NOT_ALLOWED", "This workflow is not allowed offline at this site.", { related });
    const d = o.device;
    if (d && (d.status === "suspended" || d.status === "removed")) return refuse("permission_denied", "DEVICE_NOT_ACTIVE", `This device is ${d.status}; offline work from it is not applied.`, { related });
    const active = d && d.status === "active" ? d : null;
    if (def.workflow === "movement_request") {
      const ok = active ? active.siteId === cmd.siteId && (await effectiveWorkflows(active)).includes(def.workflow) : await getSetting(db, ctx.organizationId, "offline.anonymous_movement_requests", cmd.siteId);
      if (!ok) return refuse("permission_denied", "DEVICE_NOT_ALLOWED", "Stock moves offline need a device registered for them at this site.", { related });
    } else if (!active || active.siteId !== cmd.siteId || !(await effectiveWorkflows(active)).includes(def.workflow)) {
      return refuse("permission_denied", "DEVICE_NOT_ALLOWED", "This workflow runs offline only on a device registered for it at this site.", { related });
    }
  }

  if (!ctx.canAt(def.permission, cmd.siteId)) {
    return refuse("permission_denied", "PERMISSIONS_CHANGED", `You no longer have permission for this at this site (${def.permission}). Nothing was applied.`, { related, permissionsChanged: true });
  }

  const envelope = { commandId: row.id, siteId: cmd.siteId, deviceId: row.deviceRegistrationId ?? undefined, clientCreatedAt: cmd.clientCreatedAt, payload: cmd.payload };
  const result = await executeCommand(handler.contract, ctx, { body: envelope, idempotencyKey: cmd.idempotencyKey, requestId: o.requestId }, (sctx, payload, meta) =>
    handler.run(sctx, payload as Record<string, unknown>, { idempotencyKey: meta.idempotencyKey }),
  );
  const out = outcomeOf(cmd.type, result);
  if (out.status === "applied") {
    out.applied = await handler.applied(out.serverResult, cmd.payload).catch(() => null);
    return out;
  }
  if (out.status === "retry") return out;
  out.related = await handler.related(cmd.payload).catch(() => related);
  if (handler.onRejected && out.reason && !result.body.ok) {
    const sctx = ctx.allowedSiteIds.includes(cmd.siteId) ? ctxAt(ctx, cmd.siteId) : ctx;
    out.extraState = await handler.onRejected(sctx, cmd.payload, result.body.error, out.reason, { commandId: row.id, clientCreatedAt: cmd.clientCreatedAt });
  }
  return out;
}

/** The context narrowed to a site (same rule as the /api/v1 pipeline). */
function ctxAt(ctx: AuthContext, siteId: string): AuthContext {
  return new AuthContext(ctx.userId, ctx.organizationId, ctx.displayName, ctx.email, ctx.roleCodes, ctx.permissions, ctx.allowedSites, siteId, ctx.options);
}

/** Writes the outcome on the row, the conflict row and the audit event in one transaction. */
async function finalize(ctx: AuthContext, row: typeof syncCommands.$inferSelect, out: Outcome, now: Date): Promise<SyncItemResult> {
  if (out.status === "retry") {
    await db.update(syncCommands).set({ errorCode: out.errorCode ?? null, errorMessage: out.errorMessage ?? null }).where(and(eq(syncCommands.id, row.id), eq(syncCommands.status, "received")));
    return { id: row.id, status: "retry", errorCode: out.errorCode ?? null, errorMessage: out.errorMessage ?? null };
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(syncCommands)
      .set({
        status: out.status,
        replayedAt: now,
        serverResult: (out.serverResult ?? null) as object | null,
        errorCode: out.errorCode ?? null,
        errorMessage: out.errorMessage ?? null,
        ...(out.status === "applied"
          ? { appliedAt: now, appliedEntityType: out.applied?.type ?? null, appliedEntityId: out.applied?.id ?? null, appliedEntityNumber: out.applied?.number ?? null }
          : {}),
      })
      .where(and(eq(syncCommands.id, row.id), eq(syncCommands.status, "received")))
      .returning();
    if (!updated) {
      // A concurrent resend finished first: answer from what it stored.
      return storedResult(row.id);
    }
    let conflictId: string | null = null;
    if (out.status !== "applied") {
      const related = out.related ?? null;
      const [c] = await tx
        .insert(syncConflicts)
        .values({
          organizationId: row.organizationId,
          siteId: row.siteId,
          syncCommandId: row.id,
          deviceRegistrationId: row.deviceRegistrationId,
          userId: row.userId,
          commandType: row.commandType,
          reasonCode: out.reason ?? "other",
          reasonMessage: (out.errorMessage ?? "Not accepted.").slice(0, 1000),
          clientState: { type: row.commandType, payload: row.payload, clientCreatedAt: row.clientCreatedAt.toISOString(), clientSequence: row.clientSequence, authSnapshotIssuedAt: row.authSnapshotIssuedAt.toISOString() },
          serverState: related || out.extraState ? { ...(related?.state ?? {}), ...(out.extraState ?? {}) } : null,
          relatedEntityType: related?.type ?? null,
          relatedEntityId: related?.id ?? null,
          relatedEntityNumber: related?.number ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: syncConflicts.id });
      conflictId = c?.id ?? null;
    }
    await audit(tx, ctx, {
      action: out.status === "applied" ? "platform.sync_command.replay_accepted" : "platform.sync_command.replay_rejected",
      entityType: "sync_command",
      entityId: row.id,
      entityNumber: out.applied?.number ?? row.commandType,
      siteId: row.siteId,
      after: {
        commandType: row.commandType,
        status: out.status,
        reason: out.reason ?? null,
        errorCode: out.errorCode ?? null,
        clientCreatedAt: row.clientCreatedAt.toISOString(),
        clockSkewSeconds: row.clockSkewSeconds,
        clockSkewFlagged: row.isClockSkewFlagged,
        appliedEntity: out.applied ?? null,
        conflictId,
        queuedBy: row.userId,
      },
    });
    return {
      id: row.id,
      status: out.status,
      reasonCode: out.reason ?? null,
      errorCode: out.errorCode ?? null,
      errorMessage: out.errorMessage ?? null,
      serverResult: out.status === "applied" ? out.serverResult : null,
      conflictId,
      appliedEntityNumber: out.applied?.number ?? null,
    };
  });
}

/** Answer for a command the server already decided (resend after a lost response). */
async function storedResult(id: string): Promise<SyncItemResult> {
  const [r] = await db.select().from(syncCommands).where(eq(syncCommands.id, id)).limit(1);
  const [c] = await db.select({ id: syncConflicts.id, reason: syncConflicts.reasonCode }).from(syncConflicts).where(eq(syncConflicts.syncCommandId, id)).limit(1);
  return {
    id,
    status: r.status === "received" ? "retry" : (r.status as SyncItemResult["status"]),
    reasonCode: (c?.reason as SyncConflictReason | undefined) ?? null,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    serverResult: r.status === "applied" ? r.serverResult : null,
    conflictId: c?.id ?? null,
    appliedEntityNumber: r.appliedEntityNumber,
  };
}

export type ReplayResponse = { batchId: string; serverTime: string; results: SyncItemResult[]; permissionsChanged: boolean; snapshot: Awaited<ReturnType<typeof buildAuthSnapshot>> };

export async function replaySyncBatch(ctx: AuthContext | null, input: { body: unknown; deviceKey: string | null; requestId?: string; now?: Date }): Promise<ApiResult> {
  if (!ctx) return errorResult(401, "UNAUTHENTICATED", "Sign in again to sync. Your queued changes stay on the device.");
  const parsed = SyncBatchWire.safeParse(input.body);
  if (!parsed.success) {
    return errorResult(422, "VALIDATION", "The sync batch is malformed.", { fields: Object.fromEntries(parsed.error.issues.slice(0, 20).map((i) => [i.path.join(".") || "body", i.message])) });
  }
  const now = input.now ?? new Date();
  const requestId = input.requestId ?? uuidv7();
  const batchId = uuidv7();
  const policy = await offlinePolicy(ctx.organizationId);
  const device = await findDeviceByKey(ctx.organizationId, input.deviceKey);
  const skewSeconds = Math.round((now.getTime() - new Date(parsed.data.deviceSentAt).getTime()) / 1000);
  const skewFlagged = Math.abs(skewSeconds) > policy.clockSkewFlagMinutes * 60;

  const ordered = [...parsed.data.commands].sort((a, b) => a.clientSequence - b.clientSequence);
  const queuers = [...new Set(ordered.map((c) => c.authSnapshotUserId))];
  const known = new Set(
    (await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, ctx.organizationId), inArray(users.id, queuers)))).map((u) => u.id),
  );

  const orgSites = new Set((await db.select({ id: sites.id }).from(sites).where(eq(sites.organizationId, ctx.organizationId))).map((x) => x.id));

  const results: SyncItemResult[] = [];
  let permissionsChanged = false;
  for (const [position, cmd] of ordered.entries()) {
    const [inserted] = await db
      .insert(syncCommands)
      .values({
        id: cmd.id,
        organizationId: ctx.organizationId,
        // A site outside the organization is recorded against the session's site (the command is refused below).
        siteId: orgSites.has(cmd.siteId) ? cmd.siteId : ctx.currentSiteId,
        deviceRegistrationId: device?.id ?? null,
        userId: known.has(cmd.authSnapshotUserId) ? cmd.authSnapshotUserId : ctx.userId,
        sessionId: ctx.sessionId,
        commandType: cmd.type,
        payload: cmd.payload,
        idempotencyKey: cmd.idempotencyKey,
        clientCreatedAt: new Date(cmd.clientCreatedAt),
        clientSequence: device ? cmd.clientSequence : null,
        authSnapshotIssuedAt: new Date(cmd.authSnapshotIssuedAt),
        authSnapshotSessionId: cmd.authSnapshotSessionId ?? null,
        receivedAt: now,
        syncBatchId: batchId,
        positionInBatch: position,
        clockSkewSeconds: skewSeconds,
        isClockSkewFlagged: skewFlagged,
        dependsOnCommandId: cmd.dependsOn ?? null,
        status: "received",
        correlationId: uuidv7(),
      })
      .onConflictDoNothing()
      .returning();
    let row = inserted;
    if (!row) {
      const [existing] = await db.select().from(syncCommands).where(eq(syncCommands.id, cmd.id)).limit(1);
      if (!existing) {
        results.push({ id: cmd.id, status: "rejected", reasonCode: "duplicate_key_mismatch", errorCode: "IDEMPOTENCY_KEY_REUSED", errorMessage: "This idempotency key was already used by another change." });
        continue;
      }
      if (existing.organizationId !== ctx.organizationId || existing.idempotencyKey !== cmd.idempotencyKey) {
        results.push({ id: cmd.id, status: "rejected", reasonCode: "duplicate_key_mismatch", errorCode: "DUPLICATE_COMMAND_ID", errorMessage: "This command id was already used for a different change." });
        continue;
      }
      if (existing.status !== "received") {
        results.push(await storedResult(existing.id));
        continue;
      }
      row = existing;
    }
    const out = await evaluate(ctx, { cmd, row }, { device, serverCreated: false, requestId, now, policy });
    if (out.permissionsChanged) permissionsChanged = true;
    results.push(await finalize(ctx, row, out, now));
  }
  if (device && device.status !== "removed") await touchDevice(device.id, { synced: true, skewSeconds });
  const snapshot = await buildAuthSnapshot(ctx, input.deviceKey, now);
  const data: ReplayResponse = { batchId, serverTime: now.toISOString(), results, permissionsChanged, snapshot };
  return { status: 200, body: { ok: true, data } };
}

/**
 * Re-applies a parked command as a NEW command (conflict resolution, US-7-05). `ctx` is the context
 * the command runs under (the person who queued it, rebuilt now); `createdBy` is the reviewer. The
 * new row gets a new id and key; its outcome is final (a failure does not open another conflict).
 */
export async function runResolutionCommand(
  ctx: AuthContext,
  a: { original: typeof syncCommands.$inferSelect; payload: Record<string, unknown>; createdBy: string; conflictId: string; sessionId: string | null; requestId?: string },
): Promise<{ commandId: string; outcome: Outcome; result: SyncItemResult }> {
  const now = new Date();
  const id = uuidv7();
  const key = crypto.randomUUID();
  const [row] = await db
    .insert(syncCommands)
    .values({
      id,
      organizationId: a.original.organizationId,
      siteId: a.original.siteId,
      deviceRegistrationId: a.original.deviceRegistrationId,
      userId: a.original.userId,
      sessionId: a.sessionId,
      commandType: a.original.commandType,
      payload: a.payload,
      idempotencyKey: key,
      clientCreatedAt: a.original.clientCreatedAt,
      clientSequence: null,
      authSnapshotIssuedAt: now,
      receivedAt: now,
      syncBatchId: uuidv7(),
      positionInBatch: 0,
      status: "received",
      resolutionOfConflictId: a.conflictId,
      createdBy: a.createdBy,
      correlationId: uuidv7(),
    })
    .returning();
  const cmd: SyncCommandWire = {
    id,
    idempotencyKey: key,
    type: a.original.commandType,
    payload: a.payload,
    siteId: a.original.siteId,
    clientCreatedAt: a.original.clientCreatedAt.toISOString(),
    clientSequence: 0,
    authSnapshotIssuedAt: now.toISOString(),
    authSnapshotUserId: a.original.userId,
  };
  const policy = await offlinePolicy(ctx.organizationId);
  const outcome = await evaluate(ctx, { cmd, row }, { device: null, serverCreated: true, requestId: a.requestId ?? uuidv7(), now, policy });
  if (outcome.status === "retry") {
    // A transient problem (e.g. read-only window): the new command is closed as rejected so it cannot run later unseen.
    outcome.status = "rejected";
    outcome.reason = "other";
  }
  // A failed re-apply is final for the new command and opens no second conflict.
  const result = outcome.status === "applied" ? await finalize(ctx, row, outcome, now) : await closeWithoutConflict(ctx, row, outcome, now);
  return { commandId: id, outcome, result };
}

async function closeWithoutConflict(ctx: AuthContext, row: typeof syncCommands.$inferSelect, out: Outcome, now: Date): Promise<SyncItemResult> {
  await db.transaction(async (tx) => {
    await tx
      .update(syncCommands)
      .set({ status: "rejected", replayedAt: now, errorCode: out.errorCode ?? null, errorMessage: out.errorMessage ?? null, serverResult: (out.serverResult ?? null) as object | null })
      .where(eq(syncCommands.id, row.id));
    await audit(tx, ctx, {
      action: "platform.sync_command.replay_rejected",
      entityType: "sync_command",
      entityId: row.id,
      entityNumber: row.commandType,
      siteId: row.siteId,
      after: { commandType: row.commandType, status: "rejected", reason: out.reason ?? null, errorCode: out.errorCode ?? null, resolutionOfConflictId: row.resolutionOfConflictId },
    });
  });
  return { id: row.id, status: "rejected", reasonCode: out.reason ?? null, errorCode: out.errorCode ?? null, errorMessage: out.errorMessage ?? null };
}
