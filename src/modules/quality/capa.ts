import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  CAPA_ACTION_KINDS,
  CAPA_EFFECTIVENESS_RESULTS,
  CAPA_SOURCES,
  capaActions,
  capaStateTransitions,
  capas,
  complaints,
  deviations,
  rolePermissions,
  sites,
  userSiteAssignments,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { activeAssignment } from "@/lib/auth/assignments";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { nextNumber } from "@/lib/numbering";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { notifyUsers } from "@/modules/platform";
import {
  CAPA_SOURCE_LABEL,
  CAPA_STATUS_LABEL,
  CAPA_TRANSITIONS,
  type CapaActionStatus,
  type CapaSource,
  type CapaStatus,
  canMoveCapa,
  canMoveCapaAction,
  capaSubmitBlockers,
  isActionOverdue,
} from "./capa-rules";
import { assertUuid, isIsoDate, isUuid, manilaToday, optionalText, reasonText, requiredText, withIdempotency } from "./shared";

/**
 * CAPA (US-6-18, FR-quality-07, process map W07-04, ux-system §9.14). Opened from a deviation (W2C), a
 * complaint (W3F), an audit finding or another source; actions with owners and due dates; "Submit for
 * closure" (quality.capa.submit) once every action is verified; an effectiveness check recorded no
 * earlier than the configured period (quality.capa.effectiveness_check_days, QA to confirm); "Close CAPA"
 * (quality.capa.approve) by a person other than the submitter. Every transition writes a
 * capa_state_transitions row and an audit event `quality.capa.*`.
 */

type CapaRow = typeof capas.$inferSelect;
type ActionRow = typeof capaActions.$inferSelect;
const owner = alias(users, "capa_owner");
const creator = alias(users, "capa_creator");

const addDays = (date: string, days: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function requireAny(ctx: AuthContext, perms: Permission[], siteId: string) {
  ctx.requireSite(siteId);
  if (!perms.some((p) => ctx.canAt(p, siteId))) ctx.requireAt(perms[0], siteId);
}

async function writeTransition(tx: Tx, ctx: AuthContext, c: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(capaStateTransitions).values({ organizationId: ctx.organizationId, siteId: c.siteId, capaId: c.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

async function lockCapa(tx: Tx, ctx: AuthContext, capaId: string): Promise<CapaRow> {
  assertUuid(capaId, "CAPA");
  const [c] = await tx.select().from(capas).where(and(eq(capas.id, capaId), eq(capas.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!c || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("not_found", "CAPA not found in your sites.");
  return c;
}

async function move(tx: Tx, ctx: AuthContext, c: CapaRow, to: CapaStatus, reason: string | null, set: Partial<typeof capas.$inferInsert> = {}) {
  if (!canMoveCapa(c.status, to)) throw new DomainError("state", `CAPA ${c.capaNumber} is ${CAPA_STATUS_LABEL[c.status as CapaStatus]?.toLowerCase() ?? c.status}; it cannot move to ${CAPA_STATUS_LABEL[to].toLowerCase()}.`);
  await tx.update(capas).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(capas.id, c.id));
  await writeTransition(tx, ctx, c, c.status, to, reason);
  const from = c.status;
  Object.assign(c, set, { status: to });
  return from;
}

/** Active users who hold `permission` at the site (directly or organization-wide): CAPA and action owners. */
export async function usersHoldingAt(q: DbOrTx, organizationId: string, permission: Permission, siteId: string) {
  return q
    .selectDistinct({ id: users.id, name: users.displayName })
    .from(userSiteAssignments)
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, permission),
        activeAssignment(),
        or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, siteId)),
      ),
    )
    .orderBy(asc(users.displayName));
}

async function assertOwner(q: DbOrTx, ctx: AuthContext, userId: string | null | undefined, siteId: string, field: string) {
  if (!userId || !isUuid(userId)) throw new DomainError("validation", "Choose the owner.", { field });
  const ok = (await usersHoldingAt(q, ctx.organizationId, "quality.capa.view", siteId)).some((u) => u.id === userId);
  if (!ok) throw new DomainError("validation", "The owner must be an active user who can see CAPAs at this site.", { field });
}

function dueDateOrNull(v: string | null | undefined, field: string, opts: { required?: boolean } = {}) {
  const d = (v ?? "").trim();
  if (!d) {
    if (opts.required) throw new DomainError("validation", "Enter the due date.", { field });
    return null;
  }
  if (!isIsoDate(d)) throw new DomainError("validation", "Enter a valid date.", { field });
  return d;
}

/* ------------------------------------------------------------------ open */

export type OpenCapaInput = {
  sourceKind: CapaSource;
  deviationId?: string | null;
  complaintId?: string | null;
  sourceReference?: string | null;
  /** Site for an audit / other CAPA (default: the current site); deviation and complaint CAPAs take their source's site. */
  siteId?: string | null;
  title: string;
  problemStatement: string;
  ownerId: string;
  dueDate?: string | null;
  idempotencyKey?: string | null;
};

export async function openCapa(ctx: AuthContext, input: OpenCapaInput) {
  ctx.require("quality.capa.create");
  if (!(CAPA_SOURCES as readonly string[]).includes(input.sourceKind)) throw new DomainError("validation", "Choose the source.", { field: "sourceKind" });
  const title = requiredText(input.title, "title", "A title", 200);
  const problemStatement = reasonText(input.problemStatement, "problemStatement", 4000);
  const sourceReference = optionalText(input.sourceReference, "sourceReference", 300);
  const dueDate = dueDateOrNull(input.dueDate, "dueDate");
  if (input.idempotencyKey && input.idempotencyKey.length > 200) throw new DomainError("validation", "The request key is too long.");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"capa:" + input.idempotencyKey}))`);
      const [dup] = await tx.select({ id: capas.id, n: capas.capaNumber, siteId: capas.siteId }).from(capas).where(and(eq(capas.organizationId, ctx.organizationId), eq(capas.idempotencyKey, input.idempotencyKey))).limit(1);
      if (dup) {
        ctx.requireSite(dup.siteId);
        return { capaId: dup.id, capaNumber: dup.n, replayed: true };
      }
    }
    let siteId: string | null = null;
    let deviationId: string | null = null;
    let complaintId: string | null = null;
    let sourceNumber: string | null = null;
    if (input.sourceKind === "deviation") {
      if (!input.deviationId || !isUuid(input.deviationId)) throw new DomainError("validation", "Choose the deviation.", { field: "deviationId" });
      const [d] = await tx.select({ id: deviations.id, siteId: deviations.siteId, n: deviations.deviationNumber }).from(deviations).where(and(eq(deviations.id, input.deviationId), eq(deviations.organizationId, ctx.organizationId))).limit(1);
      if (!d || !ctx.allowedSiteIds.includes(d.siteId)) throw new DomainError("not_found", "Deviation not found in your sites.", { field: "deviationId" });
      siteId = d.siteId;
      deviationId = d.id;
      sourceNumber = d.n;
    } else if (input.sourceKind === "complaint") {
      if (!input.complaintId || !isUuid(input.complaintId)) throw new DomainError("validation", "Choose the complaint.", { field: "complaintId" });
      const [c] = await tx.select({ id: complaints.id, siteId: complaints.siteId, n: complaints.complaintNumber }).from(complaints).where(and(eq(complaints.id, input.complaintId), eq(complaints.organizationId, ctx.organizationId))).limit(1);
      if (!c || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("not_found", "Complaint not found in your sites.", { field: "complaintId" });
      siteId = c.siteId;
      complaintId = c.id;
      sourceNumber = c.n;
    } else {
      siteId = input.siteId && isUuid(input.siteId) ? input.siteId : ctx.currentSiteId;
      if (!sourceReference && input.sourceKind === "audit") throw new DomainError("validation", "Name the audit finding.", { field: "sourceReference" });
    }
    ctx.requireAt("quality.capa.create", siteId!);
    await assertOwner(tx, ctx, input.ownerId, siteId!, "ownerId");
    const capaNumber = await nextNumber(tx, ctx.organizationId, "CAPA");
    const [c] = await tx
      .insert(capas)
      .values({
        organizationId: ctx.organizationId,
        siteId: siteId!,
        capaNumber,
        status: "open",
        sourceKind: input.sourceKind,
        deviationId,
        complaintId,
        sourceReference: sourceReference ?? sourceNumber,
        title,
        problemStatement,
        ownerId: input.ownerId,
        dueDate,
        createdBy: ctx.userId,
        statusChangedBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await writeTransition(tx, ctx, c, null, "open", title);
    await audit(tx, ctx, {
      action: "quality.capa.created",
      entityType: "capa",
      entityId: c.id,
      entityNumber: capaNumber,
      siteId: c.siteId,
      reason: problemStatement,
      after: { sourceKind: c.sourceKind, deviationId, complaintId, sourceReference: c.sourceReference, ownerId: c.ownerId, dueDate },
    });
    if (input.ownerId !== ctx.userId) {
      await notifyUsers(tx, [input.ownerId], {
        organizationId: ctx.organizationId,
        siteId: c.siteId,
        kind: "quality.capa.assigned",
        severity: "info",
        title: `You own CAPA ${capaNumber}`,
        body: title,
        entityType: "capa",
        entityId: c.id,
        link: `/quality/capa/${c.id}`,
        dedupeKey: `capa-owner:${c.id}:${input.ownerId}`,
      });
    }
    return { capaId: c.id, capaNumber, replayed: false };
  });
}

/* ------------------------------------------------------------------ edit (investigation record) */

export type UpdateCapaInput = {
  capaId: string;
  title?: string | null;
  problemStatement?: string | null;
  rootCause?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  effectivenessCriteria?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
};

/** Updates the CAPA record while it is open or in progress (QA, or the CAPA owner holding quality.capa.create). */
export async function updateCapa(ctx: AuthContext, input: UpdateCapaInput) {
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    const isOwner = c.ownerId === ctx.userId && ctx.canAt("quality.capa.create", c.siteId);
    if (!isOwner) ctx.requireAt("quality.capa.submit", c.siteId);
    if (!["open", "in_progress"].includes(c.status)) throw new DomainError("state", `CAPA ${c.capaNumber} is ${c.status.replace(/_/g, " ")}; its record can no longer be edited.`);
    const set: Partial<typeof capas.$inferInsert> = {};
    if (input.title !== undefined && input.title !== null) set.title = requiredText(input.title, "title", "A title", 200);
    if (input.problemStatement !== undefined && input.problemStatement !== null) set.problemStatement = reasonText(input.problemStatement, "problemStatement", 4000);
    if (input.rootCause !== undefined) set.rootCause = optionalText(input.rootCause, "rootCause", 4000);
    if (input.correctiveAction !== undefined) set.correctiveAction = optionalText(input.correctiveAction, "correctiveAction", 4000);
    if (input.preventiveAction !== undefined) set.preventiveAction = optionalText(input.preventiveAction, "preventiveAction", 4000);
    if (input.effectivenessCriteria !== undefined) set.effectivenessCriteria = optionalText(input.effectivenessCriteria, "effectivenessCriteria", 2000);
    if (input.dueDate !== undefined) set.dueDate = dueDateOrNull(input.dueDate, "dueDate");
    if (input.ownerId && input.ownerId !== c.ownerId) {
      // Reassigning the CAPA is QA's decision.
      ctx.requireAt("quality.capa.submit", c.siteId);
      await assertOwner(tx, ctx, input.ownerId, c.siteId, "ownerId");
      set.ownerId = input.ownerId;
    }
    const changed = Object.fromEntries(Object.entries(set).filter(([k, v]) => (c as Record<string, unknown>)[k] !== v));
    if (Object.keys(changed).length === 0) throw new DomainError("validation", "Nothing changed.");
    await tx.update(capas).set(changed).where(eq(capas.id, c.id));
    await audit(tx, ctx, {
      action: "quality.capa.updated",
      entityType: "capa",
      entityId: c.id,
      entityNumber: c.capaNumber,
      siteId: c.siteId,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, (c as Record<string, unknown>)[k]])),
      after: changed,
    });
    if (set.ownerId) {
      await notifyUsers(tx, [set.ownerId], { organizationId: ctx.organizationId, siteId: c.siteId, kind: "quality.capa.assigned", severity: "info", title: `You own CAPA ${c.capaNumber}`, body: c.title, entityType: "capa", entityId: c.id, link: `/quality/capa/${c.id}`, dedupeKey: `capa-owner:${c.id}:${set.ownerId}` });
    }
    return { capaId: c.id };
  });
}

/* ------------------------------------------------------------------ actions */

export type AddCapaActionInput = { capaId: string; actionKind: string; description: string; ownerId: string; dueDate: string; verificationMethod?: string | null; idempotencyKey?: string | null };

/** Adds an action with owner and due date (QA or the site manager, W07 "site_manager assigns actions"). The first action starts the CAPA. */
export async function addCapaAction(ctx: AuthContext, input: AddCapaActionInput) {
  if (!(CAPA_ACTION_KINDS as readonly string[]).includes(input.actionKind)) throw new DomainError("validation", "Choose corrective or preventive.", { field: "actionKind" });
  const description = reasonText(input.description, "description", 2000);
  const verificationMethod = optionalText(input.verificationMethod, "verificationMethod", 1000);
  const dueDate = dueDateOrNull(input.dueDate, "dueDate", { required: true })!;
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    requireAny(ctx, ["quality.capa.submit", "quality.capa.create"], c.siteId);
    if (!["open", "in_progress"].includes(c.status)) throw new DomainError("state", `CAPA ${c.capaNumber} is ${c.status.replace(/_/g, " ")}; actions can be added while it is open or in progress.`);
    if (dueDate < manilaToday()) throw new DomainError("validation", "The due date cannot be in the past.", { field: "dueDate" });
    await assertOwner(tx, ctx, input.ownerId, c.siteId, "ownerId");
    return withIdempotency(tx, ctx, input.idempotencyKey, "quality.capa.action_add", async () => {
    const [{ n }] = (await tx.execute(sql`select coalesce(max(action_no), 0)::int + 1 as n from capa_actions where capa_id = ${c.id}`)) as unknown as { n: number }[];
    const [a] = await tx
      .insert(capaActions)
      .values({ organizationId: ctx.organizationId, siteId: c.siteId, capaId: c.id, actionNo: Number(n), actionKind: input.actionKind, description, ownerId: input.ownerId, dueDate, verificationMethod, createdBy: ctx.userId })
      .returning();
    let started = false;
    if (c.status === "open") {
      await move(tx, ctx, c, "in_progress", `Action ${a.actionNo} added`);
      started = true;
    }
    await audit(tx, ctx, { action: "quality.capa.action_added", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, after: { actionId: a.id, actionNo: a.actionNo, kind: a.actionKind, ownerId: a.ownerId, dueDate, started } });
    if (input.ownerId !== ctx.userId) {
      await notifyUsers(tx, [input.ownerId], {
        organizationId: ctx.organizationId,
        siteId: c.siteId,
        kind: "quality.capa.action_assigned",
        severity: "info",
        title: `CAPA ${c.capaNumber} action ${a.actionNo} is yours (due ${dueDate})`,
        body: description,
        entityType: "capa",
        entityId: c.id,
        link: `/quality/capa/${c.id}`,
        dedupeKey: `capa-action:${a.id}`,
      });
    }
    return { actionId: a.id, actionNo: a.actionNo, started, replayed: false };
    });
  });
}

async function lockAction(tx: Tx, ctx: AuthContext, actionId: string) {
  assertUuid(actionId, "CAPA action");
  const [a] = await tx.select().from(capaActions).where(and(eq(capaActions.id, actionId), eq(capaActions.organizationId, ctx.organizationId))).limit(1);
  if (!a || !ctx.allowedSiteIds.includes(a.siteId)) throw new DomainError("not_found", "CAPA action not found in your sites.");
  const c = await lockCapa(tx, ctx, a.capaId);
  const [locked] = await tx.select().from(capaActions).where(eq(capaActions.id, a.id)).for("update").limit(1);
  return { c, a: locked as ActionRow };
}

function assertActionMove(a: ActionRow, to: CapaActionStatus) {
  if (!canMoveCapaAction(a.status, to)) throw new DomainError("state", `Action ${a.actionNo} is ${a.status}; it cannot become ${to}.`);
}

function assertCapaLive(c: CapaRow) {
  if (c.status !== "in_progress") throw new DomainError("state", `CAPA ${c.capaNumber} is ${c.status.replace(/_/g, " ")}; actions change only while it is in progress.`);
}

/** The action's owner (with access to the CAPA) or QA records that the action is done, with evidence. */
export async function completeCapaAction(ctx: AuthContext, input: { actionId: string; note: string }) {
  ctx.require("quality.capa.view");
  const note = reasonText(input.note, "note", 2000);
  return db.transaction(async (tx) => {
    const { c, a } = await lockAction(tx, ctx, input.actionId);
    if (a.ownerId !== ctx.userId) ctx.requireAt("quality.capa.submit", c.siteId);
    else ctx.requireAt("quality.capa.view", c.siteId);
    assertCapaLive(c);
    assertActionMove(a, "done");
    const now = new Date();
    await tx.update(capaActions).set({ status: "done", completedAt: now, completedBy: ctx.userId, completionNote: note }).where(eq(capaActions.id, a.id));
    await audit(tx, ctx, { action: "quality.capa.action_completed", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason: note, before: { actionNo: a.actionNo, status: a.status }, after: { actionNo: a.actionNo, status: "done" } });
    return { status: "done" as const };
  });
}

/** A second person (QA) verifies a done action with the stated method: verifier ≠ the person who completed it. */
export async function verifyCapaAction(ctx: AuthContext, input: { actionId: string; note: string }) {
  ctx.require("quality.capa.submit");
  const note = reasonText(input.note, "note", 2000);
  return db.transaction(async (tx) => {
    const { c, a } = await lockAction(tx, ctx, input.actionId);
    ctx.requireAt("quality.capa.submit", c.siteId);
    assertCapaLive(c);
    assertActionMove(a, "verified");
    if (a.completedBy === ctx.userId) throw new DomainError("separation_of_duties", "You recorded this action as done, so another person must verify it (separation of duties).");
    await tx.update(capaActions).set({ status: "verified", verifiedAt: new Date(), verifiedBy: ctx.userId, verificationNote: note }).where(eq(capaActions.id, a.id));
    await audit(tx, ctx, { action: "quality.capa.action_verified", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason: note, before: { actionNo: a.actionNo, status: a.status }, after: { actionNo: a.actionNo, status: "verified" } });
    return { status: "verified" as const };
  });
}

/** QA sends a done action back (verification failed) or cancels an action no longer needed, with a reason. */
export async function reopenOrCancelCapaAction(ctx: AuthContext, input: { actionId: string; to: "open" | "cancelled"; reason: string }) {
  ctx.require("quality.capa.submit");
  const reason = reasonText(input.reason);
  if (input.to !== "open" && input.to !== "cancelled") throw new DomainError("validation", "Choose reopen or cancel.");
  return db.transaction(async (tx) => {
    const { c, a } = await lockAction(tx, ctx, input.actionId);
    ctx.requireAt("quality.capa.submit", c.siteId);
    assertCapaLive(c);
    assertActionMove(a, input.to);
    const set: Partial<typeof capaActions.$inferInsert> =
      input.to === "open" ? { status: "open", completedAt: null, completedBy: null, completionNote: null } : { status: "cancelled", cancelReason: reason };
    await tx.update(capaActions).set(set).where(eq(capaActions.id, a.id));
    await audit(tx, ctx, { action: input.to === "open" ? "quality.capa.action_reopened" : "quality.capa.action_cancelled", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason, before: { actionNo: a.actionNo, status: a.status, completionNote: a.completionNote }, after: { actionNo: a.actionNo, status: input.to } });
    return { status: input.to };
  });
}

/* ------------------------------------------------------------------ verification and closure */

/**
 * "Submit for closure" (quality.capa.submit): every action verified (or cancelled), root cause and the
 * effectiveness criterion recorded. The effectiveness check date is today + the configured period, or a
 * later date QA chooses.
 */
export async function submitCapaForClosure(ctx: AuthContext, input: { capaId: string; effectivenessDueOn?: string | null }) {
  ctx.require("quality.capa.submit");
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    ctx.requireAt("quality.capa.submit", c.siteId);
    const actions = await tx.select({ actionNo: capaActions.actionNo, status: capaActions.status }).from(capaActions).where(eq(capaActions.capaId, c.id));
    const blockers = capaSubmitBlockers(c, actions);
    if (blockers.length) throw new DomainError("state", blockers.join(" "));
    const days = await getSetting(tx, ctx.organizationId, "quality.capa.effectiveness_check_days", c.siteId);
    const earliest = addDays(manilaToday(), days);
    let due = earliest;
    if (input.effectivenessDueOn) {
      if (!isIsoDate(input.effectivenessDueOn)) throw new DomainError("validation", "Enter a valid date.", { field: "effectivenessDueOn" });
      if (input.effectivenessDueOn < earliest) throw new DomainError("validation", `The effectiveness check can be no earlier than ${earliest} (${days} days, setting quality.capa.effectiveness_check_days).`, { field: "effectivenessDueOn" });
      due = input.effectivenessDueOn;
    }
    await move(tx, ctx, c, "verification", `Effectiveness check due ${due}`, {
      submittedBy: ctx.userId,
      submittedAt: new Date(),
      effectivenessDueOn: due,
      effectivenessResult: null,
      effectivenessEvidence: null,
      effectivenessCheckedBy: null,
      effectivenessCheckedAt: null,
    });
    await audit(tx, ctx, { action: "quality.capa.submitted", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, before: { status: "in_progress" }, after: { status: "verification", effectivenessDueOn: due, checkDays: days } });
    return { status: "verification" as const, effectivenessDueOn: due };
  });
}

/**
 * Records the effectiveness check (quality.capa.submit) on or after its date. `not_effective` returns the
 * CAPA to in_progress so new actions can be added (W07-04 "Effectiveness check").
 */
export async function recordEffectivenessCheck(ctx: AuthContext, input: { capaId: string; result: string; evidence: string }, now = new Date()) {
  ctx.require("quality.capa.submit");
  if (!(CAPA_EFFECTIVENESS_RESULTS as readonly string[]).includes(input.result)) throw new DomainError("validation", "Choose effective or not effective.", { field: "result" });
  const evidence = reasonText(input.evidence, "evidence", 4000);
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    ctx.requireAt("quality.capa.submit", c.siteId);
    if (c.status !== "verification") throw new DomainError("state", `CAPA ${c.capaNumber} is ${c.status.replace(/_/g, " ")}; submit it for closure first.`);
    if (c.effectivenessResult) throw new DomainError("state", "The effectiveness check is already recorded.");
    const today = manilaToday(now);
    if (c.effectivenessDueOn && today < c.effectivenessDueOn) throw new DomainError("state", `The effectiveness check is due on ${c.effectivenessDueOn}; it cannot be recorded earlier.`);
    const at = new Date();
    await tx.update(capas).set({ effectivenessResult: input.result, effectivenessEvidence: evidence, effectivenessCheckedBy: ctx.userId, effectivenessCheckedAt: at }).where(eq(capas.id, c.id));
    Object.assign(c, { effectivenessResult: input.result });
    await audit(tx, ctx, { action: "quality.capa.effectiveness_checked", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason: evidence, after: { result: input.result } });
    if (input.result === "not_effective") {
      await move(tx, ctx, c, "in_progress", `Not effective: ${evidence}`, { submittedBy: null, submittedAt: null });
      return { status: "in_progress" as const };
    }
    return { status: "verification" as const };
  });
}

/** Closes the CAPA (quality.capa.approve): effectiveness `effective` and a closer other than the submitter (SoD). */
export async function closeCapa(ctx: AuthContext, input: { capaId: string; note?: string | null }) {
  ctx.require("quality.capa.approve");
  const note = optionalText(input.note, "note", 2000);
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    ctx.requireAt("quality.capa.approve", c.siteId);
    if (c.status !== "verification") throw new DomainError("state", `CAPA ${c.capaNumber} is ${c.status.replace(/_/g, " ")}; only a CAPA in verification can be closed.`);
    if (c.effectivenessResult !== "effective") throw new DomainError("state", "Record an effectiveness check with the result “effective” before closing (FR-quality-07).");
    if (c.submittedBy === ctx.userId) throw new DomainError("separation_of_duties", "You submitted this CAPA for closure, so another person must close it (separation of duties).");
    if (!c.rootCause) throw new DomainError("state", "The root cause is missing.");
    await move(tx, ctx, c, "closed", note ?? "Closed", { closedBy: ctx.userId, closedAt: new Date(), closureNote: note });
    await audit(tx, ctx, { action: "quality.capa.closed", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason: note, before: { status: "verification" }, after: { status: "closed", effectivenessResult: c.effectivenessResult } });
    return { status: "closed" as const };
  });
}

/** Cancels an open or in-progress CAPA (duplicate, raised in error) with a reason; its open actions are cancelled too. */
export async function cancelCapa(ctx: AuthContext, input: { capaId: string; reason: string }) {
  ctx.require("quality.capa.approve");
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const c = await lockCapa(tx, ctx, input.capaId);
    ctx.requireAt("quality.capa.approve", c.siteId);
    await move(tx, ctx, c, "cancelled", reason, { cancelReason: reason });
    const cancelled = await tx
      .update(capaActions)
      .set({ status: "cancelled", cancelReason: `CAPA cancelled: ${reason}` })
      .where(and(eq(capaActions.capaId, c.id), inArray(capaActions.status, ["open", "done"])))
      .returning({ n: capaActions.actionNo });
    await audit(tx, ctx, { action: "quality.capa.cancelled", entityType: "capa", entityId: c.id, entityNumber: c.capaNumber, siteId: c.siteId, reason, after: { status: "cancelled", actionsCancelled: cancelled.map((a) => a.n) } });
    return { status: "cancelled" as const };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listCapas(ctx: AuthContext, f: { status?: string; deviationId?: string; complaintId?: string; mine?: boolean } = {}) {
  ctx.require("quality.capa.view");
  const conds = [eq(capas.organizationId, ctx.organizationId), inArray(capas.siteId, ctx.allowedSiteIds)];
  if (f.deviationId && isUuid(f.deviationId)) conds.push(eq(capas.deviationId, f.deviationId));
  if (f.complaintId && isUuid(f.complaintId)) conds.push(eq(capas.complaintId, f.complaintId));
  if (f.mine) conds.push(eq(capas.ownerId, ctx.userId));
  if (!f.status || f.status === "active") conds.push(inArray(capas.status, ["open", "in_progress", "verification"]));
  else if (f.status !== "all" && (Object.keys(CAPA_TRANSITIONS) as string[]).includes(f.status)) conds.push(eq(capas.status, f.status));
  const today = manilaToday();
  const rows = await db
    .select({
      id: capas.id,
      number: capas.capaNumber,
      status: capas.status,
      sourceKind: capas.sourceKind,
      sourceReference: capas.sourceReference,
      title: capas.title,
      dueDate: capas.dueDate,
      effectivenessDueOn: capas.effectivenessDueOn,
      ownerName: owner.displayName,
      siteCode: sites.code,
      createdAt: capas.createdAt,
      openActions: sql<number>`(select count(*)::int from ${capaActions} a where a.capa_id = ${capas.id} and a.status = 'open')`,
      overdueActions: sql<number>`(select count(*)::int from ${capaActions} a where a.capa_id = ${capas.id} and a.status = 'open' and a.due_date < ${today}::date)`,
    })
    .from(capas)
    .innerJoin(owner, eq(owner.id, capas.ownerId))
    .innerJoin(sites, eq(sites.id, capas.siteId))
    .where(and(...conds))
    .orderBy(desc(capas.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r, sourceLabel: CAPA_SOURCE_LABEL[r.sourceKind as CapaSource] ?? r.sourceKind, overdue: (r.dueDate && r.dueDate < today && !["closed", "cancelled"].includes(r.status)) || r.overdueActions > 0 }));
}

export async function getCapa(ctx: AuthContext, capaId: string) {
  ctx.require("quality.capa.view");
  assertUuid(capaId, "CAPA");
  const [row] = await db
    .select({ c: capas, ownerName: owner.displayName, createdByName: creator.displayName, siteCode: sites.code })
    .from(capas)
    .innerJoin(owner, eq(owner.id, capas.ownerId))
    .innerJoin(creator, eq(creator.id, capas.createdBy))
    .innerJoin(sites, eq(sites.id, capas.siteId))
    .where(and(eq(capas.id, capaId), eq(capas.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.c.siteId)) throw new DomainError("not_found", "CAPA not found in your sites.");
  const c = row.c;
  const actions = await db.select().from(capaActions).where(eq(capaActions.capaId, c.id)).orderBy(asc(capaActions.actionNo));
  const timeline = await db
    .select({ from: capaStateTransitions.fromState, to: capaStateTransitions.toState, reason: capaStateTransitions.reason, at: capaStateTransitions.occurredAt, by: users.displayName })
    .from(capaStateTransitions)
    .innerJoin(users, eq(users.id, capaStateTransitions.actorId))
    .where(eq(capaStateTransitions.capaId, c.id))
    .orderBy(asc(capaStateTransitions.occurredAt));
  const ids = [...new Set([c.submittedBy, c.closedBy, c.effectivenessCheckedBy, ...actions.flatMap((a) => [a.ownerId, a.completedBy, a.verifiedBy])].filter((x): x is string => !!x))];
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const nm = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : null);
  const deviation = c.deviationId ? ((await db.select({ id: deviations.id, number: deviations.deviationNumber, status: deviations.status }).from(deviations).where(eq(deviations.id, c.deviationId)).limit(1))[0] ?? null) : null;
  const complaint = c.complaintId ? ((await db.select({ id: complaints.id, number: complaints.complaintNumber, status: complaints.status }).from(complaints).where(eq(complaints.id, c.complaintId)).limit(1))[0] ?? null) : null;
  const today = manilaToday();
  const live = ["open", "in_progress"].includes(c.status);
  const qa = ctx.canAt("quality.capa.submit", c.siteId);
  const blockers = c.status === "in_progress" ? capaSubmitBlockers(c, actions) : [];
  return {
    capa: { ...c, ownerName: row.ownerName, createdByName: row.createdByName, siteCode: row.siteCode, sourceLabel: CAPA_SOURCE_LABEL[c.sourceKind as CapaSource] ?? c.sourceKind, submittedByName: nm(c.submittedBy), closedByName: nm(c.closedBy), effectivenessCheckedByName: nm(c.effectivenessCheckedBy) },
    deviation,
    complaint,
    actions: actions.map((a) => ({
      ...a,
      ownerName: nm(a.ownerId),
      completedByName: nm(a.completedBy),
      verifiedByName: nm(a.verifiedBy),
      overdue: isActionOverdue(a, today),
      canComplete: c.status === "in_progress" && a.status === "open" && (qa || (a.ownerId === ctx.userId && ctx.canAt("quality.capa.view", c.siteId))),
      canVerify: c.status === "in_progress" && a.status === "done" && qa && a.completedBy !== ctx.userId,
      canReopen: c.status === "in_progress" && a.status === "done" && qa,
      canCancel: c.status === "in_progress" && (a.status === "open" || a.status === "done") && qa,
    })),
    timeline,
    owners: live ? await usersHoldingAt(db, ctx.organizationId, "quality.capa.view", c.siteId) : [],
    effectivenessCheckDays: await getSetting(db, ctx.organizationId, "quality.capa.effectiveness_check_days", c.siteId),
    submitBlockers: blockers,
    today,
    can: {
      edit: live && (qa || (c.ownerId === ctx.userId && ctx.canAt("quality.capa.create", c.siteId))),
      reassign: live && qa,
      addAction: live && (qa || ctx.canAt("quality.capa.create", c.siteId)),
      submit: c.status === "in_progress" && qa && blockers.length === 0,
      recordEffectiveness: c.status === "verification" && qa && !c.effectivenessResult && (!c.effectivenessDueOn || today >= c.effectivenessDueOn),
      close: c.status === "verification" && ctx.canAt("quality.capa.approve", c.siteId) && c.effectivenessResult === "effective" && c.submittedBy !== ctx.userId,
      closeBlockedReason:
        c.status !== "verification" || !ctx.canAt("quality.capa.approve", c.siteId)
          ? null
          : c.effectivenessResult !== "effective"
            ? c.effectivenessDueOn && today < c.effectivenessDueOn
              ? `The effectiveness check is due on ${c.effectivenessDueOn}.`
              : "Record the effectiveness check first."
            : c.submittedBy === ctx.userId
              ? "You submitted this CAPA for closure; another person must close it."
              : null,
      cancel: live && ctx.canAt("quality.capa.approve", c.siteId),
    },
  };
}

/** Pre-filled context for the "Open CAPA" form (from a deviation or complaint page). */
export async function capaFormContext(ctx: AuthContext, ref: { deviationId?: string | null; complaintId?: string | null }) {
  ctx.require("quality.capa.create");
  let deviation: { id: string; number: string; description: string; siteId: string; rootCause: string | null } | null = null;
  let complaint: { id: string; number: string; description: string; siteId: string } | null = null;
  if (ref.deviationId && isUuid(ref.deviationId)) {
    const [d] = await db.select().from(deviations).where(and(eq(deviations.id, ref.deviationId), eq(deviations.organizationId, ctx.organizationId))).limit(1);
    if (d && ctx.allowedSiteIds.includes(d.siteId)) deviation = { id: d.id, number: d.deviationNumber, description: d.description, siteId: d.siteId, rootCause: d.rootCause };
  }
  if (ref.complaintId && isUuid(ref.complaintId) && ctx.can("quality.complaint.view")) {
    const [c] = await db.select().from(complaints).where(and(eq(complaints.id, ref.complaintId), eq(complaints.organizationId, ctx.organizationId))).limit(1);
    if (c && ctx.allowedSiteIds.includes(c.siteId)) complaint = { id: c.id, number: c.complaintNumber, description: c.description, siteId: c.siteId };
  }
  const siteId = deviation?.siteId ?? complaint?.siteId ?? ctx.currentSiteId;
  return {
    deviation,
    complaint,
    siteId,
    owners: await usersHoldingAt(db, ctx.organizationId, "quality.capa.view", siteId),
    sites: ctx.allowedSites.filter((s) => ctx.canAt("quality.capa.create", s.id)),
    sources: CAPA_SOURCES.map((s) => ({ code: s, label: CAPA_SOURCE_LABEL[s] })),
  };
}

/** Open CAPA actions past their due date, organization-wide (action centre `overdue_capa_action`). */
export async function overdueCapaActionCandidates(organizationId: string, now: Date = new Date()) {
  const today = manilaToday(now);
  const rows = await db
    .select({ id: capaActions.id, siteId: capaActions.siteId, actionNo: capaActions.actionNo, dueDate: capaActions.dueDate, description: capaActions.description, capaId: capas.id, capaNumber: capas.capaNumber, ownerName: users.displayName })
    .from(capaActions)
    .innerJoin(capas, eq(capas.id, capaActions.capaId))
    .innerJoin(users, eq(users.id, capaActions.ownerId))
    .where(and(eq(capaActions.organizationId, organizationId), eq(capaActions.status, "open"), sql`${capaActions.dueDate} < ${today}::date`, inArray(capas.status, ["open", "in_progress"])));
  return rows.map((r) => ({
    kind: "overdue_capa_action",
    siteId: r.siteId,
    entityType: "capa_action",
    entityId: r.id,
    recordNumber: `${r.capaNumber}/${r.actionNo}`,
    title: `CAPA ${r.capaNumber} action ${r.actionNo} overdue since ${r.dueDate}`,
    detail: `${r.ownerName}: ${r.description.slice(0, 160)}`,
    link: `/quality/capa/${r.capaId}`,
    openedAt: new Date(r.dueDate + "T16:00:00Z"),
  }));
}

/** CAPAs in verification whose effectiveness check is due and not recorded (shown with the overdue items). */
export async function capaEffectivenessDue(q: DbOrTx, organizationId: string, today: string) {
  return q
    .select({ id: capas.id, siteId: capas.siteId, n: capas.capaNumber, due: capas.effectivenessDueOn })
    .from(capas)
    .where(and(eq(capas.organizationId, organizationId), eq(capas.status, "verification"), isNull(capas.effectivenessResult), sql`${capas.effectivenessDueOn} <= ${today}::date`));
}

/** CSV/XLSX export of CAPAs at the user's sites (quality.capa.view; audited by runExport). */
export const capaExport: ExportDefinition<{ status?: string }, Awaited<ReturnType<typeof listCapas>>[number]> = {
  code: "quality.capas",
  title: "CAPA register",
  permission: "quality.capa.view",
  sensitivity: "S",
  columns: [
    { header: "CAPA", value: (r) => r.number },
    { header: "Status", value: (r) => r.status },
    { header: "Source", value: (r) => r.sourceLabel },
    { header: "Reference", value: (r) => r.sourceReference },
    { header: "Title", value: (r) => r.title },
    { header: "Owner", value: (r) => r.ownerName, personalData: true },
    { header: "Due", value: (r) => r.dueDate },
    { header: "Open actions", value: (r) => r.openActions, numeric: true },
    { header: "Overdue actions", value: (r) => r.overdueActions, numeric: true },
    { header: "Effectiveness check due", value: (r) => r.effectivenessDueOn },
    { header: "Site", value: (r) => r.siteCode },
  ],
  fetch: async (ctx, f, limit) => (await listCapas(ctx, { status: f.status ?? "all" })).slice(0, limit),
  siteScope: (ctx) => ctx.allowedSiteIds,
  fileName: () => "capa-register",
};
