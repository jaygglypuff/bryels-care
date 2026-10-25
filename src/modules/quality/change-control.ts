import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { CHANGE_CONTROL_ENTITY_TYPES, capas, changeControlStateTransitions, changeControls, sites, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { notifyRoles } from "@/modules/platform";
import { CHANGE_CONTROL_STATUS_LABEL, CHANGE_ENTITY_LABEL, type ChangeControlEntityType, type ChangeControlStatus, canMoveChangeControl } from "./capa-rules";
import { canDecideQualityStep, qualityApprovalProgress, recordQualityDecision } from "./recall-cases-approvals";
import { assertUuid, isIsoDate, isUuid, optionalText, reasonText, requiredText } from "./shared";

/**
 * Change control (US-6-18, FR-quality-07): a proposal to change a versioned record (formula, routing,
 * inspection-plan or work-instruction revision of W1D, or an unversioned "other" change) with impact
 * assessment, risk level (QA-configured list), approval through `approval_rules` (`change_control`,
 * default one QA step, approver ≠ submitter) and implementation tracking. The change itself is made
 * through the record's own revision workflow; this record never edits a revision. "Implemented"
 * requires the linked revision to be approved; closure is by a person other than the implementer.
 */

type CcRow = typeof changeControls.$inferSelect;
const creator = alias(users, "cc_creator");

const DOCUMENT_TYPE = "change_control" as const;

/** The linked revision: label, status and page (validated against the organization). */
export async function resolveChangeEntity(q: DbOrTx, organizationId: string, entityType: string, entityId: string): Promise<{ label: string; status: string; href: string } | null> {
  if (!isUuid(entityId)) return null;
  let rows: Record<string, unknown>[] = [];
  switch (entityType) {
    case "formula_revision":
      rows = (await q.execute(sql`select r.status, f.code, f.name, r.revision_no, f.id as parent_id from formula_revisions r join formulas f on f.id = r.formula_id where r.id = ${entityId}::uuid and f.organization_id = ${organizationId}::uuid`)) as unknown as Record<string, unknown>[];
      return rows[0] ? { label: `Formula ${rows[0].code} rev ${rows[0].revision_no} (${rows[0].name})`, status: String(rows[0].status), href: `/masterdata/formulas/${rows[0].parent_id}/revisions/${entityId}` } : null;
    case "routing_revision":
      rows = (await q.execute(sql`select r.status, x.code, x.name, r.revision_no, x.id as parent_id from routing_revisions r join routings x on x.id = r.routing_id where r.id = ${entityId}::uuid and x.organization_id = ${organizationId}::uuid`)) as unknown as Record<string, unknown>[];
      return rows[0] ? { label: `Routing ${rows[0].code} rev ${rows[0].revision_no} (${rows[0].name})`, status: String(rows[0].status), href: `/masterdata/routings/${rows[0].parent_id}/revisions/${entityId}` } : null;
    case "inspection_plan":
      rows = (await q.execute(sql`select status, code, name, revision_no from inspection_plans where id = ${entityId}::uuid and organization_id = ${organizationId}::uuid`)) as unknown as Record<string, unknown>[];
      return rows[0] ? { label: `Inspection plan ${rows[0].code} rev ${rows[0].revision_no} (${rows[0].name})`, status: String(rows[0].status), href: `/masterdata/inspection-plans/${entityId}` } : null;
    case "work_instruction_revision":
      rows = (await q.execute(sql`select r.status, w.code, w.name, r.revision_no, w.id as parent_id from work_instruction_revisions r join work_instructions w on w.id = r.work_instruction_id where r.id = ${entityId}::uuid and w.organization_id = ${organizationId}::uuid`)) as unknown as Record<string, unknown>[];
      return rows[0] ? { label: `Work instruction ${rows[0].code} rev ${rows[0].revision_no} (${rows[0].name})`, status: String(rows[0].status), href: `/masterdata/work-instructions/${rows[0].parent_id}` } : null;
    default:
      return null;
  }
}

/** Revisions that can be linked: draft, pending or approved, newest first (for the form's picker). */
export async function changeEntityOptions(q: DbOrTx, organizationId: string, entityType: string) {
  let rows: Record<string, unknown>[] = [];
  switch (entityType) {
    case "formula_revision":
      rows = (await q.execute(sql`select r.id, 'Formula ' || f.code || ' rev ' || r.revision_no || ' (' || r.status || ')' as label from formula_revisions r join formulas f on f.id = r.formula_id where f.organization_id = ${organizationId}::uuid and r.status in ('draft','pending_approval','approved') order by f.code, r.revision_no desc limit 200`)) as unknown as Record<string, unknown>[];
      break;
    case "routing_revision":
      rows = (await q.execute(sql`select r.id, 'Routing ' || x.code || ' rev ' || r.revision_no || ' (' || r.status || ')' as label from routing_revisions r join routings x on x.id = r.routing_id where x.organization_id = ${organizationId}::uuid and r.status in ('draft','pending_approval','approved') order by x.code, r.revision_no desc limit 200`)) as unknown as Record<string, unknown>[];
      break;
    case "inspection_plan":
      rows = (await q.execute(sql`select id, 'Inspection plan ' || code || ' rev ' || revision_no || ' (' || status || ')' as label from inspection_plans where organization_id = ${organizationId}::uuid and status in ('draft','pending_approval','approved') order by code, revision_no desc limit 200`)) as unknown as Record<string, unknown>[];
      break;
    case "work_instruction_revision":
      rows = (await q.execute(sql`select r.id, 'Work instruction ' || w.code || ' rev ' || r.revision_no || ' (' || r.status || ')' as label from work_instruction_revisions r join work_instructions w on w.id = r.work_instruction_id where w.organization_id = ${organizationId}::uuid and r.status in ('draft','pending_approval','approved') order by w.code, r.revision_no desc limit 200`)) as unknown as Record<string, unknown>[];
      break;
  }
  return rows.map((r) => ({ id: String(r.id), label: String(r.label) }));
}

function visible(ctx: AuthContext, cc: { siteId: string | null }) {
  return !cc.siteId || ctx.allowedSiteIds.includes(cc.siteId);
}

function requireHere(ctx: AuthContext, p: Permission, cc: { siteId: string | null }) {
  if (cc.siteId) ctx.requireAt(p, cc.siteId);
  else ctx.require(p);
}

function canHere(ctx: AuthContext, p: Permission, cc: { siteId: string | null }) {
  return cc.siteId ? ctx.canAt(p, cc.siteId) : ctx.can(p);
}

async function lockCc(tx: Tx, ctx: AuthContext, id: string): Promise<CcRow> {
  assertUuid(id, "Change control");
  const [c] = await tx.select().from(changeControls).where(and(eq(changeControls.id, id), eq(changeControls.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!c || !visible(ctx, c)) throw new DomainError("not_found", "Change control not found in your sites.");
  return c;
}

async function move(tx: Tx, ctx: AuthContext, c: CcRow, to: ChangeControlStatus, reason: string | null, set: Partial<typeof changeControls.$inferInsert> = {}) {
  if (!canMoveChangeControl(c.status, to)) throw new DomainError("state", `Change ${c.changeNumber} is ${CHANGE_CONTROL_STATUS_LABEL[c.status as ChangeControlStatus]?.toLowerCase() ?? c.status}; it cannot move to ${CHANGE_CONTROL_STATUS_LABEL[to].toLowerCase()}.`);
  await tx.update(changeControls).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(changeControls.id, c.id));
  await tx.insert(changeControlStateTransitions).values({ organizationId: ctx.organizationId, siteId: c.siteId, changeControlId: c.id, fromState: c.status, toState: to, actorId: ctx.userId, reason });
  const from = c.status;
  Object.assign(c, set, { status: to });
  return from;
}

/* ------------------------------------------------------------------ commands */

export type CreateChangeControlInput = {
  title: string;
  description: string;
  justification: string;
  entityType: string;
  entityId?: string | null;
  capaId?: string | null;
  /** Site the change concerns; null = organization-wide (master data such as a formula). */
  siteId?: string | null;
  targetDate?: string | null;
  idempotencyKey?: string | null;
};

export async function createChangeControl(ctx: AuthContext, input: CreateChangeControlInput) {
  ctx.require("quality.change_control.create");
  const title = requiredText(input.title, "title", "A title", 200);
  const description = reasonText(input.description, "description", 4000);
  const justification = reasonText(input.justification, "justification", 4000);
  if (!(CHANGE_CONTROL_ENTITY_TYPES as readonly string[]).includes(input.entityType)) throw new DomainError("validation", "Choose what is being changed.", { field: "entityType" });
  const siteId = input.siteId && isUuid(input.siteId) ? input.siteId : null;
  if (siteId) ctx.requireAt("quality.change_control.create", siteId);
  const targetDate = input.targetDate?.trim() || null;
  if (targetDate && !isIsoDate(targetDate)) throw new DomainError("validation", "Enter a valid date.", { field: "targetDate" });
  if (input.idempotencyKey && input.idempotencyKey.length > 200) throw new DomainError("validation", "The request key is too long.");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"cc:" + input.idempotencyKey}))`);
      const [dup] = await tx.select({ id: changeControls.id, n: changeControls.changeNumber }).from(changeControls).where(and(eq(changeControls.organizationId, ctx.organizationId), eq(changeControls.idempotencyKey, input.idempotencyKey))).limit(1);
      if (dup) return { changeControlId: dup.id, changeNumber: dup.n, replayed: true };
    }
    let entityLabel: string | null = null;
    if (input.entityId) {
      if (input.entityType === "other") throw new DomainError("validation", "An “other” change has no linked revision.", { field: "entityId" });
      const e = await resolveChangeEntity(tx, ctx.organizationId, input.entityType, input.entityId);
      if (!e) throw new DomainError("validation", "The linked revision was not found.", { field: "entityId" });
      entityLabel = e.label;
    }
    if (input.capaId) {
      assertUuid(input.capaId, "CAPA");
      const [c] = await tx.select({ id: capas.id, siteId: capas.siteId }).from(capas).where(and(eq(capas.id, input.capaId), eq(capas.organizationId, ctx.organizationId))).limit(1);
      if (!c || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("validation", "The CAPA was not found in your sites.", { field: "capaId" });
    }
    const changeNumber = await nextNumber(tx, ctx.organizationId, "CC");
    const [c] = await tx
      .insert(changeControls)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        changeNumber,
        status: "draft",
        title,
        description,
        justification,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel,
        capaId: input.capaId ?? null,
        targetDate,
        createdBy: ctx.userId,
        statusChangedBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await tx.insert(changeControlStateTransitions).values({ organizationId: ctx.organizationId, siteId, changeControlId: c.id, fromState: null, toState: "draft", actorId: ctx.userId, reason: title });
    await audit(tx, ctx, { action: "quality.change_control.created", entityType: "change_control", entityId: c.id, entityNumber: changeNumber, siteId, reason: justification, after: { title, entityType: c.entityType, entityId: c.entityId, entityLabel, capaId: c.capaId } });
    return { changeControlId: c.id, changeNumber, replayed: false };
  });
}

export type UpdateChangeControlInput = {
  changeControlId: string;
  title?: string | null;
  description?: string | null;
  justification?: string | null;
  impactAssessment?: string | null;
  riskLevel?: string | null;
  implementationPlan?: string | null;
  targetDate?: string | null;
  /** The implementing revision; may be (re)linked until the change is implemented. */
  entityId?: string | null;
};

/**
 * Edits the proposal while it is a draft (creator or a submitter); the implementing revision link may be
 * set while the change is draft, under review or approved (the revision usually exists only after approval).
 */
export async function updateChangeControl(ctx: AuthContext, input: UpdateChangeControlInput) {
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    const contentKeys = ["title", "description", "justification", "impactAssessment", "riskLevel", "implementationPlan", "targetDate"] as const;
    const editsContent = contentKeys.some((k) => input[k] !== undefined);
    const set: Partial<typeof changeControls.$inferInsert> = {};
    if (editsContent) {
      if (c.status !== "draft") throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; only a draft can be edited. Ask the approver to return it.`);
      if (c.createdBy !== ctx.userId) requireHere(ctx, "quality.change_control.submit", c);
      else requireHere(ctx, "quality.change_control.create", c);
      if (input.title !== undefined && input.title !== null) set.title = requiredText(input.title, "title", "A title", 200);
      if (input.description !== undefined && input.description !== null) set.description = reasonText(input.description, "description", 4000);
      if (input.justification !== undefined && input.justification !== null) set.justification = reasonText(input.justification, "justification", 4000);
      if (input.impactAssessment !== undefined) set.impactAssessment = optionalText(input.impactAssessment, "impactAssessment", 6000);
      if (input.implementationPlan !== undefined) set.implementationPlan = optionalText(input.implementationPlan, "implementationPlan", 4000);
      if (input.riskLevel !== undefined) {
        const levels = await getSetting(tx, ctx.organizationId, "quality.change_control.risk_levels");
        if (input.riskLevel && !levels.includes(input.riskLevel)) throw new DomainError("validation", "Choose a risk level.", { field: "riskLevel" });
        set.riskLevel = input.riskLevel || null;
      }
      if (input.targetDate !== undefined) {
        const d = input.targetDate?.trim() || null;
        if (d && !isIsoDate(d)) throw new DomainError("validation", "Enter a valid date.", { field: "targetDate" });
        set.targetDate = d;
      }
    }
    if (input.entityId !== undefined) {
      if (!["draft", "submitted", "approved"].includes(c.status)) throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; the implementing revision can no longer be changed.`);
      requireHere(ctx, c.createdBy === ctx.userId ? "quality.change_control.create" : "quality.change_control.submit", c);
      if (c.entityType === "other") throw new DomainError("validation", "An “other” change has no linked revision.", { field: "entityId" });
      if (input.entityId) {
        const e = await resolveChangeEntity(tx, ctx.organizationId, c.entityType, input.entityId);
        if (!e) throw new DomainError("validation", "The linked revision was not found.", { field: "entityId" });
        set.entityId = input.entityId;
        set.entityLabel = e.label;
      } else {
        set.entityId = null;
        set.entityLabel = null;
      }
    }
    if (Object.keys(set).length === 0) throw new DomainError("validation", "Nothing changed.");
    await tx.update(changeControls).set(set).where(eq(changeControls.id, c.id));
    await audit(tx, ctx, {
      action: "quality.change_control.updated",
      entityType: "change_control",
      entityId: c.id,
      entityNumber: c.changeNumber,
      siteId: c.siteId,
      before: Object.fromEntries(Object.keys(set).map((k) => [k, (c as Record<string, unknown>)[k]])),
      after: set,
    });
    return { changeControlId: c.id };
  });
}

/** draft → submitted: impact assessment and risk level are required; QA approvers are notified. */
export async function submitChangeControl(ctx: AuthContext, input: { changeControlId: string }) {
  ctx.require("quality.change_control.submit");
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    requireHere(ctx, "quality.change_control.submit", c);
    if (c.status !== "draft") throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; only a draft can be submitted.`);
    if (!c.impactAssessment) throw new DomainError("validation", "Write the impact assessment (product quality, regulatory, labels, stock, documents) before submitting.", { field: "impactAssessment" });
    if (!c.riskLevel) throw new DomainError("validation", "Choose the risk level before submitting.", { field: "riskLevel" });
    await move(tx, ctx, c, "submitted", null, { submittedBy: ctx.userId, submittedAt: new Date() });
    await audit(tx, ctx, { action: "quality.change_control.submitted", entityType: "change_control", entityId: c.id, entityNumber: c.changeNumber, siteId: c.siteId, before: { status: "draft" }, after: { status: "submitted", riskLevel: c.riskLevel } });
    const progress = await qualityApprovalProgress(tx, ctx.organizationId, { recordType: DOCUMENT_TYPE, recordId: c.id, siteId: c.siteId });
    const roles = progress.next?.roleCodes.length ? progress.next.roleCodes : ["qa_qc"];
    await notifyRoles(tx, { roleCodes: roles, siteId: c.siteId }, { organizationId: ctx.organizationId, siteId: c.siteId, kind: "quality.change_control.submitted", severity: "info", title: `Change ${c.changeNumber} waits for approval`, body: c.title, entityType: "change_control", entityId: c.id, link: `/quality/changes/${c.id}`, dedupeKey: `cc-submitted:${c.id}:${progress.cycle}` });
    return { status: "submitted" as const };
  });
}

/**
 * Records an approval decision (approval_rules `change_control`): approved (final step → approved),
 * rejected (terminal) or returned (back to draft for rework). Creator and submitter never approve.
 */
export async function decideChangeControl(ctx: AuthContext, input: { changeControlId: string; decision: "approved" | "rejected" | "returned"; note?: string | null }) {
  ctx.require("quality.change_control.approve");
  if (!["approved", "rejected", "returned"].includes(input.decision)) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    if (c.status !== "submitted") throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; only a change under review can be decided.`);
    const d = await recordQualityDecision(tx, ctx, { recordType: DOCUMENT_TYPE, recordId: c.id, recordNumber: c.changeNumber, siteId: c.siteId, pendingSince: c.submittedAt, excludedUserIds: [c.createdBy, c.submittedBy], decision: input.decision, note: input.note });
    const base = { entityType: "change_control", entityId: c.id, entityNumber: c.changeNumber, siteId: c.siteId } as const;
    if (input.decision === "rejected") {
      await move(tx, ctx, c, "rejected", input.note ?? null, { decidedAt: new Date() });
      await audit(tx, ctx, { ...base, action: "quality.change_control.rejected", reason: input.note, before: { status: "submitted" }, after: { status: "rejected", step: d.step?.step } });
      return { status: "rejected" as const };
    }
    if (input.decision === "returned") {
      await move(tx, ctx, c, "draft", input.note ?? null);
      await audit(tx, ctx, { ...base, action: "quality.change_control.returned", reason: input.note, before: { status: "submitted" }, after: { status: "draft", step: d.step?.step } });
      return { status: "draft" as const };
    }
    if (!d.final) {
      await audit(tx, ctx, { ...base, action: "quality.change_control.reviewed", reason: input.note, after: { step: d.step?.step, stepLabel: d.step?.label } });
      return { status: "submitted" as const, step: d.step?.step };
    }
    await move(tx, ctx, c, "approved", input.note ?? null, { decidedAt: new Date() });
    await audit(tx, ctx, { ...base, action: "quality.change_control.approved", reason: input.note, before: { status: "submitted" }, after: { status: "approved", step: d.step?.step } });
    return { status: "approved" as const };
  });
}

/**
 * approved → implemented: the implementer records what was done; a versioned change requires its linked
 * revision to be approved through the record's own workflow (V-REV); "other" needs the written note only.
 */
export async function implementChangeControl(ctx: AuthContext, input: { changeControlId: string; note: string }) {
  ctx.require("quality.change_control.submit");
  const note = reasonText(input.note, "note", 4000);
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    requireHere(ctx, "quality.change_control.submit", c);
    if (c.status !== "approved") throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; only an approved change can be implemented.`);
    let entityStatus: string | null = null;
    if (c.entityType !== "other") {
      if (!c.entityId) throw new DomainError("state", "Link the revision that implements this change first.", { field: "entityId" });
      const e = await resolveChangeEntity(tx, ctx.organizationId, c.entityType, c.entityId);
      if (!e) throw new DomainError("state", "The linked revision no longer exists.");
      entityStatus = e.status;
      if (e.status !== "approved") throw new DomainError("state", `${e.label} is ${e.status.replace(/_/g, " ")}. It must be approved through its own revision workflow before the change counts as implemented.`);
    }
    await move(tx, ctx, c, "implemented", note, { implementedBy: ctx.userId, implementedAt: new Date(), implementationNote: note });
    await audit(tx, ctx, { action: "quality.change_control.implemented", entityType: "change_control", entityId: c.id, entityNumber: c.changeNumber, siteId: c.siteId, reason: note, before: { status: "approved" }, after: { status: "implemented", entityType: c.entityType, entityId: c.entityId, entityStatus } });
    return { status: "implemented" as const };
  });
}

/** implemented → closed by a person other than the implementer (quality.change_control.approve). */
export async function closeChangeControl(ctx: AuthContext, input: { changeControlId: string; note?: string | null }) {
  ctx.require("quality.change_control.approve");
  const note = optionalText(input.note, "note", 2000);
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    requireHere(ctx, "quality.change_control.approve", c);
    if (c.status !== "implemented") throw new DomainError("state", `Change ${c.changeNumber} is ${c.status}; only an implemented change can be closed.`);
    if (c.implementedBy === ctx.userId) throw new DomainError("separation_of_duties", "You implemented this change, so another person must confirm and close it (separation of duties).");
    await move(tx, ctx, c, "closed", note, { closedBy: ctx.userId, closedAt: new Date(), closureNote: note });
    await audit(tx, ctx, { action: "quality.change_control.closed", entityType: "change_control", entityId: c.id, entityNumber: c.changeNumber, siteId: c.siteId, reason: note, before: { status: "implemented" }, after: { status: "closed" } });
    return { status: "closed" as const };
  });
}

/** Cancels a draft, a change under review or an approved change not yet implemented (creator or QA), with a reason. */
export async function cancelChangeControl(ctx: AuthContext, input: { changeControlId: string; reason: string }) {
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const c = await lockCc(tx, ctx, input.changeControlId);
    if (c.createdBy === ctx.userId) requireHere(ctx, "quality.change_control.create", c);
    else requireHere(ctx, "quality.change_control.approve", c);
    const from = await move(tx, ctx, c, "cancelled", reason, { cancelReason: reason });
    await audit(tx, ctx, { action: "quality.change_control.cancelled", entityType: "change_control", entityId: c.id, entityNumber: c.changeNumber, siteId: c.siteId, reason, before: { status: from }, after: { status: "cancelled" } });
    return { status: "cancelled" as const };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listChangeControls(ctx: AuthContext, f: { status?: string; entityId?: string } = {}) {
  ctx.require("quality.change_control.view");
  const conds = [eq(changeControls.organizationId, ctx.organizationId), or(isNull(changeControls.siteId), inArray(changeControls.siteId, ctx.allowedSiteIds))!];
  if (f.entityId && isUuid(f.entityId)) conds.push(eq(changeControls.entityId, f.entityId));
  if (!f.status || f.status === "active") conds.push(inArray(changeControls.status, ["draft", "submitted", "approved", "implemented"]));
  else if (f.status !== "all" && (Object.keys(CHANGE_CONTROL_STATUS_LABEL) as string[]).includes(f.status)) conds.push(eq(changeControls.status, f.status));
  const rows = await db
    .select({
      id: changeControls.id,
      number: changeControls.changeNumber,
      status: changeControls.status,
      title: changeControls.title,
      entityType: changeControls.entityType,
      entityLabel: changeControls.entityLabel,
      riskLevel: changeControls.riskLevel,
      targetDate: changeControls.targetDate,
      createdAt: changeControls.createdAt,
      createdByName: creator.displayName,
      siteCode: sites.code,
    })
    .from(changeControls)
    .innerJoin(creator, eq(creator.id, changeControls.createdBy))
    .leftJoin(sites, eq(sites.id, changeControls.siteId))
    .where(and(...conds))
    .orderBy(desc(changeControls.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r, entityTypeLabel: CHANGE_ENTITY_LABEL[r.entityType as ChangeControlEntityType] ?? r.entityType, statusLabel: CHANGE_CONTROL_STATUS_LABEL[r.status as ChangeControlStatus] ?? r.status }));
}

export async function getChangeControl(ctx: AuthContext, id: string) {
  ctx.require("quality.change_control.view");
  assertUuid(id, "Change control");
  const [row] = await db
    .select({ c: changeControls, createdByName: creator.displayName, siteCode: sites.code })
    .from(changeControls)
    .innerJoin(creator, eq(creator.id, changeControls.createdBy))
    .leftJoin(sites, eq(sites.id, changeControls.siteId))
    .where(and(eq(changeControls.id, id), eq(changeControls.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !visible(ctx, row.c)) throw new DomainError("not_found", "Change control not found in your sites.");
  const c = row.c;
  const ids = [c.submittedBy, c.implementedBy, c.closedBy].filter((x): x is string => !!x);
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const nm = (x: string | null) => (x ? (names.get(x) ?? "Unknown user") : null);
  const entity = c.entityId ? await resolveChangeEntity(db, ctx.organizationId, c.entityType, c.entityId) : null;
  const capa = c.capaId ? ((await db.select({ id: capas.id, number: capas.capaNumber, status: capas.status }).from(capas).where(eq(capas.id, c.capaId)).limit(1))[0] ?? null) : null;
  const timeline = await db
    .select({ from: changeControlStateTransitions.fromState, to: changeControlStateTransitions.toState, reason: changeControlStateTransitions.reason, at: changeControlStateTransitions.occurredAt, by: users.displayName })
    .from(changeControlStateTransitions)
    .innerJoin(users, eq(users.id, changeControlStateTransitions.actorId))
    .where(eq(changeControlStateTransitions.changeControlId, c.id))
    .orderBy(asc(changeControlStateTransitions.occurredAt));
  const approval = await qualityApprovalProgress(db, ctx.organizationId, { recordType: DOCUMENT_TYPE, recordId: c.id, siteId: c.siteId });
  const draftEditor = c.status === "draft" && (c.createdBy === ctx.userId ? canHere(ctx, "quality.change_control.create", c) : canHere(ctx, "quality.change_control.submit", c));
  return {
    change: { ...c, createdByName: row.createdByName, siteCode: row.siteCode, submittedByName: nm(c.submittedBy), implementedByName: nm(c.implementedBy), closedByName: nm(c.closedBy), statusLabel: CHANGE_CONTROL_STATUS_LABEL[c.status as ChangeControlStatus] ?? c.status, entityTypeLabel: CHANGE_ENTITY_LABEL[c.entityType as ChangeControlEntityType] ?? c.entityType },
    entity,
    capa,
    approval,
    timeline,
    riskLevels: await getSetting(db, ctx.organizationId, "quality.change_control.risk_levels"),
    entityOptions: c.entityType !== "other" && ["draft", "submitted", "approved"].includes(c.status) ? await changeEntityOptions(db, ctx.organizationId, c.entityType) : [],
    can: {
      edit: draftEditor,
      link: ["draft", "submitted", "approved"].includes(c.status) && c.entityType !== "other" && (c.createdBy === ctx.userId ? canHere(ctx, "quality.change_control.create", c) : canHere(ctx, "quality.change_control.submit", c)),
      submit: c.status === "draft" && canHere(ctx, "quality.change_control.submit", c),
      decide: c.status === "submitted" && canDecideQualityStep(ctx, DOCUMENT_TYPE, approval, c.submittedAt, [c.createdBy, c.submittedBy]),
      implement: c.status === "approved" && canHere(ctx, "quality.change_control.submit", c),
      implementBlockedReason:
        c.status !== "approved"
          ? null
          : c.entityType === "other"
            ? null
            : !entity
              ? "Link the revision that implements this change."
              : entity.status !== "approved"
                ? `${entity.label} is ${entity.status.replace(/_/g, " ")}; approve it through its own workflow first.`
                : null,
      close: c.status === "implemented" && canHere(ctx, "quality.change_control.approve", c) && c.implementedBy !== ctx.userId,
      cancel: ["draft", "submitted", "approved"].includes(c.status) && (c.createdBy === ctx.userId ? canHere(ctx, "quality.change_control.create", c) : canHere(ctx, "quality.change_control.approve", c)),
    },
  };
}

export async function changeControlFormContext(ctx: AuthContext, ref: { capaId?: string | null; entityType?: string | null; entityId?: string | null }) {
  ctx.require("quality.change_control.create");
  const entityType = ref.entityType && (CHANGE_CONTROL_ENTITY_TYPES as readonly string[]).includes(ref.entityType) ? ref.entityType : "formula_revision";
  let capa: { id: string; number: string } | null = null;
  if (ref.capaId && isUuid(ref.capaId) && ctx.can("quality.capa.view")) {
    const [c] = await db.select({ id: capas.id, number: capas.capaNumber, siteId: capas.siteId }).from(capas).where(and(eq(capas.id, ref.capaId), eq(capas.organizationId, ctx.organizationId))).limit(1);
    if (c && ctx.allowedSiteIds.includes(c.siteId)) capa = { id: c.id, number: c.number };
  }
  const options: Record<string, { id: string; label: string }[]> = {};
  for (const t of CHANGE_CONTROL_ENTITY_TYPES) if (t !== "other") options[t] = await changeEntityOptions(db, ctx.organizationId, t);
  return {
    capa,
    entityType,
    entityId: ref.entityId && isUuid(ref.entityId) ? ref.entityId : null,
    entityTypes: CHANGE_CONTROL_ENTITY_TYPES.map((t) => ({ code: t, label: CHANGE_ENTITY_LABEL[t] })),
    options,
    sites: ctx.allowedSites.filter((s) => ctx.canAt("quality.change_control.create", s.id)),
  };
}

/** Change controls under review (action centre `approval.change_control`). */
export async function changeControlApprovalCandidates(organizationId: string) {
  const rows = await db.select().from(changeControls).where(and(eq(changeControls.organizationId, organizationId), eq(changeControls.status, "submitted")));
  return rows.map((r) => ({
    kind: "approval.change_control",
    siteId: r.siteId,
    entityType: "change_control",
    entityId: r.id,
    recordNumber: r.changeNumber,
    title: `Change ${r.changeNumber} waits for approval`,
    detail: `${r.title}${r.riskLevel ? ` · risk ${r.riskLevel}` : ""}`,
    link: `/quality/changes/${r.id}`,
    openedAt: r.submittedAt ?? r.statusChangedAt,
  }));
}
