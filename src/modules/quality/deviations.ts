import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  DEVIATION_SOURCES,
  batches,
  deviationHolds,
  deviationStateTransitions,
  deviations,
  dispenseRecords,
  batchMaterials,
  inspections,
  inventoryLots,
  processStepRecords,
  qualityHolds,
  testResults,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { holdReasonOptions, placeHold } from "@/modules/inventory";
import { notifyRoles } from "@/modules/platform";
import { assertUuid, isIsoDate, isUuid, optionalText, reasonText, requiredText } from "./shared";

/**
 * Deviations from any step, lot or batch, containment holds and closure with separation of duties
 * (US-3-21, process map W07-01..05). State machine: open → investigating → closed; open → closed.
 * A deviation that is not closed blocks release of its batch and lot (US-3-15); closing records
 * QA's conclusion `releasePermitted`, which decides whether the affected product may still be released.
 * CAPA (W07-04) arrives in Phase 6 (US-6-18).
 */

export type DeviationSource = (typeof DEVIATION_SOURCES)[number];
export type DeviationStatus = "open" | "investigating" | "closed";

export const DEVIATION_TRANSITIONS: Record<DeviationStatus, readonly DeviationStatus[]> = {
  open: ["investigating", "closed"],
  investigating: ["closed"],
  closed: [],
};

export const DEVIATION_SOURCE_LABEL: Record<DeviationSource, string> = {
  manual: "Raised by a person",
  cx_tol: "Over-tolerance weighing exception (CX-TOL)",
  cx_cal: "Calibration exception (CX-CAL)",
  in_process_check: "Failed in-process check",
  yield: "Yield out of range",
  reconciliation: "Reconciliation mismatch",
  oos: "Out-of-specification result (OOS)",
  other: "Other automatic trigger",
  complaint: "Customer complaint",
};

type DeviationRow = typeof deviations.$inferSelect;
const raiser = alias(users, "deviation_raiser");
const closer = alias(users, "deviation_closer");
const classifier = alias(users, "deviation_classifier");

async function writeTransition(tx: Tx, ctx: AuthContext, d: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(deviationStateTransitions).values({ organizationId: ctx.organizationId, siteId: d.siteId, deviationId: d.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

async function lockDeviation(tx: Tx, ctx: AuthContext, deviationId: string) {
  assertUuid(deviationId, "Deviation");
  const [d] = await tx.select().from(deviations).where(and(eq(deviations.id, deviationId), eq(deviations.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!d || !ctx.allowedSiteIds.includes(d.siteId)) throw new DomainError("not_found", "Deviation not found in your sites.");
  ctx.requireSite(d.siteId);
  return d;
}

async function move(tx: Tx, ctx: AuthContext, d: DeviationRow, to: DeviationStatus, reason: string | null, set: Partial<typeof deviations.$inferInsert>) {
  if (!DEVIATION_TRANSITIONS[d.status as DeviationStatus]?.includes(to)) {
    throw new DomainError("state", `Deviation ${d.deviationNumber} is ${d.status}; it cannot move to ${to}.`);
  }
  await tx
    .update(deviations)
    .set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId })
    .where(eq(deviations.id, d.id));
  await writeTransition(tx, ctx, d, d.status, to, reason);
  d.status = to;
}

/* ------------------------------------------------------------------ open */

export type OpenDeviationInput = {
  batchId?: string | null;
  lotId?: string | null;
  /** Where in the batch it happened, e.g. "Step 3 Saponification" or a routing step code. */
  stepRef?: string | null;
  processStepRecordId?: string | null;
  dispenseRecordId?: string | null;
  inspectionId?: string | null;
  testResultId?: string | null;
  source?: DeviationSource;
  description: string;
  /** Retry key (ADR-009): the same key returns the first deviation. */
  idempotencyKey?: string | null;
};

/**
 * Opens a deviation (W07-01). Public entry point for other modules: the execution stream calls it
 * for CX-TOL, CX-CAL, failed in-process checks, yield out of range and reconciliation mismatches,
 * inside its own transaction when it passes `opts.tx`. References are validated against the
 * caller's organization and sites; the deviation's site is the batch's (else the lot's).
 */
export async function openDeviation(ctx: AuthContext, input: OpenDeviationInput, opts: { tx?: Tx } = {}) {
  ctx.require("quality.deviation.create");
  const description = reasonText(input.description, "description", 4000);
  const stepRef = optionalText(input.stepRef, "stepRef", 200);
  const source: DeviationSource = input.source ?? (input.testResultId ? "oos" : "manual");
  if (!(DEVIATION_SOURCES as readonly string[]).includes(source)) throw new DomainError("validation", "Unknown deviation source.", { field: "source" });
  if (!input.batchId && !input.lotId) throw new DomainError("validation", "Name the batch or the lot the deviation is about.", { field: "batchId" });
  for (const [k, v] of Object.entries({ batchId: input.batchId, lotId: input.lotId, processStepRecordId: input.processStepRecordId, dispenseRecordId: input.dispenseRecordId, inspectionId: input.inspectionId, testResultId: input.testResultId })) {
    if (v && !isUuid(v)) throw new DomainError("not_found", "A referenced record was not found in your sites.", { field: k });
  }
  if (input.idempotencyKey && input.idempotencyKey.length > 200) throw new DomainError("validation", "The request key is too long.");

  const run = async (tx: Tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"dev:" + input.idempotencyKey}))`);
      const [dup] = await tx
        .select({ id: deviations.id, n: deviations.deviationNumber, siteId: deviations.siteId })
        .from(deviations)
        .where(and(eq(deviations.organizationId, ctx.organizationId), eq(deviations.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (dup) {
        ctx.requireSite(dup.siteId);
        return { deviationId: dup.id, deviationNumber: dup.n, replayed: true };
      }
    }
    let siteId: string | null = null;
    let batchNumber: string | null = null;
    let lotNumber: string | null = null;
    let inspectionId = input.inspectionId ?? null;
    if (input.batchId) {
      const [b] = await tx.select().from(batches).where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
      if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found in your sites.", { field: "batchId" });
      siteId = b.siteId;
      batchNumber = b.batchNumber;
    }
    if (input.lotId) {
      const [l] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).limit(1);
      if (!l || !ctx.allowedSiteIds.includes(l.siteId)) throw new DomainError("not_found", "Lot not found in your sites.", { field: "lotId" });
      siteId ??= l.siteId;
      lotNumber = l.lotNumber;
    }
    ctx.requireSite(siteId!);
    if (input.processStepRecordId) {
      const [p] = await tx.select({ batchId: processStepRecords.batchId }).from(processStepRecords).where(eq(processStepRecords.id, input.processStepRecordId)).limit(1);
      if (!p || p.batchId !== input.batchId) throw new DomainError("validation", "The step record does not belong to this batch.", { field: "processStepRecordId" });
    }
    if (input.dispenseRecordId) {
      const [p] = await tx
        .select({ batchId: batchMaterials.batchId })
        .from(dispenseRecords)
        .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
        .where(eq(dispenseRecords.id, input.dispenseRecordId))
        .limit(1);
      if (!p || p.batchId !== input.batchId) throw new DomainError("validation", "The weighing record does not belong to this batch.", { field: "dispenseRecordId" });
    }
    if (input.testResultId) {
      const [r] = await tx.select({ batchId: testResults.batchId, inspectionId: testResults.inspectionId }).from(testResults).where(eq(testResults.id, input.testResultId)).limit(1);
      if (!r) throw new DomainError("not_found", "Result not found in your sites.", { field: "testResultId" });
      if (r.inspectionId) {
        const [i] = await tx.select({ lotId: inspections.lotId, batchId: inspections.batchId, siteId: inspections.siteId }).from(inspections).where(eq(inspections.id, r.inspectionId)).limit(1);
        if (i.siteId !== siteId || (i.batchId ? i.batchId !== input.batchId : i.lotId !== input.lotId)) throw new DomainError("validation", "The result does not belong to this batch or lot.", { field: "testResultId" });
        inspectionId ??= r.inspectionId;
      } else if (r.batchId !== input.batchId) {
        throw new DomainError("validation", "The result does not belong to this batch.", { field: "testResultId" });
      }
    }
    if (inspectionId) {
      const [i] = await tx.select({ siteId: inspections.siteId }).from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.organizationId, ctx.organizationId))).limit(1);
      if (!i || i.siteId !== siteId) throw new DomainError("validation", "The inspection does not belong to this site.", { field: "inspectionId" });
    }

    const deviationNumber = await nextNumber(tx, ctx.organizationId, "DEV");
    const [d] = await tx
      .insert(deviations)
      .values({
        organizationId: ctx.organizationId,
        siteId: siteId!,
        deviationNumber,
        status: "open",
        source,
        description,
        stepRef,
        batchId: input.batchId ?? null,
        lotId: input.lotId ?? null,
        processStepRecordId: input.processStepRecordId ?? null,
        dispenseRecordId: input.dispenseRecordId ?? null,
        inspectionId,
        testResultId: input.testResultId ?? null,
        raisedBy: ctx.userId,
        statusChangedBy: ctx.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    await writeTransition(tx, ctx, d, null, "open", description);
    await audit(tx, ctx, {
      action: "quality.deviation.opened",
      entityType: "deviation",
      entityId: d.id,
      entityNumber: deviationNumber,
      siteId: siteId!,
      reason: description,
      after: { source, batch: batchNumber, lot: lotNumber, stepRef, processStepRecordId: d.processStepRecordId, dispenseRecordId: d.dispenseRecordId, inspectionId, testResultId: d.testResultId },
    });
    await notifyRoles(
      tx,
      { roleCodes: ["qa_qc"], siteId: siteId! },
      {
        organizationId: ctx.organizationId,
        siteId: siteId!,
        kind: "quality.deviation.opened",
        severity: "warning",
        title: `Deviation ${deviationNumber} raised${batchNumber ? ` on batch ${batchNumber}` : lotNumber ? ` on lot ${lotNumber}` : ""}`,
        body: description,
        entityType: "deviation",
        entityId: d.id,
        link: `/quality/deviations/${d.id}`,
        dedupeKey: `deviation-opened:${d.id}`,
      },
    );
    return { deviationId: d.id, deviationNumber, replayed: false };
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/* ------------------------------------------------------------------ classify, investigate, close */

async function severityLevels(q: DbOrTx, ctx: AuthContext) {
  return getSetting(q, ctx.organizationId, "quality.deviation.severity_levels");
}

/** Classification and investigation by QA (W07-01 severity, W07-03): open → investigating. */
export async function startInvestigation(ctx: AuthContext, input: { deviationId: string; severity: string; investigation: string; impactAssessment?: string | null }) {
  ctx.require("quality.deviation.submit");
  const investigation = requiredText(input.investigation, "investigation", "The investigation plan", 4000);
  const impactAssessment = optionalText(input.impactAssessment, "impactAssessment", 4000);
  return db.transaction(async (tx) => {
    const d = await lockDeviation(tx, ctx, input.deviationId);
    const levels = await severityLevels(tx, ctx);
    if (!levels.includes(input.severity)) throw new DomainError("validation", "Choose the severity.", { field: "severity" });
    await move(tx, ctx, d, "investigating", investigation, { severity: input.severity, classifiedBy: ctx.userId, classifiedAt: new Date(), investigation, impactAssessment });
    await audit(tx, ctx, { action: "quality.deviation.updated", entityType: "deviation", entityId: d.id, entityNumber: d.deviationNumber, siteId: d.siteId, before: { status: "open", severity: d.severity }, after: { status: "investigating", severity: input.severity, investigation, impactAssessment } });
    return { status: d.status };
  });
}

/** Updates the investigation record while the deviation is not closed (W07-03). */
export async function updateInvestigation(ctx: AuthContext, input: { deviationId: string; severity?: string | null; investigation?: string | null; impactAssessment?: string | null; rootCause?: string | null }) {
  ctx.require("quality.deviation.submit");
  return db.transaction(async (tx) => {
    const d = await lockDeviation(tx, ctx, input.deviationId);
    if (d.status === "closed") throw new DomainError("state", `Deviation ${d.deviationNumber} is closed; raise a new deviation for new findings.`);
    const set: Partial<typeof deviations.$inferInsert> = {};
    if (input.severity) {
      if (!(await severityLevels(tx, ctx)).includes(input.severity)) throw new DomainError("validation", "Choose the severity.", { field: "severity" });
      set.severity = input.severity;
      set.classifiedBy = ctx.userId;
      set.classifiedAt = new Date();
    }
    if (input.investigation !== undefined) set.investigation = optionalText(input.investigation, "investigation", 4000);
    if (input.impactAssessment !== undefined) set.impactAssessment = optionalText(input.impactAssessment, "impactAssessment", 4000);
    if (input.rootCause !== undefined) set.rootCause = optionalText(input.rootCause, "rootCause", 4000);
    if (Object.keys(set).length === 0) throw new DomainError("validation", "Nothing to update.");
    await tx.update(deviations).set(set).where(eq(deviations.id, d.id));
    await audit(tx, ctx, {
      action: "quality.deviation.updated",
      entityType: "deviation",
      entityId: d.id,
      entityNumber: d.deviationNumber,
      siteId: d.siteId,
      before: { severity: d.severity, investigation: d.investigation, impactAssessment: d.impactAssessment, rootCause: d.rootCause },
      after: set,
    });
    return { deviationId: d.id };
  });
}

export type CloseDeviationInput = { deviationId: string; rootCause: string; resolution: string; releasePermitted: boolean; effectivenessCheckOn?: string | null };

/**
 * Closes a deviation (W07-05, G-W07-B): quality.deviation.approve, never the raiser, after
 * classification, with root cause, resolution and QA's release conclusion; every containment hold
 * placed for it must be lifted first (the affected stock is dispositioned through W06).
 */
export async function closeDeviation(ctx: AuthContext, input: CloseDeviationInput) {
  ctx.require("quality.deviation.approve");
  const rootCause = requiredText(input.rootCause, "rootCause", "Root cause", 4000);
  const resolution = requiredText(input.resolution, "resolution", "Resolution", 4000);
  if (typeof input.releasePermitted !== "boolean") throw new DomainError("validation", "State whether the affected product may still be released.", { field: "releasePermitted" });
  const effectivenessCheckOn = input.effectivenessCheckOn ? input.effectivenessCheckOn : null;
  if (effectivenessCheckOn && !isIsoDate(effectivenessCheckOn)) throw new DomainError("validation", "Enter a valid date.", { field: "effectivenessCheckOn" });
  return db.transaction(async (tx) => {
    const d = await lockDeviation(tx, ctx, input.deviationId);
    if (d.status === "closed") throw new DomainError("state", `Deviation ${d.deviationNumber} is already closed.`);
    ctx.assertSeparation(d.raisedBy === ctx.userId, "You raised this deviation, so another QA user must close it (separation of duties).");
    if (!d.severity) throw new DomainError("state", "Classify the deviation's severity before closing it.", { field: "severity" });
    const open = await tx
      .select({ n: qualityHolds.holdNumber })
      .from(deviationHolds)
      .innerJoin(qualityHolds, eq(qualityHolds.id, deviationHolds.qualityHoldId))
      .where(and(eq(deviationHolds.deviationId, d.id), inArray(qualityHolds.status, ["open", "investigating"])));
    if (open.length) throw new DomainError("state", `Containment hold(s) ${open.map((h) => h.n).join(", ")} are still open. Decide the held stock and lift the hold(s) first.`);
    const now = new Date();
    await move(tx, ctx, d, "closed", resolution, { rootCause, resolution, releasePermitted: input.releasePermitted, effectivenessCheckOn, closedBy: ctx.userId, closedAt: now });
    await audit(tx, ctx, {
      action: "quality.deviation.closed",
      entityType: "deviation",
      entityId: d.id,
      entityNumber: d.deviationNumber,
      siteId: d.siteId,
      reason: resolution,
      before: { status: d.status === "closed" ? "investigating" : d.status },
      after: { status: "closed", rootCause, resolution, releasePermitted: input.releasePermitted, effectivenessCheckOn },
    });
    return { status: "closed" as const };
  });
}

export type ContainInput = { deviationId: string; scope: "lot" | "location"; lotRef?: string | null; locationId?: string | null; reasonCode?: string | null; reason: string; idempotencyKey: string };

/**
 * Containment (W07-02): places a W1B quality hold on a lot or location and links it to the deviation.
 * The hold is its own transaction (placeHold); the link is idempotent, so a retry with the same key
 * replays the hold and completes the link.
 */
export async function containDeviation(ctx: AuthContext, input: ContainInput) {
  ctx.require("quality.hold.create");
  const reason = reasonText(input.reason);
  const d = await db.transaction((tx) => lockDeviation(tx, ctx, input.deviationId));
  if (d.status === "closed") throw new DomainError("state", `Deviation ${d.deviationNumber} is closed.`);
  let lotRef = input.lotRef?.trim() || null;
  if (input.scope === "lot" && !lotRef) {
    if (d.lotId) lotRef = d.lotId;
    else if (d.batchId) {
      const [b] = await db.select({ outputLotId: batches.outputLotId }).from(batches).where(eq(batches.id, d.batchId)).limit(1);
      lotRef = b?.outputLotId ?? null;
    }
    if (!lotRef) throw new DomainError("validation", "Scan or type the lot to hold.", { field: "lotRef" });
  }
  const holdCodes = await holdReasonOptions(db, ctx.organizationId);
  const reasonCode = input.reasonCode && holdCodes.some((r) => r.code === input.reasonCode) ? input.reasonCode : "investigation";
  const hold = await placeHold(ctx, { scope: input.scope, lotRef: lotRef ?? undefined, locationId: input.locationId ?? undefined, reasonCode, reason: `Deviation ${d.deviationNumber}: ${reason}`, idempotencyKey: input.idempotencyKey });
  await db.transaction(async (tx) => {
    const again = await lockDeviation(tx, ctx, d.id);
    const inserted = await tx.insert(deviationHolds).values({ deviationId: again.id, qualityHoldId: hold.holdId, createdBy: ctx.userId }).onConflictDoNothing().returning({ id: deviationHolds.id });
    if (inserted.length) {
      await audit(tx, ctx, { action: "quality.deviation.contained", entityType: "deviation", entityId: again.id, entityNumber: again.deviationNumber, siteId: again.siteId, reason, after: { holdId: hold.holdId, holdNumber: hold.holdNumber, scope: input.scope, lots: hold.lots } });
    }
  });
  return { holdId: hold.holdId, holdNumber: hold.holdNumber, replayed: hold.replayed };
}

/* ------------------------------------------------------------------ release facts */

export type DeviationFacts = { open: { id: string; number: string; status: string }[]; notPermitted: { id: string; number: string }[]; permittedResultIds: Set<string> };

/** Deviations naming the batch or any of the lots: what blocks release and which failed results an OOS closure excuses. */
export async function deviationFacts(q: DbOrTx, subject: { batchId?: string | null; lotIds: string[] }): Promise<DeviationFacts> {
  const conds = [];
  if (subject.batchId) conds.push(eq(deviations.batchId, subject.batchId));
  if (subject.lotIds.length) conds.push(inArray(deviations.lotId, subject.lotIds));
  if (!conds.length) return { open: [], notPermitted: [], permittedResultIds: new Set() };
  const rows = await q
    .select({ id: deviations.id, number: deviations.deviationNumber, status: deviations.status, releasePermitted: deviations.releasePermitted, testResultId: deviations.testResultId })
    .from(deviations)
    .where(or(...conds))
    .orderBy(asc(deviations.deviationNumber));
  return {
    open: rows.filter((r) => r.status !== "closed").map((r) => ({ id: r.id, number: r.number, status: r.status })),
    notPermitted: rows.filter((r) => r.status === "closed" && r.releasePermitted === false).map((r) => ({ id: r.id, number: r.number })),
    permittedResultIds: new Set(rows.filter((r) => r.status === "closed" && r.releasePermitted === true && r.testResultId).map((r) => r.testResultId!)),
  };
}

/** Human blockers from deviation facts (shared by lot and batch release). */
export function deviationBlockerMessages(f: DeviationFacts): string[] {
  const out: string[] = [];
  for (const d of f.open) out.push(`Deviation ${d.number} is ${d.status}; it must be closed before release.`);
  for (const d of f.notPermitted) out.push(`Deviation ${d.number} was closed with the conclusion that the product may not be released.`);
  return out;
}

/* ------------------------------------------------------------------ queries */

export async function listDeviations(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("quality.deviation.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const conds = [eq(deviations.siteId, siteId), eq(deviations.organizationId, ctx.organizationId)];
  if (!f.status || f.status === "active") conds.push(inArray(deviations.status, ["open", "investigating"]));
  else if (["open", "investigating", "closed"].includes(f.status)) conds.push(eq(deviations.status, f.status));
  return db
    .select({
      id: deviations.id,
      number: deviations.deviationNumber,
      status: deviations.status,
      source: deviations.source,
      severity: deviations.severity,
      description: deviations.description,
      stepRef: deviations.stepRef,
      raisedAt: deviations.raisedAt,
      raisedByName: raiser.displayName,
      batchId: batches.id,
      batchNumber: batches.batchNumber,
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      releasePermitted: deviations.releasePermitted,
      holdCount: sql<number>`(select count(*)::int from ${deviationHolds} dh where dh.deviation_id = ${deviations.id})`,
    })
    .from(deviations)
    .innerJoin(raiser, eq(raiser.id, deviations.raisedBy))
    .leftJoin(batches, eq(batches.id, deviations.batchId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, deviations.lotId))
    .where(and(...conds))
    .orderBy(desc(deviations.raisedAt))
    .limit(300);
}

export async function getDeviation(ctx: AuthContext, deviationId: string) {
  ctx.require("quality.deviation.view");
  assertUuid(deviationId, "Deviation");
  const [row] = await db
    .select({ d: deviations, raisedByName: raiser.displayName, closedByName: closer.displayName, classifiedByName: classifier.displayName, batchNumber: batches.batchNumber, batchStatus: batches.status, lotNumber: inventoryLots.lotNumber, lotStatus: inventoryLots.qualityStatus })
    .from(deviations)
    .innerJoin(raiser, eq(raiser.id, deviations.raisedBy))
    .leftJoin(closer, eq(closer.id, deviations.closedBy))
    .leftJoin(classifier, eq(classifier.id, deviations.classifiedBy))
    .leftJoin(batches, eq(batches.id, deviations.batchId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, deviations.lotId))
    .where(and(eq(deviations.id, deviationId), eq(deviations.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.d.siteId)) throw new DomainError("not_found", "Deviation not found in your sites.");
  ctx.requireSite(row.d.siteId);
  const d = row.d;
  const holds = await db
    .select({ id: qualityHolds.id, number: qualityHolds.holdNumber, status: qualityHolds.status, resolution: qualityHolds.resolution, openedAt: qualityHolds.openedAt })
    .from(deviationHolds)
    .innerJoin(qualityHolds, eq(qualityHolds.id, deviationHolds.qualityHoldId))
    .where(eq(deviationHolds.deviationId, d.id))
    .orderBy(asc(qualityHolds.openedAt));
  const timeline = await db
    .select({ from: deviationStateTransitions.fromState, to: deviationStateTransitions.toState, reason: deviationStateTransitions.reason, at: deviationStateTransitions.occurredAt, by: users.displayName })
    .from(deviationStateTransitions)
    .innerJoin(users, eq(users.id, deviationStateTransitions.actorId))
    .where(eq(deviationStateTransitions.deviationId, d.id))
    .orderBy(asc(deviationStateTransitions.occurredAt));
  const result = d.testResultId ? ((await db.select({ id: testResults.id, testName: testResults.testName, result: testResults.result, specification: testResults.specification, passed: testResults.passed }).from(testResults).where(eq(testResults.id, d.testResultId)).limit(1))[0] ?? null) : null;
  const inspection = d.inspectionId ? ((await db.select({ id: inspections.id, number: inspections.inspectionNumber, status: inspections.status }).from(inspections).where(eq(inspections.id, d.inspectionId)).limit(1))[0] ?? null) : null;
  const levels = await severityLevels(db, ctx);
  const active = d.status !== "closed";
  const openHolds = holds.filter((h) => h.status !== "closed");
  return {
    deviation: { ...d, raisedByName: row.raisedByName, closedByName: row.closedByName, classifiedByName: row.classifiedByName, sourceLabel: DEVIATION_SOURCE_LABEL[d.source as DeviationSource] ?? d.source },
    batch: d.batchId ? { id: d.batchId, number: row.batchNumber!, status: row.batchStatus! } : null,
    lot: d.lotId ? { id: d.lotId, number: row.lotNumber!, status: row.lotStatus! } : null,
    result,
    inspection,
    holds,
    timeline,
    severityLevels: levels,
    holdReasonCodes: await holdReasonOptions(db, ctx.organizationId),
    can: {
      investigate: d.status === "open" && ctx.can("quality.deviation.submit"),
      update: active && ctx.can("quality.deviation.submit"),
      contain: active && ctx.can("quality.hold.create"),
      close: active && ctx.can("quality.deviation.approve") && !ctx.sodConflict(d.raisedBy) && !!d.severity && openHolds.length === 0,
      closeBlockedReason: !active || !ctx.can("quality.deviation.approve")
        ? null
        : d.raisedBy === ctx.userId
          ? "You raised this deviation; another QA user must close it."
          : !d.severity
            ? "Classify the severity first (start the investigation)."
            : openHolds.length
              ? `Lift containment hold(s) ${openHolds.map((h) => h.number).join(", ")} first.`
              : null,
    },
  };
}

/** Deviations of a batch or of lots, for the release pages. */
export async function deviationsFor(q: DbOrTx, subject: { batchId?: string | null; lotIds: string[] }) {
  const conds = [];
  if (subject.batchId) conds.push(eq(deviations.batchId, subject.batchId));
  if (subject.lotIds.length) conds.push(inArray(deviations.lotId, subject.lotIds));
  if (!conds.length) return [];
  return q
    .select({ id: deviations.id, number: deviations.deviationNumber, status: deviations.status, severity: deviations.severity, description: deviations.description, stepRef: deviations.stepRef, source: deviations.source, releasePermitted: deviations.releasePermitted, raisedAt: deviations.raisedAt })
    .from(deviations)
    .where(or(...conds))
    .orderBy(desc(deviations.raisedAt));
}

/** Options for the "raise deviation" sheet, pre-filled from the page the user came from. */
export async function deviationFormContext(ctx: AuthContext, ref: { batchId?: string | null; lotId?: string | null }) {
  ctx.require("quality.deviation.create");
  let batch: { id: string; number: string; steps: { stepNo: number; name: string }[] } | null = null;
  let lot: { id: string; number: string } | null = null;
  if (ref.batchId && isUuid(ref.batchId)) {
    const [b] = await db.select().from(batches).where(and(eq(batches.id, ref.batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
    if (b && ctx.allowedSiteIds.includes(b.siteId)) {
      const steps = ((b.formulaSnapshot as { steps?: { stepNo: number; name: string }[] }).steps ?? []).map((s) => ({ stepNo: s.stepNo, name: s.name }));
      batch = { id: b.id, number: b.batchNumber, steps };
    }
  }
  if (ref.lotId && isUuid(ref.lotId)) {
    const [l] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, ref.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).limit(1);
    if (l && ctx.allowedSiteIds.includes(l.siteId)) lot = { id: l.id, number: l.lotNumber };
  }
  return { batch, lot };
}

/** CSV/XLSX export of the current site's deviations (quality.deviation.export, S; audited by runExport). */
export const deviationExport: ExportDefinition<{ status?: string }, Awaited<ReturnType<typeof listDeviations>>[number]> = {
  code: "quality.deviations",
  title: "Deviations",
  permission: "quality.deviation.export",
  sensitivity: "S",
  columns: [
    { header: "Deviation", value: (r) => r.number },
    { header: "Status", value: (r) => r.status },
    { header: "Source", value: (r) => r.source },
    { header: "Severity", value: (r) => r.severity },
    { header: "Batch", value: (r) => r.batchNumber },
    { header: "Lot", value: (r) => r.lotNumber },
    { header: "Step", value: (r) => r.stepRef },
    { header: "Description", value: (r) => r.description },
    { header: "Raised at", value: (r) => r.raisedAt.toISOString() },
    { header: "Raised by", value: (r) => r.raisedByName, personalData: true },
    { header: "Release permitted", value: (r) => (r.releasePermitted === null ? "" : r.releasePermitted ? "yes" : "no") },
    { header: "Containment holds", value: (r) => r.holdCount, numeric: true },
  ],
  fetch: async (ctx, f, limit) => (await listDeviations(ctx, { status: f.status ?? "all" })).slice(0, limit),
  siteScope: (ctx) => [ctx.currentSiteId],
  fileName: () => "deviations",
};
