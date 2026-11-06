import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  approvalDecisions,
  auditEvents,
  locations,
  stockMovements,
  workOrders,
  batchAmendments,
  batchClosures,
  batchMaterials,
  batchPaperRecords,
  batchReopenRequests,
  batchStateTransitions,
  batches,
  dispenseRecords,
  dispositions,
  fileAttachments,
  inventoryLots,
  labelJobs,
  organizations,
  processStepRecords,
  products,
  qualityHoldLots,
  qualityHolds,
  roles,
  routingSteps,
  sites,
  testResults,
  userSiteAssignments,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import {
  documentsForSource,
  generateForSource,
  renderPreview,
  resolveTemplateVersion,
  type BmrData,
  type SourceTemplate,
} from "@/modules/documents";
import { bmrBatchOutputs, bmrDeviations, bmrEquipmentUses, bmrInspections, bmrLineClearanceChecks, bmrPackagingReconciliations, bmrProcessReadings, bmrYieldRecord } from "./bmr-sources";
import { currentBoxPlan } from "./batch-boxes";
import { toleranceRange } from "./dispensing";
import { batchMaterialChanges } from "./material-swaps";
import { packagingLinesOf } from "./packaging-flow";
import { auditSentence, batchStateWord, plainReason } from "./record-words";
import { cap, madeVsBoxedWords, num, outputKindWord, packagingToleranceWords, pct, pct2, placeNamesInText, qty, rangeWords, signedQty, stepKindWord, toleranceWords } from "./bmr-words";
import { plainRole } from "@/lib/role-words";
import { type FormulaSnapshot, idempotent } from "./shared";

/**
 * BMR generation (US-3-17, US-3-18; docs/reports-and-templates.md §1.3 `bmr/v1`, §2, §2.6).
 *
 * buildBmrDataset reads the batch snapshot (formula, BOM lines, routing steps, plan) and the
 * batch's own records under the caller's AuthContext and formats every value; the documents
 * module renders it with the pinned template version, numbers it (DOC), hashes it and records who
 * and when. A batch keeps the template version of its first BMR; before that, the version that was
 * effective when the batch was created (§11.1 item 4).
 */

export const BMR_KIND = "bmr";
export const PAPER_PAGE_KIND = "bmr_paper_page";

/**
 * Finding 5 (live check 2026-11-06): a batch still being made prints a working copy of everything recorded so far,
 * marked with this watermark; it is not stored, has no number and no checksum. "Generate BMR" stays for the record.
 */
export const BMR_WORKING_COPY_WATERMARK = "IN PROGRESS — NOT THE FINAL RECORD";
export const BMR_WORKING_COPY_STATES = ["draft", "planned", "materials_staged", "in_process", "rework_approved"] as const;

/** Watermark word for a batch state (A-RPT-04, docs/reports-and-templates.md §2.6). */
export function bmrWatermark(status: string, reopenCount = 0): string {
  switch (status) {
    case "draft":
    case "planned":
      return "DRAFT";
    case "materials_staged":
    case "in_process":
      return "IN PROGRESS";
    case "awaiting_qc":
    case "quarantined":
      return "UNDER QA REVIEW";
    case "released":
    case "rejected":
    case "rework_approved":
      return reopenCount > 0 ? `AMENDMENT IN PROGRESS – rev ${reopenCount}` : "FINAL – PENDING CLOSURE";
    case "closed":
      return reopenCount > 0 ? `AMENDED rev ${reopenCount}` : "CONTROLLED COPY";
    default:
      return status.toUpperCase();
  }
}

const g1 = (v: Decimal.Value | null | undefined) => fmtQty(v, "", 1);
const at = (v: Date | string | null | undefined) => (v ? fmtDateTime(v) : null);
const maxDate = (dates: (Date | string | null | undefined)[]) =>
  dates.reduce<Date>((m, v) => {
    if (!v) return m;
    const d = v instanceof Date ? v : new Date(v);
    return d > m ? d : m;
  }, new Date(0));

async function names(q: DbOrTx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await q.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

type RoleSpan = { userId: string; name: string; code: string; from: Date; to: Date | null; revokedAt: Date | null };

/**
 * Roles of the signers at the batch site (or organization-wide), so the printed record says "name, role, time"
 * (BMR renderer v2). The role valid at the signature time wins; otherwise any role the person held there.
 */
async function siteRoles(q: DbOrTx, siteId: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows: RoleSpan[] = list.length
    ? (
        await q
          .select({ userId: userSiteAssignments.userId, name: roles.name, code: roles.code, from: userSiteAssignments.validFrom, to: userSiteAssignments.validTo, revokedAt: userSiteAssignments.revokedAt, siteId: userSiteAssignments.siteId, orgWide: userSiteAssignments.isOrganizationWide })
          .from(userSiteAssignments)
          .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
          .where(inArray(userSiteAssignments.userId, list))
      ).filter((r) => r.orgWide || r.siteId === siteId)
    : [];
  return (id: string | null | undefined, when?: Date | string | null): string | null => {
    if (!id) return null;
    const mine = rows.filter((r) => r.userId === id);
    if (!mine.length) return null;
    const t = when ? new Date(when) : null;
    const valid = t ? mine.filter((r) => r.from <= t && (!r.to || r.to > t) && (!r.revokedAt || r.revokedAt > t)) : [];
    const pick = valid.length ? valid : mine.filter((r) => !r.revokedAt).length ? mine.filter((r) => !r.revokedAt) : mine;
    // One role word source (finding 7): "Machine operator" as on the Users screen, never the bundle name.
    return [...new Set(pick.map((r) => plainRole(r.code, r.name)))].sort().join(" / ");
  };
}

/** Batch of the caller's organization and sites; not_found otherwise (no existence leak). */
export async function visibleBatch(q: DbOrTx, ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new DomainError("not_found", "Batch not found in your sites.");
  const [row] = await q
    .select({ batch: batches, product: products, siteCode: sites.code })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .innerJoin(sites, eq(sites.id, batches.siteId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.batch.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
  return row;
}

/** Executed reopens and closures of a batch (closure state lives in src/db/schema/bmr.ts). */
export async function closureCounters(q: DbOrTx, batchId: string) {
  const closures = await q.select().from(batchClosures).where(eq(batchClosures.batchId, batchId)).orderBy(asc(batchClosures.closureNo));
  const reopens = await q.select().from(batchReopenRequests).where(eq(batchReopenRequests.batchId, batchId)).orderBy(asc(batchReopenRequests.requestedAt));
  const reopenCount = reopens.filter((r) => r.status === "reopened").length;
  return { closures, reopens, reopenCount, lastClosure: closures[closures.length - 1] ?? null };
}

export type BmrBuild = { data: BmrData; revisionAt: Date; status: string; siteId: string; siteCode: string; batchNumber: string; createdAt: Date; reopenCount: number };

/** Builds the frozen `bmr/v1` dataset. Reads only the batch snapshot and the batch's own records. */
export async function buildBmrDataset(q: DbOrTx, ctx: AuthContext, batchId: string): Promise<BmrBuild> {
  const { batch, product, siteCode } = await visibleBatch(q, ctx, batchId);
  const snap = batch.formulaSnapshot as FormulaSnapshot;

  // ADR-088 §3: packaging lines (status `packaging`) are not weighed; they appear in the packaging section.
  const mats = (await q.select().from(batchMaterials).where(eq(batchMaterials.batchId, batch.id)).orderBy(asc(batchMaterials.lineNo))).filter((m) => m.status !== "packaging");
  const disp = mats.length
    ? await q
        .select({ r: dispenseRecords, lotNumber: inventoryLots.lotNumber, supplierLot: inventoryLots.supplierLotNumber, expiresOn: inventoryLots.expiresOn })
        .from(dispenseRecords)
        .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
        .where(inArray(dispenseRecords.batchMaterialId, mats.map((m) => m.id)))
        .orderBy(asc(dispenseRecords.recordedAt))
    : [];
  const stepRecs = await q.select().from(processStepRecords).where(eq(processStepRecords.batchId, batch.id));
  const modes = snap.steps.length
    ? await q.select({ id: routingSteps.id, mode: routingSteps.recordMode }).from(routingSteps).where(inArray(routingSteps.id, snap.steps.map((s) => s.routingStepId)))
    : [];
  const transitions = await q.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, batch.id)).orderBy(asc(batchStateTransitions.at));
  const tests = await q.select().from(testResults).where(eq(testResults.batchId, batch.id)).orderBy(asc(testResults.testedAt));
  const disps = await q
    .select()
    .from(dispositions)
    .where(and(eq(dispositions.organizationId, ctx.organizationId), eq(dispositions.subjectType, "batch"), eq(dispositions.subjectId, batch.id)))
    .orderBy(asc(dispositions.decidedAt));
  const [outputLot] = batch.outputLotId ? await q.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1) : [];
  // ADR-080 §8: the Check quality record behind the latest decision (override reason, tester released).
  const [qcheck] = (await q.execute(sql`
    select decision, override_reason, tester_released, record_reviewed from batch_quality_checks
    where batch_id = ${batch.id} and decision in ('pass', 'fail') order by decided_at desc limit 1`)) as unknown as { decision: string; override_reason: string | null; tester_released: boolean; record_reviewed: boolean }[];
  const holds = outputLot
    ? await q
        .selectDistinct({ number: qualityHolds.holdNumber, reason: qualityHolds.reason, status: qualityHolds.status })
        .from(qualityHolds)
        .leftJoin(qualityHoldLots, eq(qualityHoldLots.qualityHoldId, qualityHolds.id))
        .where(and(or(eq(qualityHolds.lotId, outputLot.id), eq(qualityHoldLots.lotId, outputLot.id)), ne(qualityHolds.status, "closed")))
    : [];
  const { closures, reopens, reopenCount, lastClosure } = await closureCounters(q, batch.id);
  const amendments = await q.select().from(batchAmendments).where(eq(batchAmendments.batchId, batch.id)).orderBy(asc(batchAmendments.amendmentNo));
  const papers = await q
    .select({ p: batchPaperRecords, fileName: fileAttachments.fileName, sha: fileAttachments.checksumSha256 })
    .from(batchPaperRecords)
    .leftJoin(fileAttachments, eq(fileAttachments.id, batchPaperRecords.fileAttachmentId))
    .where(eq(batchPaperRecords.batchId, batch.id))
    .orderBy(asc(batchPaperRecords.pageNo));
  const approvals = reopens.length
    ? await q.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "batch_reopen"), inArray(approvalDecisions.recordId, reopens.map((r) => r.id)))).orderBy(asc(approvalDecisions.step))
    : [];
  const audits = await q
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, ctx.organizationId),
        or(
          eq(auditEvents.entityId, batch.id),
          and(eq(auditEvents.entityNumber, batch.batchNumber), inArray(auditEvents.entityType, ["dispense_record", "process_step_record", "batch", "batch_paper_record", "batch_amendment", "batch_reopen_request"])),
        ),
      ),
    )
    .orderBy(asc(auditEvents.occurredAt));
  const docs = await documentsForSource(q, ctx.organizationId, "batch", batch.id, [BMR_KIND, PAPER_PAGE_KIND]);
  // Finding 7: "Planned by" is the person who made the production order (the planner), not the approver whose
  // approval created the batch row. Batches without an order keep their creator.
  const [wo] = batch.workOrderId ? await q.select({ createdBy: workOrders.createdBy }).from(workOrders).where(eq(workOrders.id, batch.workOrderId)).limit(1) : [];
  const plannedById = wo?.createdBy ?? batch.createdBy;
  // Finding 4: samples QA kept out of the good pieces (retained sample movement at Finish).
  const [samplesRow] = await q
    .select({ qty: sql<string>`coalesce(sum(${stockMovements.qtyBase}), 0)::text` })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceDocumentType, "batch_retained_sample"), eq(stockMovements.sourceDocumentId, batch.id)));
  // Finding 3/8: place names, not codes ("QUA-01" → "QA waiting area").
  const placeRows = await q.select({ code: locations.code, name: locations.name }).from(locations).where(eq(locations.siteId, batch.siteId));
  const placeName = new Map(placeRows.filter((r) => r.name).map((r) => [r.code, r.name!]));

  // W2B / W2C sources (empty and `available: false` until those tables exist).
  const [lc, readings, equipmentUses, yieldRec, outputs, inspections, deviations, packagingRecs] = await Promise.all([
    bmrLineClearanceChecks(q, batch.id),
    bmrProcessReadings(q, batch.id),
    bmrEquipmentUses(q, batch.id),
    bmrYieldRecord(q, batch.id),
    bmrBatchOutputs(q, batch.id),
    bmrInspections(q, batch.id),
    bmrDeviations(q, batch.id),
    bmrPackagingReconciliations(q, batch.id),
  ]);

  const nm = await names(q, [
    batch.createdBy,
    plannedById,
    ...disp.flatMap((d) => [d.r.operatorId, d.r.checkerId]),
    ...stepRecs.flatMap((s) => [s.conductedBy, s.checkedBy]),
    ...transitions.map((t) => t.actorId),
    ...tests.map((t) => t.testedBy),
    ...disps.map((d) => d.decidedBy),
    ...amendments.map((a) => a.recordedBy),
    ...reopens.map((r) => r.requestedBy),
    ...approvals.map((a) => a.decidedBy),
    ...papers.flatMap((p) => [p.p.transcribedBy, p.p.reviewedBy]),
    ...audits.map((a) => a.actorId),
  ]);
  const who = (id: string | null | undefined) => (id ? (nm.get(id) ?? "Unknown user") : null);
  const roleOf = await siteRoles(q, batch.siteId, [
    ...disp.flatMap((d) => [d.r.operatorId, d.r.checkerId]),
    ...stepRecs.flatMap((s) => [s.conductedBy, s.checkedBy]),
    ...disps.map((d) => d.decidedBy),
  ]);

  // Renderer v2 extras (optional dataset fields): material changes, packaging taken, boxes, labels printed.
  const [changes, packagingTaken, boxPlan, labelRows] = await Promise.all([
    batchMaterialChanges(q, batch.id),
    packagingLinesOf(q, batch),
    currentBoxPlan(q, batch.id),
    q
      .select({ j: labelJobs, by: users.displayName })
      .from(labelJobs)
      .leftJoin(users, eq(users.id, labelJobs.printedBy))
      .where(
        and(
          eq(labelJobs.organizationId, ctx.organizationId),
          or(
            and(eq(labelJobs.entityType, "batch"), eq(labelJobs.entityId, batch.id)),
            and(eq(labelJobs.entityType, "batch_box"), sql`${labelJobs.entityId} in (select id from batch_boxes where batch_id = ${batch.id})`),
          ),
        ),
      )
      .orderBy(asc(labelJobs.requestedAt)),
  ]);

  // C: materials, grouped by phase in BOM order; names from the snapshot (batch snapshot rule).
  const snapLine = (bm: (typeof mats)[number]) => snap.lines.find((l) => l.bomLineId === bm.bomLineId) ?? snap.lines.find((l) => l.lineNo === bm.lineNo);
  const lines = mats.map((bm) => {
    const s = snapLine(bm);
    const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct, bm.toleranceAbsG);
    const recs = disp.filter((d) => d.r.batchMaterialId === bm.id);
    return {
      phase: s?.phaseCode ?? null,
      line: {
        lineNo: bm.lineNo,
        name: s?.materialName ?? "Unknown material",
        inci: s?.inciName ?? null,
        code: s?.materialCode ?? "",
        toleranceText: toleranceWords(min, max, bm.toleranceAbsG ? null : bm.tolerancePct, bm.toleranceAbsG ?? null),
        theoreticalText: g1(bm.theoreticalQtyG),
        actualText: recs.length ? g1(bm.dispensedQtyG) : "",
        status: bm.status,
        records: recs.map((d) => ({
          lotNumber: d.lotNumber,
          supplierLot: d.supplierLot ?? null,
          expiryText: d.expiresOn ? fmtDate(d.expiresOn) : "No expiry",
          actualText: g1(d.r.actualQtyG),
          withinTolerance: d.r.isWithinTolerance,
          scale: d.r.scaleCode ?? null,
          operator: who(d.r.operatorId) ?? "",
          at: fmtDateTime(d.r.recordedAt),
          checker: who(d.r.checkerId),
          operatorRole: roleOf(d.r.operatorId, d.r.recordedAt),
          checkerRole: roleOf(d.r.checkerId, d.r.checkedAt ?? d.r.recordedAt),
          checkedAt: at(d.r.checkedAt),
          exceptionReason: d.r.exceptionReason ?? null,
          // A voided weighing stays on the record, struck through with its reason (W2B voidDispense).
          struck: !!d.r.voidedAt,
          struckReason: d.r.voidedAt ? `Voided: ${d.r.voidReason ?? "reason not given"}` : null,
        })),
      },
      theo: new Decimal(bm.theoreticalQtyG),
      actual: new Decimal(bm.dispensedQtyG),
    };
  });
  const phases = [...new Set(lines.map((l) => l.phase))];
  const groups = phases.map((phase) => {
    const ls = lines.filter((l) => l.phase === phase);
    return {
      phase,
      lines: ls.map((l) => l.line),
      totalTheoreticalText: g1(ls.reduce((a, l) => a.plus(l.theo), new Decimal(0))),
      totalActualText: g1(ls.reduce((a, l) => a.plus(l.actual), new Decimal(0))),
    };
  });
  const totalTheo = lines.reduce((a, l) => a.plus(l.theo), new Decimal(0));
  const totalActual = lines.reduce((a, l) => a.plus(l.actual), new Decimal(0));
  const roundedSum = lines.reduce((a, l) => a.plus(l.theo.toDecimalPlaces(1)), new Decimal(0));
  const roundingNote = roundedSum.eq(totalTheo.toDecimalPlaces(1)) ? null : `Lines sum to ${g1(roundedSum)} g as displayed; the total is computed from unrounded values (F-05).`;

  // D / E: steps in routing order with their records.
  const steps = [...snap.steps]
    .sort((a, z) => a.stepNo - z.stepNo)
    .map((s) => {
      const r = stepRecs.find((x) => x.stepNo === s.stepNo);
      return {
        stepNo: s.stepNo,
        name: s.name,
        kindLabel: stepKindWord(s.stepKind),
        mode: (modes.find((m) => m.id === s.routingStepId)?.mode ?? "electronic").replace(/_/g, " "),
        instruction: s.instruction ?? null,
        workInstruction: s.workInstruction ? `${s.workInstruction.code} rev ${s.workInstruction.revisionNo}` : null,
        readings: r?.readings ?? null,
        conducted: r ? { name: who(r.conductedBy) ?? "", at: at(r.performedAt ?? r.completedAt), role: roleOf(r.conductedBy, r.performedAt ?? r.completedAt ?? r.startedAt) } : null,
        checked: r?.checkedBy ? { name: who(r.checkedBy) ?? "", at: at(r.checkedAt), role: roleOf(r.checkedBy, r.checkedAt) } : null,
        startText: at(r?.startedAt),
        endText: at(r?.completedAt),
        statusText: r ? (STEP_STATUS_WORD[r.status] ?? r.status.replace(/_/g, " ")) : "Not started",
        notes: r?.notes ? placeNamesInText(r.notes, placeName) : null,
      };
    });

  const disposition = [...disps].reverse().find((d) => ["release", "reject", "rework", "conditional_release"].includes(d.decision)) ?? null;
  const exceptions = lines.flatMap((l) =>
    l.line.records
      .filter((r) => !r.withinTolerance && !r.struck)
      .map((r) => `Weighing exception, ${l.line.name}: ${r.actualText} g vs ${l.line.theoreticalText} g (${l.line.toleranceText}). Reason: ${r.exceptionReason ?? "—"}`),
  );
  const y = yieldRec.rows[0];
  const testers = [...new Set(tests.map((t) => who(t.testedBy)).filter(Boolean))].join(", ");
  const controlledRecord = await getSetting(q, ctx.organizationId, "documents.controlled_record", batch.siteId);
  const latestDisposition = disposition ? { decidedBy: who(disposition.decidedBy) ?? "", decidedAt: fmtDateTime(disposition.decidedAt), role: roleOf(disposition.decidedBy, disposition.decidedAt) } : null;

  const data: BmrData = {
    schema: "bmr/v1",
    batch: {
      id: batch.id,
      number: batch.batchNumber,
      statusCode: batch.status,
      statusLabel: batchStateWord(batch.status),
      productName: product.name,
      productCode: product.skuCode,
      department: "PRODUCTION",
      formulaLabel: `${snap.formulaCode} rev ${snap.revisionNo}`,
      routingLabel: snap.routing ? `${snap.routing.routingCode} rev ${snap.routing.revisionNo}` : null,
      inspectionPlanLabel: snap.inspectionPlan ? `${snap.inspectionPlan.code} rev ${snap.inspectionPlan.revisionNo}` : null,
      batchSizeText: fmtQty(batch.plannedSizeG, "g", 0),
      plannedStartText: batch.plannedStartOn ? fmtDate(batch.plannedStartOn) : null,
      startText: batch.startedAt ? fmtDate(batch.startedAt).toUpperCase() : null,
      endText: batch.completedAt ? fmtDate(batch.completedAt).toUpperCase() : null,
      siteCode,
      createdBy: who(plannedById) ?? "",
      snapshotTakenText: fmtDateTime(snap.takenAt ?? batch.createdAt),
      reopenCount,
      closedText: batch.status === "closed" && lastClosure ? fmtDateTime(lastClosure.closedAt) : null,
      lotNumber: outputLot?.lotNumber ?? batch.outputLotNumber ?? null,
      revisionText: null, // set below, once the revision time is known
    },
    summary: {
      stepsDone: steps.filter((s) => s.conducted).length,
      stepsTotal: steps.length,
      openDeviations: deviations.available ? deviations.rows.filter((d) => d.status !== "closed").length : null,
      holds: holds.map((h) => `${h.number} (${h.status}): ${h.reason}`),
    },
    materials: {
      groups,
      totalTheoreticalText: g1(totalTheo),
      totalActualText: totalActual.gt(0) ? g1(totalActual) : "-",
      roundingNote,
      toleranceNote: "Tolerances are configuration to be verified by authorized personnel before production use.",
    },
    steps,
    lineClearance: {
      available: lc.available,
      rows: lc.rows.map((r) => ({ stepNo: r.stepNo, stepName: r.stepName, itemNo: r.itemNo, text: r.text, answer: cap(String(r.answer ?? "").replace(/_/g, " ")), note: r.note, by: r.answeredBy, at: at(r.answeredAt) })),
    },
    parameters: {
      available: readings.available,
      rows: readings.rows.map((r) => ({
        stepNo: r.stepNo,
        parameter: r.parameter,
        uom: r.uom,
        limits: rangeWords(r.min, r.target, r.max),
        value: /^-?\d+(\.\d+)?$/.test(r.value) ? num(r.value, 3) : cap(r.value),
        within: r.within,
        by: r.recordedBy,
        at: at(r.recordedAt),
        struck: r.superseded,
        struckReason: r.superseded ? `Corrected: ${r.correctionReason ?? "reason not given"}` : null,
      })),
    },
    equipment: {
      available: equipmentUses.available,
      rows: equipmentUses.rows.map((e) => ({ stepNo: e.stepNo, code: e.code, name: e.name, calibrationDue: e.calibrationDue && /^\d{4}-\d{2}-\d{2}/.test(e.calibrationDue) ? fmtDate(e.calibrationDue) : e.calibrationDue, cleaning: e.cleaning ? cap(e.cleaning.replace(/_/g, " ")) : e.cleaning, operator: e.operator, at: at(e.startedAt), exception: e.exceptionReason })),
    },
    packaging: {
      available: yieldRec.available || packagingRecs.available,
      rows: [
        // W2B packaging reconciliation: one line per component lot issued to the packaging step.
        ...packagingRecs.rows.map((p) => ({
          label: `${p.material}${p.lot ? ` (${p.lot})` : ""}`,
          value: `${qty(p.issued, p.uom, 3)} taken, ${p.used === null ? "—" : num(p.used, 3)} used, ${p.damaged === null ? "—" : num(p.damaged, 3)} damaged, ${p.returned === null ? "—" : num(p.returned, 3)} returned · difference ${p.variance === null ? "—" : signedQty(p.variance, p.uom, 3)} (${packagingToleranceWords(p.tolerance, p.uom)})${p.withinTolerance === false ? " — outside the allowed difference" : ""}${p.countedBy ? ` · counted by ${p.countedBy}` : ""}`,
        })),
        // Finding 4: why fewer pieces are in boxes than were made.
        ...(boxPlan.length && batch.actualUnits
          ? [{ label: "Made and boxed", value: madeVsBoxedWords(batch.actualUnits, boxPlan.reduce((t, r) => t + r.pieces, 0), boxPlan.length, samplesRow?.qty ?? 0, (product.family ?? "").toLowerCase().includes("soap") ? "bars" : "pieces", Decimal.max(new Decimal(batch.actualUnits).minus(samplesRow?.qty ?? 0).minus(boxPlan.reduce((t, r) => t + r.pieces, 0)), 0)) }]
          : []),
        ...(y && y.labelsIssued !== null
          ? [
            { label: "Labels issued", value: y.labelsIssued === null ? "—" : String(y.labelsIssued) },
            { label: "Labels used", value: y.labelsUsed === null ? "—" : String(y.labelsUsed) },
            { label: "Labels destroyed", value: y.labelsDestroyed === null ? "—" : String(y.labelsDestroyed) },
            {
              label: "Labels unaccounted",
              value: y.labelsIssued === null ? "—" : `${y.labelsIssued - (y.labelsUsed ?? 0) - (y.labelsDestroyed ?? 0)}${y.labelsIssued - (y.labelsUsed ?? 0) - (y.labelsDestroyed ?? 0) !== 0 ? " !" : ""}`,
            },
            ]
          : []),
        ...(y?.packagingNotes ? [{ label: "Notes", value: y.packagingNotes }] : []),
      ],
    },
    outputYield: {
      theoreticalText: `${fmtQty(batch.theoreticalYieldG, "g", 0)} (${pct(snap.theoreticalYieldPct)} of batch size)`,
      actualText: batch.actualOutputG ? fmtQty(batch.actualOutputG, "g", 0) : null,
      detailText: batch.actualOutputG ? `(${fmtQty(batch.actualUnits, "pcs", 0)} × ${fmtQty(product.unitNetMassG, "g", 0)}; ${fmtQty(batch.yieldPct, "%", 2)})` : null,
      expiryText: outputLot ? fmtDate(outputLot.expiresOn) : null,
      outputLot: outputLot?.lotNumber ?? null,
      yieldRecord: {
        available: yieldRec.available,
        rows: y
          ? [
              { label: "Theoretical", value: qty(y.theoretical, "g") },
              { label: "Actual", value: qty(y.actual, "g") },
              { label: "Difference", value: `${signedQty(y.variance, "g")}${y.variancePct ? ` (${pct2(y.variancePct)})` : ""}` },
              ...(y.yieldPct ? [{ label: "Yield", value: `${pct(y.yieldPct, 2)}${y.limitsText ? ` (allowed ${y.limitsText})` : ""}${y.withinLimits === false ? " — outside the allowed range" : ""}` }] : []),
              ...(y.actualUnits ? [{ label: "Pieces", value: qty(y.actualUnits, "pcs", 0) }] : []),
              { label: "Recorded by", value: y.recordedBy ?? "—" },
              { label: "Checked by", value: y.checkedBy ?? "—" },
              ...(y.approvedBy ? [{ label: "Out-of-range yield approved by", value: `${y.approvedBy}${y.approvalReason ? `: ${y.approvalReason}` : ""}` }] : []),
            ]
          : [],
      },
      outputs: {
        available: outputs.available,
        rows: outputs.rows.map((o) => ({ kind: outputKindWord(o.kind), item: o.item, qty: o.qtyBase !== null ? qty(o.qtyBase, o.uom, 3) : o.qty, lot: o.lot, location: o.location ? (placeName.get(o.location) ?? o.location) : null })),
      },
    },
    qc: {
      tests: tests.map((t) => ({ name: t.testName, spec: t.specification, result: t.result, passed: t.passed, testedBy: who(t.testedBy), at: at(t.testedAt) })),
      testDateText: tests[0] ? fmtDate(tests[0].testedAt) : null,
      conductedBy: testers || null,
      checkedBy: latestDisposition?.decidedBy ?? null,
      inspections: { available: inspections.available, rows: inspections.rows.map((i) => ({ number: i.number, plan: i.plan, status: i.status, sampledBy: i.sampledBy, reviewedBy: i.reviewedBy, at: at(i.reviewedAt) })) },
    },
    deviations: {
      available: deviations.available,
      rows: deviations.rows.map((d) => ({ number: d.number, kind: d.kind.replace(/_/g, " "), severity: d.severity, status: d.status, description: d.description, raisedBy: d.raisedBy, raisedAt: at(d.raisedAt), closedBy: d.closedBy, closedAt: at(d.closedAt) })),
    },
    exceptions,
    materialChanges: changes.map((c) => c.sentence),
    packagingLines: packagingTaken.map((p) => ({
      name: p.materialName,
      neededText: fmtQty(p.qty, p.uom, 0),
      takenText: fmtQty(p.issuedQty, p.uom, 0),
      lots: p.issued.length ? p.issued.map((x) => `${x.lotNumber} (${fmtQty(x.qty, p.uom, 0)})`).join(", ") : null,
    })),
    boxes: boxPlan.length
      ? {
          summary: `${boxPlan.length} ${boxPlan.length === 1 ? "box" : "boxes"}, ${fmtQty(boxPlan.reduce((t, r) => t + r.pieces, 0), "pcs", 0)} in all`,
          rows: boxPlan.map((r) => ({ boxNo: r.boxNo, pieces: fmtQty(r.pieces, "pcs", 0), number: r.containerNumber ?? null, status: r.status === "boxed" ? "Packed" : r.status === "planned" ? "Planned" : r.status.replace(/_/g, " ") })),
        }
      : undefined,
    labelsPrinted: labelRows.map(({ j, by }) => ({
      kind: j.entityType === "batch_box" ? `Box label ${j.entityNumber}` : "Product labels",
      copies: j.copies,
      status: j.voidedAt ? `Voided: ${j.voidReason ?? ""}` : (LABEL_STATUS_WORD[j.status] ?? j.status.replace(/_/g, " ")),
      by: by ?? null,
      at: at(j.printedAt),
      reprint: j.reprintNo ? `Reprint ${j.reprintNo}${j.reprintNote ? `: ${j.reprintNote}` : ""}` : null,
    })),
    disposition: disposition
      ? {
          decision: disposition.decision === "release" ? "release" : disposition.decision === "reject" ? "reject" : "other",
          label: `${disposition.decision === "release" ? "Approved" : disposition.decision === "reject" ? "Disapproved" : disposition.decision.replace(/_/g, " ")} [${disposition.decision}]`,
          decidedBy: latestDisposition!.decidedBy,
          decidedAt: latestDisposition!.decidedAt,
          decidedByRole: latestDisposition!.role,
          reason: disposition.reason ?? null,
          overrideReason: qcheck?.override_reason ?? null,
          testerReleased: qcheck?.tester_released ?? false,
          recordReviewed: qcheck?.record_reviewed ?? false,
        }
      : null,
    remarks: batch.remarks ?? null,
    amendments: amendments.map((a) => ({
      no: a.amendmentNo,
      reopenNo: reopens.find((r) => r.id === a.reopenRequestId)?.reopenNo ?? null,
      section: a.section.replace(/_/g, " "),
      reference: a.reference,
      previous: a.previousValue,
      corrected: a.correctedValue,
      reason: a.reason,
      by: who(a.recordedBy) ?? "",
      at: fmtDateTime(a.recordedAt),
      superseded: amendments.some((x) => x.supersedesId === a.id),
    })),
    reopens: reopens
      .filter((r) => r.status === "reopened")
      .map((r) => ({
        reopenNo: r.reopenNo ?? 0,
        reason: r.reason,
        scope: r.amendmentScope,
        requestedBy: who(r.requestedBy) ?? "",
        approvals: approvals
          .filter((a) => a.recordId === r.id && a.decision === "approved")
          .map((a) => `step ${a.step} ${who(a.decidedBy)}`)
          .join(", "),
        at: fmtDateTime(r.reopenedAt),
        target: r.targetState,
      })),
    attachments: papers.map(({ p, fileName, sha }) => ({
      reference: p.paperReference,
      stepLabel: `${p.stepNo}. ${p.stepName}`,
      status: p.status,
      fileName: fileName ?? null,
      sha8: sha ? sha.slice(0, 8) : null,
      transcribedBy: who(p.transcribedBy),
      reviewedBy: who(p.reviewedBy),
      reviewedAt: at(p.reviewedAt),
    })),
    audit: [
      // 2026-11 (owner: no raw keys on the printed record): states and events in words (record-words.ts).
      ...transitions.map((t) => ({ when: t.at, row: { at: fmtDateTime(t.at), actor: who(t.actorId) ?? "", event: t.fromState ? `Status: ${batchStateWord(t.fromState)} → ${batchStateWord(t.toState)}` : `Created → ${batchStateWord(t.toState)}`, detail: plainReason(t.reason) } })),
      ...audits
        .filter((a) => !a.action.startsWith("documents.generated_document"))
        .map((a) => ({ when: a.occurredAt, row: { at: fmtDateTime(a.occurredAt), actor: who(a.actorId) ?? a.actorLabel ?? "system", event: auditSentence({ action: a.action, after: a.after, reason: a.reason }), detail: plainReason(a.reason) } })),
    ]
      .sort((x, z) => new Date(x.when).getTime() - new Date(z.when).getTime())
      .map((x) => x.row),
    documents: docs
      .map(({ d, generatedByName }) => ({
        number: d.documentNumber,
        label: `${d.documentKind === PAPER_PAGE_KIND ? "Paper page" : "BMR"} rev ${d.recordRevisionNo}${d.reprintNo ? ` · reprint ${d.reprintNo}` : ""}${d.watermark ? ` · ${d.watermark}` : ""}`,
        status: d.status,
        by: generatedByName,
        at: fmtDateTime(d.generatedAt),
      }))
      .reverse(),
    controlledRecord,
    notice: "Formula values, tolerances, specifications and procedure text are configuration to be verified by authorized personnel before production use.",
  };

  const revisionAt = maxDate([
    batch.createdAt,
    batch.startedAt,
    batch.completedAt,
    ...transitions.map((t) => t.at),
    ...disp.map((d) => d.r.recordedAt),
    ...stepRecs.map((s) => s.completedAt),
    ...tests.map((t) => t.createdAt),
    ...disps.map((d) => d.decidedAt),
    ...closures.map((c) => c.closedAt),
    ...reopens.flatMap((r) => [r.requestedAt, r.updatedAt]),
    ...amendments.map((a) => a.recordedAt),
    ...papers.map((p) => p.p.updatedAt),
    ...audits.filter((a) => !a.action.startsWith("documents.generated_document")).map((a) => a.occurredAt),
    ...lc.rows.map((r) => r.answeredAt),
    ...readings.rows.map((r) => r.recordedAt),
    ...equipmentUses.rows.map((r) => r.startedAt),
    ...yieldRec.rows.map((r) => r.recordedAt),
    ...deviations.rows.flatMap((r) => [r.raisedAt, r.closedAt]),
    ...inspections.rows.map((r) => r.reviewedAt),
  ]);
  data.batch.revisionText = fmtDateTime(revisionAt);
  return { data, revisionAt, status: batch.status, siteId: batch.siteId, siteCode, batchNumber: batch.batchNumber, createdAt: batch.createdAt, reopenCount };
}

const STEP_STATUS_WORD: Record<string, string> = { pending: "Not started", in_progress: "Being done", awaiting_check: "Waiting for the second person", completed: "Done", skipped: "Skipped" };
const LABEL_STATUS_WORD: Record<string, string> = { queued: "Not printed yet", rendering: "Not printed yet", ready: "Ready, not printed yet", printed: "Printed", failed: "Print failed", cancelled: "Cancelled" };

/** Template version of the batch: pinned by its first BMR, else effective at batch creation, else current. */
export async function bmrTemplateFor(q: DbOrTx, ctx: AuthContext, b: { id: string; siteId: string; createdAt: Date }, kind: typeof BMR_KIND | typeof PAPER_PAGE_KIND = BMR_KIND): Promise<SourceTemplate | null> {
  const code = await getSetting(q, ctx.organizationId, kind === BMR_KIND ? "documents.bmr.template_code" : "documents.bmr.paper_page_template_code", b.siteId);
  const docs = await documentsForSource(q, ctx.organizationId, "batch", b.id, [kind]);
  const first = docs.filter((x) => !x.d.reprintOfId).at(-1)?.d ?? null;
  return resolveTemplateVersion(q, ctx.organizationId, { templateCode: code, siteId: b.siteId, pinnedVersionId: first?.documentTemplateVersionId ?? null, at: b.createdAt });
}

function setupMissing(code: string) {
  return new DomainError("setup_required", `No approved BMR template (${code}) is available. Ask QA to approve one under Management › Rules and settings › Labels and printouts.`);
}

/**
 * Generates a BMR in the caller's transaction (used by on-demand generation and by closure).
 * When the current BMR already shows the same source revision and watermark it is returned as is
 * (regenerating identical content would only add a number); otherwise a new revision is generated
 * and earlier ones are marked superseded.
 */
export async function generateBmrInTx(tx: Tx, ctx: AuthContext, batchId: string, opts: { idempotencyKey?: string | null; watermark?: string; force?: boolean } = {}) {
  ctx.require("documents.generated_document.create");
  const build = await buildBmrDataset(tx, ctx, batchId);
  const resolved = await bmrTemplateFor(tx, ctx, { id: batchId, siteId: build.siteId, createdAt: build.createdAt });
  if (!resolved) throw setupMissing(await getSetting(tx, ctx.organizationId, "documents.bmr.template_code", build.siteId));
  const watermark = opts.watermark ?? bmrWatermark(build.status, build.reopenCount);
  if (!opts.force) {
    const docs = await documentsForSource(tx, ctx.organizationId, "batch", batchId, [BMR_KIND]);
    const current = docs.find((x) => !x.d.reprintOfId && x.d.status === "ready")?.d;
    if (current && current.sourceRevisionAt.getTime() === build.revisionAt.getTime() && current.watermark === watermark) {
      return { doc: current, generated: false };
    }
  }
  const doc = await generateForSource(tx, ctx, {
    resolved,
    documentKind: BMR_KIND,
    source: { type: "batch", id: batchId, revisionAt: build.revisionAt, state: build.status },
    siteId: build.siteId,
    data: build.data,
    watermark,
    idempotencyKey: opts.idempotencyKey ? `bmr:${opts.idempotencyKey}` : null,
    parameters: { batchNumber: build.batchNumber },
    supersedePrevious: true,
    supersedeReason: `New BMR revision for batch ${build.batchNumber}`,
  });
  return { doc, generated: true };
}

/** On-demand BMR generation (US-3-18): production.batch.view + documents.generated_document.create. */
export async function generateBmr(ctx: AuthContext, input: { batchId: string; idempotencyKey: string }) {
  ctx.require("production.batch.view");
  ctx.require("documents.generated_document.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    const { batch } = await visibleBatch(tx, ctx, input.batchId);
    ctx.requireSite(batch.siteId);
    const { result } = await idempotent(tx, ctx, `bmr-generate:${input.idempotencyKey}`, "production.bmr.generate", async () => {
      const r = await generateBmrInTx(tx, ctx, batch.id, {});
      return { documentId: r.doc.id, documentNumber: r.doc.documentNumber, generated: r.generated };
    });
    return result;
  });
}

/**
 * Everything the BMR print page needs: the batch, every BMR / paper page document, the current
 * document, whether it is stale, and a live preview when there is no current document yet.
 */
export async function bmrPrintView(ctx: AuthContext, batchId: string) {
  const build = await buildBmrDataset(db, ctx, batchId);
  const resolved = await bmrTemplateFor(db, ctx, { id: batchId, siteId: build.siteId, createdAt: build.createdAt });
  const docs = await documentsForSource(db, ctx.organizationId, "batch", batchId, [BMR_KIND, PAPER_PAGE_KIND]);
  const bmrDocs = docs.filter((x) => x.d.documentKind === BMR_KIND);
  const current = bmrDocs.find((x) => !x.d.reprintOfId && x.d.status === "ready")?.d ?? null;
  const watermark = bmrWatermark(build.status, build.reopenCount);
  const stale = !current || current.sourceRevisionAt.getTime() !== build.revisionAt.getTime() || current.watermark !== watermark;
  const workingCopy = (BMR_WORKING_COPY_STATES as readonly string[]).includes(build.status);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const preview =
    resolved && stale
      ? renderPreview(resolved, build.data, {
          documentKind: BMR_KIND,
          watermark,
          siteCode: build.siteCode,
          organizationName: org?.name ?? "",
          generatedByName: ctx.displayName,
          generatedAt: fmtDateTime(new Date()),
          sourceRevisionAt: build.revisionAt,
          sourceState: build.status,
          workingCopy: workingCopy ? { documentNumber: "WORKING-COPY", watermark: BMR_WORKING_COPY_WATERMARK } : null,
        })
      : null;
  const templateCode = await getSetting(db, ctx.organizationId, "documents.bmr.template_code", build.siteId);
  return {
    batch: { id: batchId, number: build.batchNumber, status: build.status, statusLabel: build.data.batch.statusLabel, productName: build.data.batch.productName, siteId: build.siteId },
    template: resolved ? { code: resolved.template.code, versionNo: resolved.version.versionNo, status: resolved.version.status } : null,
    templateCode,
    watermark,
    current,
    stale,
    preview,
    /** The batch is still being made: the preview is a printable working copy (watermarked, not stored). */
    workingCopy: workingCopy && !!preview,
    documents: docs.map(({ d, generatedByName }) => ({ ...d, generatedByName })),
    canGenerate: ctx.can("documents.generated_document.create"),
    canReprint: ctx.can("documents.reprint.create"),
  };
}
export type BmrPrintView = Awaited<ReturnType<typeof bmrPrintView>>;

/**
 * Tab title of the BMR print page. Chrome's "Save as PDF" proposes it as the file name, so the PDF is saved as
 * "BMR B-26-0001 Acapulco Soap 135 g" instead of "Batch Manufacturing Record". Same visibility as the page.
 */
export async function bmrPrintTitle(ctx: AuthContext, batchId: string): Promise<string> {
  const { batch, product } = await visibleBatch(db, ctx, batchId);
  return `BMR ${batch.batchNumber} ${product.name}`;
}

/** Rows of the BMR documents of a batch visible to the caller (for the closure page history). */
export async function bmrDocuments(ctx: AuthContext, batchId: string) {
  await visibleBatch(db, ctx, batchId);
  const docs = await documentsForSource(db, ctx.organizationId, "batch", batchId, [BMR_KIND, PAPER_PAGE_KIND]);
  return docs.map(({ d, generatedByName }) => ({ ...d, generatedByName }));
}
