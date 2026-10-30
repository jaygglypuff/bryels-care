import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  approvalDecisions,
  auditEvents,
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
  organizations,
  processStepRecords,
  products,
  qualityHoldLots,
  qualityHolds,
  routingSteps,
  sites,
  testResults,
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
import { toleranceRange } from "./dispensing";
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

const STATE_LABEL: Record<string, string> = {
  draft: "DRAFT",
  planned: "PLANNED (not started)",
  materials_staged: "MATERIALS STAGED",
  in_process: "IN PROCESS",
  awaiting_qc: "AWAITING QC",
  quarantined: "QUARANTINED (QA review)",
  released: "RELEASED",
  rejected: "REJECTED",
  rework_approved: "REWORK APPROVED",
  closed: "CLOSED",
};

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

  const mats = await q.select().from(batchMaterials).where(eq(batchMaterials.batchId, batch.id)).orderBy(asc(batchMaterials.lineNo));
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

  // C: materials, grouped by phase in BOM order; names from the snapshot (batch snapshot rule).
  const snapLine = (bm: (typeof mats)[number]) => snap.lines.find((l) => l.bomLineId === bm.bomLineId) ?? snap.lines.find((l) => l.lineNo === bm.lineNo);
  const lines = mats.map((bm) => {
    const s = snapLine(bm);
    const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct, bm.toleranceAbsG);
    const tol = bm.toleranceAbsG ? `± ${g1(bm.toleranceAbsG)} g` : `± ${fmtQty(bm.tolerancePct, "%", 1)}`;
    const recs = disp.filter((d) => d.r.batchMaterialId === bm.id);
    return {
      phase: s?.phaseCode ?? null,
      line: {
        lineNo: bm.lineNo,
        name: s?.materialName ?? "Unknown material",
        inci: s?.inciName ?? null,
        code: s?.materialCode ?? "",
        toleranceText: `${tol} (${g1(min)} – ${g1(max)} g)`,
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
        kindLabel: s.stepKind.replace(/_/g, " "),
        mode: (modes.find((m) => m.id === s.routingStepId)?.mode ?? "electronic").replace(/_/g, " "),
        instruction: s.instruction ?? null,
        workInstruction: s.workInstruction ? `${s.workInstruction.code} rev ${s.workInstruction.revisionNo}` : null,
        readings: r?.readings ?? null,
        conducted: r ? { name: who(r.conductedBy) ?? "", at: at(r.completedAt) } : null,
        checked: r?.checkedBy ? { name: who(r.checkedBy) ?? "", at: at(r.checkedAt) } : null,
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
  const latestDisposition = disposition ? { decidedBy: who(disposition.decidedBy) ?? "", decidedAt: fmtDateTime(disposition.decidedAt) } : null;

  const data: BmrData = {
    schema: "bmr/v1",
    batch: {
      id: batch.id,
      number: batch.batchNumber,
      statusCode: batch.status,
      statusLabel: STATE_LABEL[batch.status] ?? batch.status.toUpperCase(),
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
      createdBy: who(batch.createdBy) ?? "",
      snapshotTakenText: fmtDateTime(snap.takenAt ?? batch.createdAt),
      reopenCount,
      closedText: batch.status === "closed" && lastClosure ? fmtDateTime(lastClosure.closedAt) : null,
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
      rows: lc.rows.map((r) => ({ stepNo: r.stepNo, stepName: r.stepName, itemNo: r.itemNo, text: r.text, answer: r.answer, note: r.note, by: r.answeredBy, at: at(r.answeredAt) })),
    },
    parameters: {
      available: readings.available,
      rows: readings.rows.map((r) => ({
        stepNo: r.stepNo,
        parameter: r.parameter,
        uom: r.uom,
        limits: [r.min ? `min ${r.min}` : null, r.target ? `target ${r.target}` : null, r.max ? `max ${r.max}` : null].filter(Boolean).join(" · ") || "—",
        value: r.value,
        within: r.within,
        by: r.recordedBy,
        at: at(r.recordedAt),
        struck: r.superseded,
        struckReason: r.superseded ? `Corrected: ${r.correctionReason ?? "reason not given"}` : null,
      })),
    },
    equipment: {
      available: equipmentUses.available,
      rows: equipmentUses.rows.map((e) => ({ stepNo: e.stepNo, code: e.code, name: e.name, calibrationDue: e.calibrationDue, cleaning: e.cleaning, operator: e.operator, at: at(e.startedAt), exception: e.exceptionReason })),
    },
    packaging: {
      available: yieldRec.available || packagingRecs.available,
      rows: [
        // W2B packaging reconciliation: one line per component lot issued to the packaging step.
        ...packagingRecs.rows.map((p) => ({
          label: `${p.material}${p.lot ? ` (${p.lot})` : ""}`,
          value: `issued ${p.issued}, used ${p.used ?? "—"}, damaged ${p.damaged ?? "—"}, returned ${p.returned ?? "—"} ${p.uom}; variance ${p.variance ?? "—"} (tolerance ${p.tolerance})${p.withinTolerance === false ? " !" : ""}${p.countedBy ? ` · counted by ${p.countedBy}` : ""}`,
        })),
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
      theoreticalText: `${fmtQty(batch.theoreticalYieldG, "g", 0)} (${fmtQty(snap.theoreticalYieldPct, "%", 1)} of batch size)`,
      actualText: batch.actualOutputG ? fmtQty(batch.actualOutputG, "g", 0) : null,
      detailText: batch.actualOutputG ? `(${fmtQty(batch.actualUnits, "pcs", 0)} × ${fmtQty(product.unitNetMassG, "g", 0)}; ${fmtQty(batch.yieldPct, "%", 2)})` : null,
      expiryText: outputLot ? fmtDate(outputLot.expiresOn) : null,
      outputLot: outputLot?.lotNumber ?? null,
      yieldRecord: {
        available: yieldRec.available,
        rows: y
          ? [
              { label: "Theoretical", value: y.theoretical },
              { label: "Actual", value: y.actual },
              { label: "Variance", value: `${y.variance}${y.variancePct ? ` (${y.variancePct} %)` : ""}` },
              ...(y.yieldPct ? [{ label: "Yield", value: `${y.yieldPct} %${y.limitsText ? ` (limits ${y.limitsText})` : ""}${y.withinLimits === false ? " !" : ""}` }] : []),
              ...(y.actualUnits ? [{ label: "Units", value: y.actualUnits }] : []),
              { label: "Recorded by", value: y.recordedBy ?? "—" },
              { label: "Checked by", value: y.checkedBy ?? "—" },
              ...(y.approvedBy ? [{ label: "Out-of-range yield approved by", value: `${y.approvedBy}${y.approvalReason ? `: ${y.approvalReason}` : ""}` }] : []),
            ]
          : [],
      },
      outputs: { available: outputs.available, rows: outputs.rows },
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
    disposition: disposition
      ? {
          decision: disposition.decision === "release" ? "release" : disposition.decision === "reject" ? "reject" : "other",
          label: `${disposition.decision === "release" ? "Approved" : disposition.decision === "reject" ? "Disapproved" : disposition.decision.replace(/_/g, " ")} [${disposition.decision}]`,
          decidedBy: latestDisposition!.decidedBy,
          decidedAt: latestDisposition!.decidedAt,
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
      ...transitions.map((t) => ({ when: t.at, row: { at: fmtDateTime(t.at), actor: who(t.actorId) ?? "", event: `State ${t.fromState ?? "—"} → ${t.toState}`, detail: t.reason ?? null } })),
      ...audits
        .filter((a) => !a.action.startsWith("documents.generated_document"))
        .map((a) => ({ when: a.occurredAt, row: { at: fmtDateTime(a.occurredAt), actor: who(a.actorId) ?? a.actorLabel ?? "system", event: a.action, detail: a.reason ?? auditDetail(a.after) } })),
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
  return { data, revisionAt, status: batch.status, siteId: batch.siteId, siteCode, batchNumber: batch.batchNumber, createdAt: batch.createdAt, reopenCount };
}

/** Compact, non-sensitive summary of an audit payload for the appendix. */
function auditDetail(after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const parts = Object.entries(after as Record<string, unknown>)
    .filter(([k, v]) => v !== null && v !== undefined && typeof v !== "object" && !/id$/i.test(k))
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length ? parts.join("; ").slice(0, 300) : null;
}

/** Template version of the batch: pinned by its first BMR, else effective at batch creation, else current. */
export async function bmrTemplateFor(q: DbOrTx, ctx: AuthContext, b: { id: string; siteId: string; createdAt: Date }, kind: typeof BMR_KIND | typeof PAPER_PAGE_KIND = BMR_KIND): Promise<SourceTemplate | null> {
  const code = await getSetting(q, ctx.organizationId, kind === BMR_KIND ? "documents.bmr.template_code" : "documents.bmr.paper_page_template_code", b.siteId);
  const docs = await documentsForSource(q, ctx.organizationId, "batch", b.id, [kind]);
  const first = docs.filter((x) => !x.d.reprintOfId).at(-1)?.d ?? null;
  return resolveTemplateVersion(q, ctx.organizationId, { templateCode: code, siteId: b.siteId, pinnedVersionId: first?.documentTemplateVersionId ?? null, at: b.createdAt });
}

function setupMissing(code: string) {
  return new DomainError("setup_required", `No approved BMR template (${code}) is available. Ask QA to approve one under Management → System → Templates & labels.`);
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
    documents: docs.map(({ d, generatedByName }) => ({ ...d, generatedByName })),
    canGenerate: ctx.can("documents.generated_document.create"),
    canReprint: ctx.can("documents.reprint.create"),
  };
}
export type BmrPrintView = Awaited<ReturnType<typeof bmrPrintView>>;

/** Rows of the BMR documents of a batch visible to the caller (for the closure page history). */
export async function bmrDocuments(ctx: AuthContext, batchId: string) {
  await visibleBatch(db, ctx, batchId);
  const docs = await documentsForSource(db, ctx.organizationId, "batch", batchId, [BMR_KIND, PAPER_PAGE_KIND]);
  return docs.map(({ d, generatedByName }) => ({ ...d, generatedByName }));
}
