import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchStateTransitions, documentTemplateVersions, documentTemplates, equipment, generatedDocuments, productionLines, sites, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { insertAndRender } from "@/modules/documents";
import { businessToday, deriveAvailability } from "@/modules/masterdata";
import { toleranceRange } from "./dispensing";
import type { FormulaSnapshot } from "./shared";
import { canSeeStaging, getStagingView } from "./staging";

/**
 * Dispensing sheet and traveler generation (US-3-08, FR-documents-09). Each print is a recorded
 * generated document (DOC number, frozen dataset, template version, sha256) of source `batch`,
 * reprinted through the documents module with a reason. Datasets are built under the caller's
 * AuthContext, so scope and permissions of the batch apply.
 */

export type BatchSheetKind = "dispensing_sheet" | "traveler";
const DATASET: Record<BatchSheetKind, string> = { dispensing_sheet: "dispensing_sheet/batch/v1", traveler: "traveler/batch/v1" };
const KIND_WORD: Record<string, string> = {
  line_clearance: "Line clearance",
  dispensing: "Weighing / dispensing",
  weighing: "Weighing / dispensing",
  process: "Processing",
  packaging: "Packaging and labelling",
  transfer: "Transfer to quarantine",
  inspection: "In-process check",
};

/** Grams with the decimals the value needs (1 to 3): a weighing target is never rounded to kg. */
function gramsText(v: Decimal.Value) {
  const d = new Decimal(v);
  const dp = Math.min(Math.max(d.decimalPlaces(), 1), 3);
  return fmtQty(d.toDecimalPlaces(3), "g", dp);
}

async function approvedTemplate(kind: BatchSheetKind, organizationId: string, siteId: string) {
  const rows = await db
    .select({ t: documentTemplates, v: documentTemplateVersions })
    .from(documentTemplates)
    .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.documentTemplateId, documentTemplates.id))
    .where(
      and(
        eq(documentTemplates.organizationId, organizationId),
        eq(documentTemplates.templateKind, kind),
        eq(documentTemplates.isActive, true),
        eq(documentTemplateVersions.status, "approved"),
        or(isNull(documentTemplates.siteId), eq(documentTemplates.siteId, siteId)),
      ),
    )
    .orderBy(asc(documentTemplates.code));
  return rows.find((r) => r.t.siteId === siteId) ?? rows[0] ?? null;
}

/** Builds the frozen dataset of a sheet (pure data; values formatted here, the renderer stays pure). */
export async function batchSheetData(ctx: AuthContext, batchId: string, kind: BatchSheetKind) {
  const view = await getStagingView(ctx, batchId);
  const b = view.batch;
  const snap = b.formulaSnapshot as FormulaSnapshot;
  const [site] = await db.select().from(sites).where(eq(sites.id, b.siteId)).limit(1);
  const [line] = view.workOrder?.productionLineId ? await db.select().from(productionLines).where(eq(productionLines.id, view.workOrder.productionLineId)).limit(1) : [];
  const identity = {
    batchNumber: b.batchNumber,
    batchStatus: b.status,
    productName: view.productName,
    productSku: view.productSku,
    sizeText: gramsText(b.plannedSizeG),
    plannedStart: b.plannedStartOn ? fmtDate(b.plannedStartOn) : "—",
    workOrderNumber: view.workOrder?.workOrderNumber ?? null,
    formulaLabel: `${snap.formulaCode} rev ${snap.revisionNo}`,
    routingLabel: snap.routing ? `${snap.routing.routingCode} rev ${snap.routing.revisionNo}` : null,
    lineText: line ? `${line.code} · ${line.name}` : null,
    siteText: site ? `${site.code} · ${site.name}` : "",
  };
  const snapLine = (materialId: string) => snap.lines.find((l) => l.materialId === materialId);
  if (kind === "dispensing_sheet") {
    const scales = await db.select().from(equipment).where(and(eq(equipment.siteId, b.siteId), eq(equipment.equipmentKind, "scale"))).orderBy(asc(equipment.code));
    const today = businessToday();
    const total = view.lines.reduce((a, l) => a.plus(l.theoreticalQtyG), new Decimal(0));
    return {
      batch: identity,
      lines: view.lines.map((l) => {
        const s = snapLine(l.materialId);
        const { min, max } = toleranceRange(l.theoreticalQtyG, l.tolerancePct, l.toleranceAbsG);
        return {
          lineNo: l.lineNo,
          materialCode: l.materialCode,
          materialName: l.materialName,
          inciName: s?.inciName ?? null,
          phase: s?.phaseCode ?? null,
          targetText: gramsText(l.theoreticalQtyG),
          toleranceText: l.toleranceAbsG !== null ? `± ${gramsText(l.toleranceAbsG)}` : `± ${fmtQty(l.tolerancePct, "%", 2)}`,
          rangeText: `${gramsText(min)} – ${gramsText(max)}`,
          requiresChecker: s?.requiresChecker ?? true,
          expectedLots: l.stagings.length
            ? l.stagings.map((x) => ({ lotNumber: x.lotNumber, where: x.to, qtyText: gramsText(x.qty), expiresText: x.expiresOn ? fmtDate(x.expiresOn) : "no expiry", kind: "staged" as const }))
            : l.expected.map((x) => ({ lotNumber: x.lotNumber, where: x.locationCode, qtyText: gramsText(x.qty), expiresText: x.expiresOn ? fmtDate(x.expiresOn) : "no expiry", kind: "reserved" as const })),
        };
      }),
      totalText: gramsText(total),
      scales: scales.map((e) => {
        const av = deriveAvailability(e, today);
        const due = e.calibrationDueDate ? ` · calibration due ${fmtDate(e.calibrationDueDate)}` : "";
        return { code: e.code, name: e.name, statusText: av.selectable ? `Usable${due}` : `Blocked: ${av.blockingReasons.map((r) => r.detail).join("; ")}` };
      }),
      notes: [
        "Weigh only the lots listed for each ingredient. At the scale, scan the container; a wrong lot, a held or expired lot is blocked by the system.",
        "Targets and tolerances come from the approved formula revision frozen on this batch. Verify with authorised personnel before production use.",
        ...view.lines.flatMap((l) => l.substitutions.map((s) => `QA substitution for ${l.materialName}: lot ${s.lotNumber} (${s.reason}) approved by ${s.by}.`)),
      ].slice(0, 10),
    };
  }
  const stepsRows = [...snap.steps].sort((a, z) => a.stepNo - z.stepNo);
  const stagingCodes = [...new Set(view.lines.flatMap((l) => l.stagings.map((s) => s.to)))];
  return {
    batch: identity,
    steps: stepsRows.map((s) => ({
      stepNo: s.stepNo,
      name: s.name,
      kindWord: KIND_WORD[s.stepKind] ?? s.stepKind.replace(/_/g, " "),
      area: s.area ?? null,
      requiresChecker: s.requiresChecker,
      parametersText: s.parameters?.length
        ? s.parameters
            .map((p) => `${p.name}${p.minValue || p.maxValue ? ` ${p.minValue ?? ""}–${p.maxValue ?? ""}` : p.targetValue ? ` ${p.targetValue}` : ""}${p.uom ? ` ${p.uom}` : ""}`)
            .join("; ")
            .slice(0, 400)
        : null,
      doneText: null,
    })),
    materials: view.lines.map((l) => ({
      materialName: l.materialName,
      materialCode: l.materialCode,
      targetText: gramsText(l.theoreticalQtyG),
      stagedText: gramsText(l.staged),
      lotsText: (l.stagings.length ? l.stagings.map((s) => `${s.lotNumber} → ${s.to}`) : l.expected.map((x) => `${x.lotNumber} (reserved at ${x.locationCode})`)).join(", ").slice(0, 300) || "—",
    })),
    stagingText: stagingCodes.length ? stagingCodes.join(", ") : null,
  };
}

/**
 * Generates (records and renders) the dispensing sheet or traveler of a batch. Dispensing sheets
 * of a batch whose materials are not all staged carry the watermark NOT STAGED.
 */
export async function generateBatchSheet(ctx: AuthContext, input: { batchId: string; kind: BatchSheetKind; idempotencyKey: string }) {
  ctx.require("documents.generated_document.create");
  if (!canSeeStaging(ctx)) ctx.require("production.batch.view");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `batchsheet:${input.kind}:${input.idempotencyKey}`;
  const data = await batchSheetData(ctx, input.batchId, input.kind);
  const view = await getStagingView(ctx, input.batchId);
  const b = view.batch;
  const tpl = await approvedTemplate(input.kind, ctx.organizationId, b.siteId);
  if (!tpl) {
    throw new DomainError("setup_required", `No approved ${input.kind === "traveler" ? "traveler" : "dispensing sheet"} template exists. Ask QA to approve one under Admin → Templates & labels.`);
  }
  const [lastTransition] = await db.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, b.id)).orderBy(desc(batchStateTransitions.at)).limit(1);
  const lastStaging = view.lines.flatMap((l) => l.stagings.map((s) => new Date(s.at).getTime()));
  const revisionAt = new Date(Math.max(new Date(b.createdAt).getTime(), lastTransition ? new Date(lastTransition.at).getTime() : 0, ...lastStaging));
  const watermark = input.kind === "dispensing_sheet" && !view.allStaged ? "NOT STAGED" : null;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { id: replay.id, documentNumber: replay.documentNumber, replayed: true };
    const doc = await insertAndRender(tx, ctx, {
      version: tpl.v,
      template: tpl.t,
      documentKind: input.kind,
      source: { type: "batch", id: b.id, revisionAt, state: b.status },
      siteId: b.siteId,
      data,
      watermark,
      parameters: { dataset: DATASET[input.kind] },
      idempotencyKey: key,
    });
    if (doc.status !== "ready") throw new DomainError("state", `The ${input.kind.replace(/_/g, " ")} could not be rendered: ${doc.errorMessage ?? "unknown error"}.`);
    return { id: doc.id, documentNumber: doc.documentNumber, replayed: false };
  });
}

/** Sheets already generated for a batch (newest first) with who generated them. */
export async function batchSheets(ctx: AuthContext, batchId: string) {
  if (!canSeeStaging(ctx)) ctx.require("production.batch.view");
  const view = await getStagingView(ctx, batchId);
  if (!ctx.can("documents.generated_document.view")) return [];
  const rows = await db
    .select({ d: generatedDocuments, by: users.displayName })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.sourceEntityType, "batch"), eq(generatedDocuments.sourceEntityId, view.batch.id), inArray(generatedDocuments.documentKind, ["dispensing_sheet", "traveler"])))
    .orderBy(desc(generatedDocuments.generatedAt));
  return rows.map((r) => ({ id: r.d.id, kind: r.d.documentKind, number: r.d.documentNumber, status: r.d.status, watermark: r.d.watermark, reprintNo: r.d.reprintNo, at: fmtDateTime(r.d.generatedAt), by: r.by }));
}
