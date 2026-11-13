import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import { batchMaterials, batchPaperRecords, dispenseRecords, equipment, generatedDocuments, idempotencyKeys, materials, processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { resolveLotRef } from "@/modules/inventory/holds";
import { visibleBatch } from "./bmr";
import { NEVER_PAPER_ONLY_STEP_KINDS, paperEntryCount } from "./bmr-paper";
import { type DispenseInput, recordDispense } from "./dispensing";
import { DEVIATION_UNAVAILABLE, executionHooks } from "./execution-hooks";
import { postPackagingConsumption } from "./execution-postings";
import {
  type BatchRow,
  type PaperStepFacts,
  type SnapshotStep,
  checkPermission,
  eligibleSigners,
  findStep,
  finishStep,
  openStep,
  paperAuditFields,
  performPermission,
  stepLabel,
  stepRecord,
  stepRecords,
} from "./execution";
import { type ClearanceAnswer, writeChecklistAnswersInTx } from "./line-clearance";
import { currentPackaging } from "./packaging";
import { issueTakenPackagingLocked } from "./packaging-flow";
import { isPackagingKind } from "./packaging-lines";
import { recordReadingInTx, useEquipment } from "./process";
import { CHECKER_PERMISSION, type FormulaSnapshot, idempotent, isWeighingStep, lockBatch } from "./shared";
import { stepBlockers } from "./steps";
import { toleranceRange } from "./weigh-window";

/**
 * ADR-134 — "Enter from the paper record". After the connection is back, a person types the paper batch record in the
 * order of the paper: for each line the time written on the paper (when it really happened, not now), who did it, who
 * checked it and the page's DOC number. The records are the normal ones (posted records stay immutable; dispensing still
 * posts through postMovement) and carry `entry_source = paper`, `occurred_at`, `entered_by` and `paper_record_id`.
 *
 * Rules (all on the server):
 * - the page must belong to the batch and the step, and be issued or returned (an attached scan waits for its review);
 * - the time must not be in the future, nor before the page was printed (5 minutes allowed for clock differences);
 * - the person who did it may do that step at the batch's site; the checker is another person who may check it;
 * - weighing, the move to the hold area and reconciliation are never "paper only" (NEVER_PAPER_ONLY_STEP_KINDS): they
 *   are typed from paper only with the reason (e.g. "No internet at the time") and while
 *   `production.paper.outage_entry_allowed` is on (default on; QA confirms, A-PAPER-01);
 * - tolerances and limits still apply: what is outside is recorded as written and a deviation goes to QA;
 * - a lot that is not released (or was expired at the time on paper) is not used: the line is refused and QA is told.
 * The scan of the page and its review by a person who typed none of it stay (bmr-paper.ts); unreviewed pages keep the
 * batch from leaving the QA hold area.
 */

/** Why a never-paper-only step was done on paper (stored as words in `outage_reason`). */
export const OUTAGE_REASONS = {
  no_internet: "No internet at the time",
  system_down: "The system was not working",
  device_problem: "The phone or tablet was not working",
  other: "Other",
} as const;
export type OutageReason = keyof typeof OUTAGE_REASONS;

/** Clock difference allowed between the wall clock written on paper and the server (minutes). */
const CLOCK_SLACK_MINUTES = 5;

export type PaperFactsInput = {
  /** The issued page (batch_paper_records.id) the line is written on. */
  paperRecordId: string;
  /** The time written on the paper (ISO, or a Date). */
  occurredAt: string | Date;
  /** When the step started, if written (hold and curing steps). */
  startedAt?: string | Date | null;
  doneById: string;
  checkedById?: string | null;
  outageReason?: string | null;
  outageNote?: string | null;
};

function parseTime(v: string | Date | null | undefined, field: string, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new DomainError("validation", `Write the ${label} as on the paper (date and time).`, { field, fieldErrors: { [field]: "Date and time." } });
  return d;
}

const isNeverPaperOnly = (kind: string) => (NEVER_PAPER_ONLY_STEP_KINDS as readonly string[]).includes(kind) || isWeighingStep(kind);

/**
 * Checks the page, the time, the people and the outage reason, in the caller's transaction (page row locked).
 * `doPermission` / `checkPermissionCode`: what the named people must hold at the batch's site.
 */
async function resolvePaperFacts(tx: Tx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep, input: PaperFactsInput, perms: { doPermission: Permission; checkPermissionCode: Permission }): Promise<PaperStepFacts & { startedAt: Date }> {
  if (!input || typeof input !== "object") throw new DomainError("validation", "Choose the paper page.", { field: "paperRecordId" });
  if (isNeverPaperOnly(step.stepKind)) {
    const allowed = await getSetting(tx, ctx.organizationId, "production.paper.outage_entry_allowed", batch.siteId);
    if (!allowed) {
      throw new DomainError("state", `${capital(stepLabel(step))} must be done in the system at this site; it cannot be typed in from paper. (Setting "Weighing may be done on paper when there is no internet" is off.)`);
    }
  }
  const code = (input.outageReason ?? "").trim();
  let outageReason: string | null = null;
  if (code) {
    if (!(code in OUTAGE_REASONS)) throw new DomainError("validation", "Choose why it was done on paper.", { field: "outageReason", fieldErrors: { outageReason: "Choose a reason." } });
    const note = (input.outageNote ?? "").trim();
    if (code === "other" && note.length < 3) throw new DomainError("validation", "Write why it was done on paper (a few words).", { field: "outageNote", fieldErrors: { outageNote: "Write the reason." } });
    if (note.length > 300) throw new DomainError("validation", "Keep the reason under 300 characters.", { field: "outageNote" });
    outageReason = code === "other" ? note : `${OUTAGE_REASONS[code as OutageReason]}${note ? `: ${note}` : ""}`;
  } else if (isNeverPaperOnly(step.stepKind)) {
    throw new DomainError("validation", `${capital(stepLabel(step))} is normally done in the system. Say why it was done on paper (for example: no internet at the time).`, {
      field: "outageReason",
      fieldErrors: { outageReason: "Choose why it was done on paper." },
    });
  }

  if (!/^[0-9a-f-]{36}$/i.test(input.paperRecordId ?? "")) throw new DomainError("validation", "Choose the paper page (its DOC number).", { field: "paperRecordId", fieldErrors: { paperRecordId: "Choose the page." } });
  const [page] = await tx
    .select()
    .from(batchPaperRecords)
    .where(and(eq(batchPaperRecords.id, input.paperRecordId), eq(batchPaperRecords.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!page || !ctx.allowedSiteIds.includes(page.siteId)) throw new DomainError("not_found", "Paper page not found in your sites.", { field: "paperRecordId" });
  if (page.batchId !== batch.id) throw new DomainError("validation", `Page ${page.paperReference} belongs to another batch. Choose a page of batch ${batch.batchNumber}.`, { field: "paperRecordId", fieldErrors: { paperRecordId: "Another batch." } });
  if (page.stepNo !== step.stepNo) {
    throw new DomainError("validation", `Page ${page.paperReference} is for step ${page.stepNo} (${page.stepName}). Choose the page of ${stepLabel(step)}.`, { field: "paperRecordId", fieldErrors: { paperRecordId: "Another step." } });
  }
  if (page.status === "attached") throw new DomainError("state", `The scan of page ${page.paperReference} is attached and waits for its check. Ask the checker to send it back if a line is missing.`);
  if (page.status !== "issued" && page.status !== "returned") throw new DomainError("state", `Page ${page.paperReference} is ${page.status}. Nothing more can be typed from it.`);

  const occurredAt = parseTime(input.occurredAt, "occurredAt", "time")!;
  if (!occurredAt) throw new DomainError("validation", "Write the time from the paper.", { field: "occurredAt", fieldErrors: { occurredAt: "Write the time." } });
  const startedAt = parseTime(input.startedAt, "startedAt", "start time") ?? occurredAt;
  const now = Date.now();
  const slack = CLOCK_SLACK_MINUTES * 60_000;
  if (occurredAt.getTime() > now + slack) throw new DomainError("validation", "The time is later than now. Write the time from the paper.", { field: "occurredAt", fieldErrors: { occurredAt: "Later than now." } });
  if (startedAt.getTime() > occurredAt.getTime()) throw new DomainError("validation", "The start time is after the end time.", { field: "startedAt", fieldErrors: { startedAt: "After the end." } });
  if (startedAt.getTime() < page.issuedAt.getTime() - slack) {
    throw new DomainError("validation", `Page ${page.paperReference} was printed ${fmtDateTime(page.issuedAt)}. The time on it cannot be earlier.`, { field: "occurredAt", fieldErrors: { occurredAt: "Before the page was printed." } });
  }

  const doers = await eligibleSigners(tx, ctx.organizationId, batch.siteId, perms.doPermission);
  const doneBy = doers.find((u) => u.id === input.doneById);
  if (!doneBy) throw new DomainError("validation", "Choose the person written on the paper as the one who did it. Only people who may do this step at this site are listed.", { field: "doneById", fieldErrors: { doneById: "Choose the person." } });
  let checkedBy: { id: string; name: string } | null = null;
  if (input.checkedById) {
    ctx.assertSeparation(input.checkedById === input.doneById, "The person who checked must be a different person from the one who did it.", { rule: "V-SOD", field: "checkedById" });
    const checkers = await eligibleSigners(tx, ctx.organizationId, batch.siteId, perms.checkPermissionCode);
    const c = checkers.find((u) => u.id === input.checkedById);
    if (!c) throw new DomainError("validation", "Choose the person written on the paper as the checker. Only people who may check this step at this site are listed.", { field: "checkedById", fieldErrors: { checkedById: "Choose the checker." } });
    checkedBy = { id: c.id, name: c.displayName };
  }
  return { paperRecordId: page.id, paperReference: page.paperReference, occurredAt, startedAt, doneBy: { id: doneBy.id, name: doneBy.displayName }, checkedBy, outageReason };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type EnterWeighingInput = Omit<DispenseInput, "paper" | "lotPreselected" | "lotConfirm" | "lotConfirmVia" | "lotVia" | "supersedesId" | "correctionReason" | "exceptionReason"> & {
  paper: PaperFactsInput;
  idempotencyKey: string;
};

/**
 * One weighing line typed from paper. Goes through recordDispense (stock, tolerance, lot, scale and audit rules) with
 * the paper facts; a lot that is not usable is refused and QA is told with a deviation (one per batch and lot).
 */
export async function enterWeighingFromPaper(ctx: AuthContext, input: EnterWeighingInput) {
  ctx.require("production.dispense_record.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const { batch } = await visibleBatch(db, ctx, input.batchId);
  const key = `paper-weigh:${input.idempotencyKey}`;
  const [seen] = await db.select({ id: idempotencyKeys.id }).from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key))).limit(1);
  if (!seen) await refuseUnusableLot(ctx, batch, input);
  const doPermission: Permission = "production.dispense_record.create";
  const r = await recordDispense(ctx, {
    ...input,
    lotPreselected: false,
    idempotencyKey: key,
    paper: (tx, b, step) => resolvePaperFacts(tx, ctx, b, step, input.paper, { doPermission, checkPermissionCode: CHECKER_PERMISSION }),
  });
  return r as typeof r & { deviationId?: string | null };
}

/** A lot that exists but is not usable at the time on paper: QA is told (deviation), the line is refused. */
async function refuseUnusableLot(ctx: AuthContext, batch: BatchRow, input: EnterWeighingInput) {
  const lot = await resolveLotRef(db, ctx, input.lotRef ?? "");
  if (lot.siteId !== batch.siteId) return; // recordDispense answers in words
  const at = parseTime(input.paper?.occurredAt, "occurredAt", "time") ?? new Date();
  try {
    assertLotUsable(lot, at);
    return;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    const opener = executionHooks().openDeviation;
    if (!opener || !ctx.can("quality.deviation.create")) throw new DomainError("blocked_lot", `${e.message} Tell QA: the paper record says it was used.`, { field: "lotRef" });
    const dev = await db.transaction(async (tx) => {
      await lockBatch(tx, ctx, batch.id);
      return opener(tx, ctx, {
        kind: "other",
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        siteId: batch.siteId,
        lotId: lot.id,
        description: `From the paper record: lot ${lot.lotNumber} (${lot.qualityStatus}${lot.expiresOn ? `, expires ${lot.expiresOn}` : ""}) is written as used for batch ${batch.batchNumber} at ${at.toISOString()}. The line was not typed in. Typed by ${ctx.displayName}. QA decides.`,
        approvedBy: ctx.userId,
      });
    });
    throw new DomainError("blocked_lot", `${e.message} We told QA (${dev.deviationNumber ?? "problem report"}). Keep the paper page; type this line after QA answers.`, { field: "lotRef", fieldErrors: { lotRef: "Not usable." }, deviationNumber: dev.deviationNumber ?? null, deviationId: dev.deviationId });
  }
}

export type EnterStepInput = {
  batchId: string;
  stepNo: number;
  paper: PaperFactsInput;
  answers?: ClearanceAnswer[];
  readings?: { parameterId: string; value: string }[];
  equipmentRef?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

/**
 * A whole step typed from paper: checklist answers, readings, the machine, then "done" with the people and time on the
 * paper. Readings outside the limits and a hold ended early are recorded as written and a deviation goes to QA (the
 * step was already done). The move to the hold area is typed on the Finish screen (it counts and moves the stock).
 */
export async function enterStepFromPaper(ctx: AuthContext, input: EnterStepInput) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  for (const a of input.answers ?? []) {
    if (!["yes", "no", "na"].includes(a.answer)) throw new DomainError("validation", "Each answer must be yes, no or n/a.");
    if (a.answer === "no" && !(a.note ?? "").trim()) throw new DomainError("validation", 'Write what the paper says for every "no" answer.', { fieldErrors: { [`note-${a.itemId}`]: "Write what the paper says." } });
    if ((a.note ?? "").length > 500) throw new DomainError("validation", "Notes can have at most 500 characters.");
  }
  if ((input.notes ?? "").length > 1000) throw new DomainError("validation", "Notes can have at most 1000 characters.", { field: "notes" });
  await visibleBatch(db, ctx, input.batchId);
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, `paper-step:${input.idempotencyKey}`, "production.process_step_record.paper_entry", async () => {
      const step = findStep(batch, Number(input.stepNo));
      const doPermission = performPermission(step.stepKind) === "production.dispense_record.create" ? ("production.process_step_record.create" as const) : performPermission(step.stepKind);
      ctx.require(doPermission);
      if (step.stepKind === "transfer") throw new DomainError("validation", "Moving the batch to the hold area is typed on the Finish screen: it counts the pieces and moves the stock. Use the times and names from the paper there.");
      const facts = await resolvePaperFacts(tx, ctx, batch, step, input.paper, {
        doPermission: isWeighingStep(step.stepKind) ? "production.dispense_record.create" : doPermission,
        checkPermissionCode: isWeighingStep(step.stepKind) ? "production.process_step_record.approve" : checkPermission(step.stepKind),
      });
      const extra = paperAuditFields(facts);
      let rec = await openStep(tx, ctx, batch, step, { conductedBy: facts.doneBy.id, startedAt: facts.startedAt });
      await issueTakenPackagingLocked(tx, ctx, batch, step, rec);
      if (input.answers?.length) await writeChecklistAnswersInTx(tx, ctx, batch, step, rec, input.answers, extra);
      for (const r of input.readings ?? []) {
        if (!String(r.value ?? "").trim()) continue;
        await recordReadingInTx(tx, ctx, batch, step, rec, { parameterId: r.parameterId, value: String(r.value), auditExtra: extra });
      }
      if (input.equipmentRef?.trim()) await useEquipment(tx, ctx, batch, step, rec, input.equipmentRef);
      rec = (await stepRecord(tx, batch.id, step.stepNo))!;

      // What was outside the limits on paper is recorded as written; QA gets a deviation (never silently accepted).
      let deviationId: string | null = rec.deviationId;
      let blockers = await stepBlockers(tx, ctx, batch, step, rec);
      const earlyHold = rec.earliestCompletionAt && rec.earliestCompletionAt.getTime() > facts.occurredAt.getTime();
      const exceptions = blockers.filter((b) => b.exceptionable).map((b) => b.message);
      if (earlyHold) exceptions.push(`The paper says the step ended ${fmtDateTime(facts.occurredAt)}, before its minimum time (${fmtDateTime(rec.earliestCompletionAt!)}).`);
      if (exceptions.length && !deviationId) {
        const opener = executionHooks().openDeviation;
        if (!opener) throw new DomainError("state", DEVIATION_UNAVAILABLE, { rule: "CX-TOL" });
        if (!ctx.can("quality.deviation.create")) throw new DomainError("forbidden", "Something on this page is outside its limits. Ask your supervisor or QA to type it in: it opens a problem report for QA.");
        const d = await opener(tx, ctx, {
          kind: "out_of_tolerance",
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          siteId: batch.siteId,
          processStepRecordId: rec.id,
          description: `From the paper record ${facts.paperReference} (${facts.occurredAt.toISOString()}), ${stepLabel(step)} done by ${facts.doneBy.name}: ${exceptions.join(" ")} Typed in by ${ctx.displayName}. QA decides.`,
          approvedBy: ctx.userId,
        });
        deviationId = d.deviationId;
        await tx.update(processStepRecords).set({ deviationId }).where(eq(processStepRecords.id, rec.id));
        rec = (await stepRecord(tx, batch.id, step.stepNo))!;
        blockers = await stepBlockers(tx, ctx, batch, step, rec);
      }
      // A hold step's own minimum-time check compares with now; the paper's end time was handled above.
      const left = blockers.filter((b) => !(earlyHold && b.exceptionable && /minimum hold time/i.test(b.message)));
      if (left.length) {
        throw new DomainError("state", `${capital(stepLabel(step))} cannot be typed in yet: ${left.map((b) => b.message).join(" ")}`, { rule: "V-STATE", blockers: left });
      }
      const fin = await finishStep(tx, ctx, batch, step, rec, { notes: input.notes, paper: facts });
      if (await getSetting(tx, ctx.organizationId, "production.post_consumption_at_dispense", batch.siteId)) {
        for (const row of await currentPackaging(tx, batch.id)) {
          if (row.r.processStepRecordId === rec.id) await postPackagingConsumption(tx, ctx, batch, row.r, row.materialName);
        }
      }
      return { stepNo: step.stepNo, name: step.name, status: fin.status, deviationId };
    });
    return result;
  });
}

/** Everything the "Enter from the paper record" screen shows, in the order of the paper. */
export async function paperEntryView(ctx: AuthContext, batchId: string) {
  const { batch: b, product, siteCode } = await visibleBatch(db, ctx, batchId);
  const snap = b.formulaSnapshot as FormulaSnapshot;
  const pages = await db
    .select({ p: batchPaperRecords, documentNumber: generatedDocuments.documentNumber })
    .from(batchPaperRecords)
    .leftJoin(generatedDocuments, eq(generatedDocuments.id, batchPaperRecords.generatedDocumentId))
    .where(and(eq(batchPaperRecords.batchId, b.id), ne(batchPaperRecords.status, "void")))
    .orderBy(asc(batchPaperRecords.pageNo));
  const recs = await stepRecords(db, b.id);
  const lines = await db
    .select({ bm: batchMaterials, m: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, b.id))
    .orderBy(asc(batchMaterials.lineNo));
  const dispensed = lines.length ? await db.select().from(dispenseRecords).where(inArray(dispenseRecords.batchMaterialId, lines.map((l) => l.bm.id))) : [];
  const steps = [...snap.steps].sort((x, z) => x.stepNo - z.stepNo);
  const weighLines = lines
    .filter((l) => !isPackagingKind(l.m.materialKind))
    .map((l) => {
      const { min, max } = toleranceRange(l.bm.theoreticalQtyG, l.bm.tolerancePct, l.bm.toleranceAbsG);
      const live = dispensed.filter((d) => d.batchMaterialId === l.bm.id && !d.voidedAt);
      return {
        batchMaterialId: l.bm.id,
        lineNo: l.bm.lineNo,
        materialName: l.m.name,
        materialCode: l.m.code,
        uom: l.m.baseUom,
        targetText: fmtQty(new Decimal(l.bm.theoreticalQtyG).toDecimalPlaces(3), l.m.baseUom, 3),
        rangeText: `${fmtQty(min.toDecimalPlaces(3), l.m.baseUom, 3)} – ${fmtQty(max.toDecimalPlaces(3), l.m.baseUom, 3)}`,
        status: l.bm.status,
        done: l.bm.status === "dispensed" || l.bm.status === "exception",
        fromPaper: live.some((d) => d.entrySource === "paper"),
      };
    });
  const pageViews = [];
  for (const r of pages) {
    const step = steps.find((s) => s.stepNo === r.p.stepNo);
    const rec = recs.find((x) => x.stepNo === r.p.stepNo) ?? null;
    pageViews.push({
      paperRecordId: r.p.id,
      reference: r.p.paperReference,
      documentNumber: r.documentNumber,
      status: r.p.status,
      issuedAt: r.p.issuedAt.toISOString(),
      stepNo: r.p.stepNo,
      stepName: r.p.stepName,
      stepKind: step?.stepKind ?? null,
      neverPaperOnly: step ? isNeverPaperOnly(step.stepKind) : false,
      requiresChecker: step?.requiresChecker ?? true,
      requiresEquipment: step?.requiresEquipment ?? false,
      equipmentKind: step?.equipmentKind ?? null,
      checklist: (step?.checklistItems ?? []).map((c) => ({ id: c.id, itemNo: c.itemNo, text: c.text })),
      parameters: (step?.parameters ?? []).map((p) => ({ id: p.id, name: p.name, uom: p.uom, valueKind: p.valueKind, isRequired: p.isRequired, limits: [p.minValue ? `min ${p.minValue}` : null, p.maxValue ? `max ${p.maxValue}` : null].filter(Boolean).join(" · ") || null })),
      stepStatus: rec?.status ?? "pending",
      stepFromPaper: rec?.entrySource === "paper",
      weighings: step && isWeighingStep(step.stepKind) ? weighLines : [],
      entries: await paperEntryCount(db, r.p.id),
    });
  }
  const permsDo: Permission[] = ["production.dispense_record.create", "production.line_clearance.create", "production.process_step_record.create"];
  const permsCheck: Permission[] = [CHECKER_PERMISSION, "production.line_clearance.approve", "production.process_step_record.approve"];
  const merge = async (ps: Permission[]) => {
    const all = (await Promise.all(ps.map((p) => eligibleSigners(db, ctx.organizationId, b.siteId, p)))).flat();
    return [...new Map(all.map((u) => [u.id, { id: u.id, name: u.displayName }])).values()].sort((x, z) => x.name.localeCompare(z.name));
  };
  const scales = await db.select({ code: equipment.code, name: equipment.name, kind: equipment.equipmentKind }).from(equipment).where(eq(equipment.siteId, b.siteId)).orderBy(asc(equipment.code));
  return {
    batch: { id: b.id, number: b.batchNumber, status: b.status, productName: product.name, siteCode },
    pages: pageViews,
    people: { doers: await merge(permsDo), checkers: await merge(permsCheck) },
    equipment: scales,
    outageAllowed: await getSetting(db, ctx.organizationId, "production.paper.outage_entry_allowed", b.siteId),
    outageReasons: Object.entries(OUTAGE_REASONS).map(([value, label]) => ({ value, label })),
    canEnter: ctx.canAt("production.dispense_record.create", b.siteId) || ctx.canAt("production.process_step_record.create", b.siteId) || ctx.canAt("production.line_clearance.create", b.siteId),
  };
}

export type PaperEntryView = Awaited<ReturnType<typeof paperEntryView>>;
