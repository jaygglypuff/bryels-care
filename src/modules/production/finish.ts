import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { batches, locations, products, scrapReworkRecords, workOrders, yieldRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { postMovement } from "@/modules/inventory/ledger";
import { sectionSql } from "@/modules/masterdata";
import { batchLogCounts } from "./daily-log";
import { dispensingBlockers } from "./dispensing";
import { DEVIATION_UNAVAILABLE, executionHooks } from "./execution-hooks";
import { type BatchRow, eligibleSigners, findStepOfKind, sortedSteps, stepRecords } from "./execution";
import { postBatchToQuarantineLocked } from "./output";
import { countPackagingLocked, currentPackaging } from "./packaging";
import { currentReadings } from "./process";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { currentYield, recordScrapReworkLocked, recordYieldLocked, yieldLimits } from "./yield";

/**
 * Finish batch (ADR-080 §6, slice V2-6). ONE transaction that does what the five old commands did one
 * by one: record the good pieces and yield (recordYield), the rejects as scrap per reject type
 * (recordScrapRework), the packaging count (countPackaging), and posting to the hold area with the
 * remaining consumption, the finished lot and the quality check task (postBatchToQuarantine). It calls
 * the `…Locked` bodies of those commands under one batch lock, so their rules are the same; lock order
 * as postMovement: batch → packaging rows → lots in id order → balances.
 *
 * Counts are typed once (ADR-080 §6): good pieces and rejects come from the daily log of this batch
 * when there are entries (read-back; the operator may change them), otherwise the operator types them.
 * Only damaged and left-over wrappers are typed. Wrapper arithmetic (QA review S4):
 *
 *   taken = used + damaged + left over,   used = good pieces (samples included) + rejects already wrapped
 *
 * and the difference must be within the packaging tolerance (default 0), else Finish is refused.
 * Samples kept come out of the good pieces (sellable = good − samples) and leave stock as a retained
 * sample movement. A yield outside the range, or rejects above the approval threshold, need a reason
 * and open a problem report (deviation) through the execution hook; QA cannot pass while it is open.
 */

export type FinishReject = { type: string; qty: string | number; kind?: "scrap" | "rework"; reasonCode?: string | null };
export type FinishPackaging = { materialId: string; damaged?: string | number | null; leftOver?: string | number | null; used?: string | number | null };

export type FinishBatchInput = {
  batchId: string;
  /** Typed good pieces; null/undefined = take them from the daily log. */
  goodUnits?: string | number | null;
  /** Typed rejects; null/undefined = take them from the daily log. */
  rejects?: FinishReject[] | null;
  /** Rejects found after wrapping (they used a wrapper). Default 0. */
  rejectsWrapped?: string | number | null;
  /** Samples kept; null/undefined = the setting production.output.retained_samples. */
  samplesKept?: string | number | null;
  packaging?: FinishPackaging[] | null;
  /** Hold location (code, BC:LOC payload or id); default production.output.default_hold_location. */
  locationRef?: string | null;
  /** Needed when the yield is outside the range or rejects are above the approval threshold. */
  problemReason?: string | null;
  idempotencyKey: string;
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim().replace(/,/g, ""));

function wholeNumber(v: unknown, label: string, field: string, min = 0): Decimal {
  const t = s(v);
  if (!/^\d{1,9}$/.test(t)) throw new DomainError("validation", `${label}: enter a whole number, for example 12.`, { field, fieldErrors: { [field]: "Enter a whole number." } });
  const d = new Decimal(t);
  if (d.lt(min)) throw new DomainError("validation", `${label} must be at least ${min}.`, { field, fieldErrors: { [field]: `At least ${min}.` } });
  return d;
}

/** The hold location Finish uses: the given one, the site setting, or the first quarantine location in section qa_hold. */
export async function defaultHoldLocation(q: DbOrTx, organizationId: string, siteId: string) {
  const code = await getSetting(q, organizationId, "production.output.default_hold_location", siteId);
  if (code) {
    const [l] = await q.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code.toUpperCase()))).limit(1);
    if (l && l.kind === "quarantine" && l.isActive) return l;
  }
  const rows = (await q.execute(sql`
    select l.id from locations l left join warehouses w on w.id = l.warehouse_id
    where l.site_id = ${siteId} and l.kind = 'quarantine' and l.is_active and ${sectionSql("l", "w")} = 'qa_hold'
    order by l.code limit 1`)) as unknown as { id: string }[];
  if (!rows[0]) return null;
  const [l] = await q.select().from(locations).where(eq(locations.id, rows[0].id)).limit(1);
  return l ?? null;
}

async function productOf(q: DbOrTx, batch: BatchRow) {
  const [p] = await q.select().from(products).where(eq(products.id, batch.productId)).limit(1);
  if (!p) throw new DomainError("not_found", "Product not found.");
  return p;
}

/** Expected pieces of the batch: theoretical yield ÷ unit net mass, rounded down. */
function expectedUnits(batch: BatchRow, unitNetMassG: string) {
  const m = new Decimal(unitNetMassG);
  if (m.lte(0)) return null;
  return new Decimal(batch.theoreticalYieldG ?? 0).div(m).floor();
}

async function liveScrap(q: DbOrTx, batchId: string) {
  return q.select().from(scrapReworkRecords).where(and(eq(scrapReworkRecords.batchId, batchId), isNull(scrapReworkRecords.voidedAt)));
}

/** Packaging components of the batch grouped by material: taken (issued), counted rows, open rows. */
async function packagingGroups(q: DbOrTx, batchId: string) {
  const rows = (await currentPackaging(q, batchId)).sort((a, b) => a.r.issuedAt.getTime() - b.r.issuedAt.getTime());
  const groups = new Map<string, { materialId: string; materialCode: string; materialName: string; uom: string; rows: typeof rows }>();
  for (const x of rows) {
    const g = groups.get(x.r.materialId) ?? { materialId: x.r.materialId, materialCode: x.materialCode, materialName: x.materialName, uom: x.r.baseUom, rows: [] as typeof rows };
    g.rows.push(x);
    groups.set(x.r.materialId, g);
  }
  return [...groups.values()].map((g) => {
    const sum = (f: (r: (typeof rows)[number]["r"]) => string | null) => g.rows.reduce((t, x) => t.plus(f(x.r) ?? 0), new Decimal(0));
    const counted = g.rows.every((x) => !!x.r.countedAt);
    return {
      ...g,
      taken: sum((r) => r.issuedQty),
      counted,
      used: sum((r) => r.usedQty),
      damaged: sum((r) => r.damagedQty),
      leftOver: sum((r) => r.returnedQty),
      variance: sum((r) => r.varianceQty),
    };
  });
}

/**
 * Wrapper counts already written on the packaging step (consultant review: "count once"). The seeded
 * packaging step has the fields "Wrappers used" and "Wrappers destroyed"; any numeric field of the
 * step whose code says destroyed/damaged, left/returned or used is read. Only when ONE packaging
 * material was issued on that step: with several (wrappers and labels), a field cannot be tied to one
 * material and nothing is prefilled. Assumption A-CR-03 (docs/PRD.md): field codes are configuration.
 */
export type StepPackagingCounts = { stepNo: number; used: string | null; damaged: string | null; leftOver: string | null };

export async function stepPackagingCounts(q: DbOrTx, batchId: string): Promise<Map<string, StepPackagingCounts>> {
  const out = new Map<string, StepPackagingCounts>();
  const rows = await currentPackaging(q, batchId);
  const recs = await stepRecords(q, batchId);
  const byRec = new Map<string, Set<string>>();
  for (const x of rows) byRec.set(x.r.processStepRecordId, (byRec.get(x.r.processStepRecordId) ?? new Set()).add(x.r.materialId));
  for (const [recId, mats] of byRec) {
    if (mats.size !== 1) continue;
    const materialId = [...mats][0];
    const recsOfMaterial = new Set(rows.filter((x) => x.r.materialId === materialId).map((x) => x.r.processStepRecordId));
    if (recsOfMaterial.size !== 1) continue;
    const readings = (await currentReadings(q, recId)).filter((r) => r.valueNumeric !== null);
    const pick = (re: RegExp, not?: RegExp) => {
      const r = readings.find((x) => re.test(x.parameterCode) && !(not && not.test(x.parameterCode)));
      return r ? new Decimal(r.valueNumeric!).toString() : null;
    };
    const damaged = pick(/destroy|damag/i);
    const leftOver = pick(/left|return/i);
    const used = pick(/used/i, /destroy|damag|left|return/i);
    if (damaged === null && leftOver === null && used === null) continue;
    out.set(materialId, { stepNo: recs.find((r) => r.id === recId)?.stepNo ?? 0, used, damaged, leftOver });
  }
  return out;
}

/* ------------------------------------------------------------------ read model for the Finish screen */

export async function getFinishView(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new DomainError("not_found", "Batch not found.");
  const [batch] = await db.select().from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!batch) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(batch.siteId);
  const product = await productOf(db, batch);
  const [wo] = batch.workOrderId ? await db.select({ id: workOrders.id, number: workOrders.workOrderNumber }).from(workOrders).where(eq(workOrders.id, batch.workOrderId)).limit(1) : [];
  const steps = sortedSteps(batch.formulaSnapshot as FormulaSnapshot);
  const recs = await stepRecords(db, batch.id);
  const openSteps = steps.filter((x) => x.stepKind !== "transfer" && recs.find((r) => r.stepNo === x.stepNo)?.status !== "completed");
  const blockers: string[] = [];
  if (batch.status !== "in_process") blockers.push(batch.status === "awaiting_qc" || batch.status === "quarantined" ? "This batch is already finished. It is waiting for the quality check." : `This batch is ${batch.status.replace(/_/g, " ")}.`);
  else {
    if (openSteps.length) blockers.push(`Finish step ${openSteps[0].stepNo} (${openSteps[0].name}) first.`);
    blockers.push(...(await dispensingBlockers(db, batch)));
  }
  const log = await batchLogCounts(db, batch);
  const scrap = await liveScrap(db, batch.id);
  const y = await currentYield(db, batch.id);
  const samples = await getSetting(db, ctx.organizationId, "production.output.retained_samples", batch.siteId);
  const limits = await yieldLimits(db, ctx.organizationId, batch.siteId, product.skuCode);
  const hold = await defaultHoldLocation(db, ctx.organizationId, batch.siteId);
  const holdOptions = await db
    .select({ id: locations.id, code: locations.code, name: locations.name })
    .from(locations)
    .where(and(eq(locations.siteId, batch.siteId), eq(locations.kind, "quarantine"), eq(locations.isActive, true)))
    .orderBy(asc(locations.code));
  const transfer = findStepOfKind(batch, ["transfer"]);
  const needsChecker = transfer ? transfer.requiresChecker : false;
  const checkers = needsChecker ? (await eligibleSigners(db, ctx.organizationId, batch.siteId, "production.process_step_record.approve")).filter((u) => u.id !== ctx.userId) : [];
  const defectTypes = await getSetting(db, ctx.organizationId, "production.defect_types", batch.siteId);
  const stepCounts = await stepPackagingCounts(db, batch.id);
  // Rejects above this many pieces need a problem report at Finish (recordScrapReworkLocked, setting production.scrap.approval_threshold_pct).
  const scrapPct = await getSetting(db, ctx.organizationId, "production.scrap.approval_threshold_pct", batch.siteId);
  const unitMass = new Decimal(product.unitNetMassG);
  const rejectLimit = unitMass.gt(0) ? new Decimal(batch.theoreticalYieldG ?? 0).div(unitMass).mul(scrapPct).div(100) : null;
  return {
    batch: { id: batch.id, number: batch.batchNumber, status: batch.status, siteId: batch.siteId, theoreticalYieldG: batch.theoreticalYieldG },
    order: wo ?? null,
    product: { name: product.name, family: product.family, unitNetMassG: product.unitNetMassG, uom: product.baseUom },
    expectedUnits: expectedUnits(batch, product.unitNetMassG)?.toString() ?? null,
    limits,
    blockers,
    log: { entries: log.entries, days: log.days, good: log.good.toString(), rejects: log.rejects.map((r) => ({ type: r.type, qty: r.qty.toString() })) },
    existing: {
      yieldUnits: y?.actualUnits ? new Decimal(y.actualUnits).toString() : null,
      scrap: scrap.map((r) => ({ kind: r.recordKind, reasonCode: r.reasonCode, qty: new Decimal(r.qty).toString(), note: r.note })),
    },
    samples: { enabled: samples.enabled, units: samples.enabled ? samples.units : 0 },
    /** When the rejects need a problem report: more than `limit` pieces, or earlier scrap already waiting for approval. */
    rejectApproval: { limit: rejectLimit?.toString() ?? null, existingNeedsApproval: scrap.some((r) => r.requiresApproval && r.status === "recorded"), reportOpen: !!y?.deviationId },
    packaging: (await packagingGroups(db, batch.id)).map((g) => ({
      materialId: g.materialId,
      materialCode: g.materialCode,
      materialName: g.materialName,
      uom: g.uom,
      taken: g.taken.toString(),
      counted: g.counted,
      used: g.used.toString(),
      damaged: g.damaged.toString(),
      leftOver: g.leftOver.toString(),
      step: stepCounts.get(g.materialId) ?? null,
    })),
    hold: hold ? { id: hold.id, code: hold.code, name: hold.name } : null,
    holdOptions,
    needsChecker,
    checkers,
    defectTypes,
    can: { finish: ctx.canAt("production.batch.post", batch.siteId) && ctx.canAt("production.yield_record.create", batch.siteId) && ctx.canAt("production.batch_output.create", batch.siteId) },
  };
}
export type FinishView = Awaited<ReturnType<typeof getFinishView>>;

/* ------------------------------------------------------------------ command */

export async function finishBatch(ctx: AuthContext, input: FinishBatchInput, signers: { checker?: AuthContext | null } = {}) {
  ctx.require("production.batch.post");
  ctx.require("production.batch.submit");
  ctx.require("production.batch_output.create");
  ctx.require("production.yield_record.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result, replayed } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch.finish", () => finishLocked(tx, ctx, batch, input, signers));
    return { ...result, replayed };
  });
}

async function finishLocked(tx: Tx, ctx: AuthContext, batch: BatchRow, input: FinishBatchInput, signers: { checker?: AuthContext | null }) {
  if (batch.status !== "in_process") {
    throw new DomainError("state", batch.status === "awaiting_qc" || batch.status === "quarantined" ? `Batch ${batch.batchNumber} is already finished and waiting for the quality check.` : `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; only a batch being made can be finished.`);
  }
  const product = await productOf(tx, batch);
  const log = await batchLogCounts(tx, batch);

  // 1. Good pieces: typed, else the daily log (read-back).
  const typedGood = s(input.goodUnits) !== "";
  if (!typedGood && log.good.lte(0)) {
    throw new DomainError("validation", "Nothing was written in the daily log for this batch. Enter how many good pieces were made.", { field: "goodUnits", fieldErrors: { goodUnits: "Enter the good pieces." } });
  }
  const good = typedGood ? wholeNumber(input.goodUnits, "Good pieces", "goodUnits", 1) : log.good;
  if (!good.isInteger() || good.lte(0)) throw new DomainError("validation", "Good pieces must be a whole number greater than zero.", { field: "goodUnits" });

  // 2. Rejects by type: typed, else the daily log. Already recorded scrap (old batch screen) is kept as it is.
  const existingScrap = await liveScrap(tx, batch.id);
  const allowedTypes = await getSetting(tx, ctx.organizationId, "production.defect_types", batch.siteId);
  const typedRejects = Array.isArray(input.rejects);
  const rejectsIn: FinishReject[] = typedRejects ? input.rejects! : log.rejects.map((r) => ({ type: r.type, qty: r.qty.toString() }));
  const seen = new Set<string>();
  const rejects = rejectsIn
    .filter((r) => s(r.qty) !== "" && s(r.qty) !== "0")
    .map((r, i) => {
      const known = allowedTypes.find((t) => t.toLowerCase() === (r.type ?? "").trim().toLowerCase());
      // A type removed from the list after it was logged is kept as logged (the log is the record).
      const type = known ?? (typedRejects ? null : r.type.trim());
      if (!type) throw new DomainError("validation", `"${r.type}" is not in the reject list. Choose one of: ${allowedTypes.join(", ")}.`, { field: `rejects.${i}.type` });
      if (seen.has(type.toLowerCase())) throw new DomainError("validation", `${type} is listed twice. Add the numbers together in one line.`, { field: `rejects.${i}.type` });
      seen.add(type.toLowerCase());
      return { type, qty: wholeNumber(r.qty, `Rejects (${type})`, `rejects.${i}.qty`, 1), kind: r.kind === "rework" ? ("rework" as const) : ("scrap" as const), reasonCode: r.reasonCode?.trim() || "other" };
    });
  const rejectTotal = rejects.reduce((t, r) => t.plus(r.qty), new Decimal(0));
  const recordRejects = existingScrap.length === 0 && rejects.length > 0;
  if (recordRejects) ctx.require("production.scrap_rework_record.create");
  const rejectsWrapped = s(input.rejectsWrapped) === "" ? new Decimal(0) : wholeNumber(input.rejectsWrapped, "Rejects already wrapped", "rejectsWrapped");
  const rejectsCounted = recordRejects ? rejectTotal : existingScrap.reduce((t, r) => t.plus(r.qty), new Decimal(0));
  if (rejectsWrapped.gt(rejectsCounted)) throw new DomainError("validation", "Rejects already wrapped cannot be more than the rejects.", { field: "rejectsWrapped" });

  // 3. Samples kept: out of the good pieces (QA review S4).
  const sampleSetting = await getSetting(tx, ctx.organizationId, "production.output.retained_samples", batch.siteId);
  const samples = s(input.samplesKept) === "" ? new Decimal(sampleSetting.enabled ? sampleSetting.units : 0) : wholeNumber(input.samplesKept, "Samples kept", "samplesKept");
  if (samples.gte(good)) throw new DomainError("validation", "Samples kept must be fewer than the good pieces.", { field: "samplesKept", fieldErrors: { samplesKept: "Fewer than the good pieces." } });

  // 4. Yield (recordYield body). An earlier record from the old screen is reused or corrected.
  const prev = await currentYield(tx, batch.id);
  let yieldRecordId: string;
  let within: boolean;
  let yieldPct: string;
  let range: { min: number; max: number };
  if (prev && new Decimal(prev.actualUnits ?? 0).eq(good)) {
    yieldRecordId = prev.id;
    within = prev.isWithinLimits;
    yieldPct = new Decimal(prev.yieldPct).toString();
    range = { min: Number(prev.minPct), max: Number(prev.maxPct) };
  } else {
    const y = await recordYieldLocked(tx, ctx, batch, { actualUnits: good.toString(), correctionReason: prev ? "Counts confirmed at Finish" : null });
    yieldRecordId = y.yieldRecordId;
    within = y.within;
    yieldPct = new Decimal(y.yieldPct).toString();
    range = y.range;
  }

  // 5. Rejects as scrap/rework records (recordScrapRework body), one per reject type.
  let overThreshold = existingScrap.some((r) => r.requiresApproval && r.status === "recorded");
  if (recordRejects) {
    for (const r of rejects) {
      const rec = await recordScrapReworkLocked(tx, ctx, batch, { kind: r.kind, reasonCode: r.reasonCode, qty: r.qty.toString(), note: `Reject: ${r.type}` });
      if (rec.requiresApproval) overThreshold = true;
    }
  }

  // 6. Problem report for a yield outside the range or rejects above the threshold (existing deviation hook).
  let deviation: { deviationId: string; deviationNumber?: string } | null = null;
  const [yrow] = await tx.select().from(yieldRecords).where(eq(yieldRecords.id, yieldRecordId)).limit(1);
  const needsReport = (!within && !(yrow.approvedBy && yrow.deviationId)) || overThreshold;
  if (needsReport && !yrow.deviationId) {
    const reason = (input.problemReason ?? "").trim();
    const expected = expectedUnits(batch, product.unitNetMassG);
    const what = [!within ? `made ${good.toString()} of ${expected?.toString() ?? "?"} expected (${yieldPct} %, OK from ${range.min} to ${range.max} %)` : null, overThreshold ? `rejects ${rejectsCounted.toString()} are above the approval limit` : null].filter(Boolean).join("; ");
    if (reason.length < 10) {
      throw new DomainError("validation", `This batch ${what}. Write what happened (at least 10 characters); a problem report is opened for QA.`, {
        field: "problemReason",
        fieldErrors: { problemReason: "Write what happened (at least 10 characters)." },
        yieldPct,
        range,
      });
    }
    const opener = executionHooks().openDeviation;
    if (!opener) throw new DomainError("state", DEVIATION_UNAVAILABLE, { rule: "A-PROC-33" });
    deviation = await opener(tx, ctx, {
      kind: !within ? "yield_out_of_range" : "other",
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      siteId: batch.siteId,
      description: `Finish of batch ${batch.batchNumber}: ${what}. Operator: ${reason}`,
      approvedBy: ctx.userId,
    });
    await tx
      .update(yieldRecords)
      .set({ deviationId: deviation.deviationId, notes: [yrow.notes, `Finish: ${reason}`].filter(Boolean).join(" · ") })
      .where(eq(yieldRecords.id, yieldRecordId));
  }

  // 7. Packaging count (countPackaging body): only damaged and left over are typed.
  const groups = await packagingGroups(tx, batch.id);
  const pkgIn = new Map((input.packaging ?? []).map((p) => [p.materialId, p]));
  const pkgSummary: { material: string; taken: string; used: string; damaged: string; leftOver: string; source: "finish" | "step" }[] = [];
  for (const g of groups) {
    if (g.counted) {
      pkgSummary.push({ material: g.materialCode, taken: g.taken.toString(), used: g.used.toString(), damaged: g.damaged.toString(), leftOver: g.leftOver.toString(), source: "step" });
      continue;
    }
    const p = pkgIn.get(g.materialId);
    const field = `pkg-${g.materialId}`;
    if (!p) throw new DomainError("validation", `Count the ${g.materialName}: how many are damaged and how many are left over.`, { field, fieldErrors: { [field]: "Enter damaged and left over (0 if none)." } });
    const damaged = s(p.damaged) === "" ? new Decimal(0) : wholeNumber(p.damaged, `Damaged ${g.materialName}`, `${field}-damaged`);
    const leftOver = s(p.leftOver) === "" ? new Decimal(0) : wholeNumber(p.leftOver, `${g.materialName} left over`, `${field}-leftOver`);
    const used = s(p.used) === "" ? good.plus(rejectsWrapped) : wholeNumber(p.used, `${g.materialName} used`, `${field}-used`);
    // Spread over the open rows in issue order; rows already counted keep their counts.
    const open = g.rows.filter((x) => !x.r.countedAt);
    const fixed = g.rows.filter((x) => x.r.countedAt);
    let remUsed = used.minus(fixed.reduce((t, x) => t.plus(x.r.usedQty ?? 0), new Decimal(0)));
    let remDamaged = damaged.minus(fixed.reduce((t, x) => t.plus(x.r.damagedQty ?? 0), new Decimal(0)));
    let remLeft = leftOver.minus(fixed.reduce((t, x) => t.plus(x.r.returnedQty ?? 0), new Decimal(0)));
    if (remUsed.lt(0)) remUsed = new Decimal(0);
    if (remDamaged.lt(0)) remDamaged = new Decimal(0);
    if (remLeft.lt(0)) remLeft = new Decimal(0);
    for (const [i, x] of open.entries()) {
      const last = i === open.length - 1;
      let cap = new Decimal(x.r.issuedQty);
      const take = (rem: Decimal) => {
        const t = last ? rem : Decimal.min(rem, cap);
        cap = cap.minus(t);
        return t;
      };
      const u = take(remUsed);
      const d = take(remDamaged);
      const l = last ? Decimal.min(remLeft, new Decimal(x.r.issuedQty)) : take(remLeft);
      remUsed = remUsed.minus(u);
      remDamaged = remDamaged.minus(d);
      remLeft = remLeft.minus(l);
      await countPackagingLocked(tx, ctx, batch, { reconciliationId: x.r.id, used: u.toString(), damaged: d.toString(), returned: l.toString() });
    }
    const after = (await packagingGroups(tx, batch.id)).find((x) => x.materialId === g.materialId)!;
    const bad = after.rows.find((x) => x.r.isWithinTolerance === false);
    if (bad) {
      const diff = g.taken.minus(used).minus(damaged).minus(leftOver);
      const msg = diff.gt(0)
        ? `${diff.toString()} ${g.materialName} missing: ${g.taken.toString()} taken, ${used.toString()} used, ${damaged.toString()} damaged, ${leftOver.toString()} left over. Count again.`
        : `${diff.abs().toString()} ${g.materialName} too many: ${g.taken.toString()} taken, but ${used.toString()} used + ${damaged.toString()} damaged + ${leftOver.toString()} left over. Count again.`;
      throw new DomainError("state", msg, { field, fieldErrors: { [field]: msg }, rule: "V-RECON", difference: diff.toString() });
    }
    pkgSummary.push({ material: g.materialCode, taken: g.taken.toString(), used: used.toString(), damaged: damaged.toString(), leftOver: leftOver.toString(), source: "finish" });
  }

  // 8. Hold area: post consumption, the finished lot, the output and the quality check task (postBatchToQuarantine body).
  let locationRef = input.locationRef?.trim() || null;
  if (!locationRef) {
    const hold = await defaultHoldLocation(tx, ctx.organizationId, batch.siteId);
    if (!hold) throw new DomainError("state", "This site has no hold area location for finished batches. Ask an administrator to add one (section Waiting for QA / on hold).");
    locationRef = hold.id;
  }
  const posted = await postBatchToQuarantineLocked(tx, ctx, batch, { locationRef }, signers, { finishDeviation: !!(deviation || yrow.deviationId) });

  // 9. Retained samples leave stock (kept by QA, not for sale).
  if (samples.gt(0)) {
    await postMovement(tx, ctx, {
      movementType: "consumption",
      lotId: posted.lotId,
      fromLocationId: posted.locationId,
      qtyBase: samples,
      sourceDocumentType: "batch_retained_sample",
      sourceDocumentId: batch.id,
      sourceDocumentNumber: batch.batchNumber,
      reason: "Retained samples kept for QA (not for sale)",
      idempotencyKey: `retained-sample:${batch.id}`,
      meta: { batchId: batch.id, samples: samples.toString() },
    });
  }

  const result = {
    batchNumber: batch.batchNumber,
    lotNumber: posted.lotNumber,
    lotId: posted.lotId,
    location: posted.location,
    expiresOn: posted.expiresOn,
    goodUnits: good.toString(),
    sellableUnits: good.minus(samples).toString(),
    samplesKept: samples.toString(),
    rejects: rejectsCounted.toString(),
    rejectsWrapped: rejectsWrapped.toString(),
    yieldPct,
    within,
    countsFrom: typedGood ? ("typed" as const) : ("daily_log" as const),
    deviationId: deviation?.deviationId ?? yrow.deviationId ?? null,
    deviationNumber: deviation?.deviationNumber ?? null,
    inspectionId: posted.inspectionId,
  };
  await audit(tx, ctx, {
    action: "production.batch.finished",
    entityType: "batch",
    entityId: batch.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    reason: input.problemReason?.trim() || null,
    after: {
      ...result,
      logGood: log.good.toString(),
      logEntries: log.entries,
      rejectsByType: rejects.map((r) => ({ type: r.type, qty: r.qty.toString(), kind: r.kind })),
      rejectsRecordedBefore: existingScrap.length > 0,
      packaging: pkgSummary,
      checker: signers.checker?.displayName ?? null,
    },
  });
  return result;
}
