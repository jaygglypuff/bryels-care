import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type DbOrTx } from "@/db/client";
import { batchMaterialPicks, batchMaterials, batches, processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type FormulaSnapshot, addDays, isWeighingStep, manilaToday } from "./shared";
import { finishHref, firstStepNo, flowHref, qualityCheckHref } from "./flow-paths";

/**
 * Production flow v2 (ADR-080, stage G2): the facts of a batch that the simple status read model
 * (`production-order-status.ts`, stage G1) and the order hub need, and the "next screen" of a batch.
 *
 * Pure helpers (no permission check) take facts; `batchFlowFacts` reads them for batches the caller
 * already scoped; `getBatchFlowFacts` is the scoped entry point (permission + site).
 */

/** Step kinds that are a wait (set in mould, cure, rest). Kept in sync with execution.HOLD_STEP_KINDS. */
export const WAIT_STEP_KINDS = ["curing", "hold"] as const;
export const isWaitStep = (kind: string) => (WAIT_STEP_KINDS as readonly string[]).includes(kind);

type Snap = FormulaSnapshot;
type StepRec = typeof processStepRecords.$inferSelect;

export type PickProgress = { lines: number; taken: number; notNeeded: number; complete: boolean };

export type CurrentStepFacts = {
  stepNo: number;
  name: string;
  kind: string;
  /** pending = not started yet (no record). */
  status: "pending" | "in_progress" | "awaiting_check";
  /** 1-based position and the number of steps ("Step 6 of 8"). */
  index: number;
  total: number;
  startedAt: Date | null;
  /** Waiting steps (curing / hold): when the minimum time ends. */
  readyAt: Date | null;
  /** A waiting step that has started and whose minimum time has not ended. */
  waiting: boolean;
  /** "Curing until Fri 28 Nov", "Resting until 14:00", null when not waiting. */
  waitingLabel: string | null;
};

export type BatchFlowFacts = {
  batchId: string;
  batchNumber: string;
  workOrderId: string | null;
  status: string;
  pick: PickProgress;
  currentStep: CurrentStepFacts | null;
  /** Ready date of the current wait (same as currentStep.readyAt when waiting). */
  readyAt: Date | null;
};

const MANILA = "Asia/Manila";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: MANILA, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: MANILA, hour: "2-digit", minute: "2-digit", hour12: false });

/** "Fri 28 Nov" in the plant's time zone (UX word list: dates as "Fri 28 Nov"). */
export function shortDay(d: Date): string {
  return dayFmt.format(d).replace(",", "");
}

/**
 * The operator words for a wait (UX review §4.1): "Curing until Fri 28 Nov", "Resting until 14:00"
 * (same day), "In the mould until Fri 31 Oct" (a curing step whose name says mould).
 */
export function waitLabel(kind: string, name: string, readyAt: Date, now = new Date()): string {
  const word = /mou?ld/i.test(name) ? "In the mould" : kind === "hold" ? "Resting" : "Curing";
  const sameDay = manilaToday(readyAt) === manilaToday(now);
  return `${word} until ${sameDay ? timeFmt.format(readyAt) : shortDay(readyAt)}`;
}

export function sortedSnapshotSteps(snapshot: Snap) {
  return [...snapshot.steps].sort((a, z) => a.stepNo - z.stepNo);
}

/** The first step of the batch that is not completed (or skipped), with its wait facts. Null when all are done. */
export function currentStepOf(snapshot: Snap, recs: Pick<StepRec, "stepNo" | "status" | "startedAt" | "earliestCompletionAt">[], now = new Date()): CurrentStepFacts | null {
  const steps = sortedSnapshotSteps(snapshot);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const r = recs.find((x) => x.stepNo === s.stepNo);
    if (r && (r.status === "completed" || r.status === "skipped")) continue;
    const readyAt = isWaitStep(s.stepKind) && r?.earliestCompletionAt ? r.earliestCompletionAt : null;
    const waiting = !!readyAt && r?.status === "in_progress" && readyAt.getTime() > now.getTime();
    return {
      stepNo: s.stepNo,
      name: s.name,
      kind: s.stepKind,
      status: (r?.status as "in_progress" | "awaiting_check" | undefined) ?? "pending",
      index: i + 1,
      total: steps.length,
      startedAt: r?.startedAt ?? null,
      readyAt,
      waiting,
      waitingLabel: readyAt && r?.status === "in_progress" ? waitLabel(s.stepKind, s.name, readyAt, now) : null,
    };
  }
  return null;
}

/** Current state of each Materials list line: the latest pick row (append-only). */
export function currentPicks<T extends { batchMaterialId: string; action: string; pickedAt: Date; id: string }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of [...rows].sort((a, z) => a.pickedAt.getTime() - z.pickedAt.getTime() || (a.id < z.id ? -1 : 1))) out.set(r.batchMaterialId, r);
  return out;
}

export function pickProgress(lineIds: string[], current: Map<string, { action: string }>): PickProgress {
  let taken = 0;
  let notNeeded = 0;
  for (const id of lineIds) {
    const a = current.get(id)?.action;
    if (a === "taken") taken += 1;
    else if (a === "not_needed") notNeeded += 1;
  }
  return { lines: lineIds.length, taken, notNeeded, complete: lineIds.length > 0 && taken + notNeeded === lineIds.length };
}

/**
 * Batch facts for the status read model, for batch ids the caller has already scoped to its
 * organization and sites (G1's `productionOrderStatus` consumer). One query per table.
 */
export async function batchFlowFacts(q: DbOrTx, batchIds: string[], now = new Date()): Promise<Map<string, BatchFlowFacts>> {
  const out = new Map<string, BatchFlowFacts>();
  if (!batchIds.length) return out;
  const bs = await q.select().from(batches).where(inArray(batches.id, batchIds));
  const recs = await q.select().from(processStepRecords).where(inArray(processStepRecords.batchId, batchIds)).orderBy(asc(processStepRecords.stepNo));
  const lines = await q.select({ id: batchMaterials.id, batchId: batchMaterials.batchId }).from(batchMaterials).where(inArray(batchMaterials.batchId, batchIds));
  const picks = await q
    .select({ id: batchMaterialPicks.id, batchId: batchMaterialPicks.batchId, batchMaterialId: batchMaterialPicks.batchMaterialId, action: batchMaterialPicks.action, pickedAt: batchMaterialPicks.pickedAt })
    .from(batchMaterialPicks)
    .where(inArray(batchMaterialPicks.batchId, batchIds));
  for (const b of bs) {
    const lineIds = lines.filter((l) => l.batchId === b.id).map((l) => l.id);
    const pick = pickProgress(lineIds, currentPicks(picks.filter((p) => p.batchId === b.id)));
    // A batch that got past planning by scan (staging) or without a work order counts as picked.
    if (b.status !== "planned" && b.status !== "draft") pick.complete = true;
    const running = ["planned", "materials_staged", "in_process", "rework_approved"].includes(b.status);
    const currentStep = running ? currentStepOf(b.formulaSnapshot as Snap, recs.filter((r) => r.batchId === b.id), now) : null;
    out.set(b.id, { batchId: b.id, batchNumber: b.batchNumber, workOrderId: b.workOrderId, status: b.status, pick, currentStep, readyAt: currentStep?.waiting ? currentStep.readyAt : null });
  }
  return out;
}

/** Scoped read of the flow facts of one batch (production.batch.view or the warehouse view, site checked). */
export async function getBatchFlowFacts(ctx: AuthContext, q: DbOrTx, batchId: string): Promise<BatchFlowFacts> {
  if (!ctx.can("production.batch.view") && !ctx.can("inventory.movement.post")) ctx.require("production.batch.view");
  const [b] = await q
    .select({ id: batches.id, siteId: batches.siteId })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found in your sites.");
  ctx.requireSite(b.siteId);
  return (await batchFlowFacts(q, [b.id])).get(b.id)!;
}

export type NextScreen = {
  action: "get_materials" | "start" | "weigh" | "step" | "wait" | "finish" | "quality_check" | "none";
  /** Button verb in operator words ("Get materials", "Start", "Weigh", "Mix and pour", "Curing finished", "Go to Finish"). */
  label: string;
  /** Where the button goes; null when there is nothing to do on the floor. */
  href: string | null;
  /** Set when the button is shown disabled (e.g. "Ready on Fri 28 Nov. Ending early needs approval."). */
  disabledReason: string | null;
  stepNo: number | null;
};

/** The G2 operator screen of a batch; a batch without an order uses the `without-order` segment (flow-paths.ts). */
export function flowPath(f: Pick<BatchFlowFacts, "workOrderId" | "batchId">, screen: "materials" | "weigh" | `step/${number}`): string {
  return flowHref(f, screen);
}

/**
 * "What is the next screen for this batch" (ADR-080 §11, one big button). Pure: the hub (G1) calls it
 * with `batchFlowFacts`. Every href is a flow screen (flow-paths.ts), never the read-only batch record.
 */
export function nextBatchScreen(f: BatchFlowFacts, now = new Date(), steps?: { stepNo: number }[]): NextScreen {
  const none: NextScreen = { action: "none", label: "", href: null, disabledReason: null, stepNo: null };
  if (f.status === "planned") {
    if (!f.pick.complete) return { action: "get_materials", label: "Get materials", href: flowPath(f, "materials"), disabledReason: null, stepNo: null };
  }
  if (f.status === "planned" || f.status === "materials_staged") {
    const s = f.currentStep;
    const n = s?.stepNo ?? firstStepNo(steps);
    return { action: "start", label: s?.status === "awaiting_check" ? `Check ${s.name}` : "Start", href: flowPath(f, `step/${n}`), disabledReason: null, stepNo: n };
  }
  if (f.status === "in_process" || f.status === "rework_approved") {
    const s = f.currentStep;
    if (f.status === "rework_approved") return { action: "step", label: "Redo", href: flowPath(f, `step/${s?.stepNo ?? firstStepNo(steps)}`), disabledReason: null, stepNo: s?.stepNo ?? null };
    if (!s) return { action: "finish", label: "Go to Finish", href: finishHref(f.batchId), disabledReason: null, stepNo: null };
    if (isWeighingStep(s.kind)) return { action: "weigh", label: "Weigh", href: flowPath(f, "weigh"), disabledReason: null, stepNo: s.stepNo };
    if (s.kind === "transfer") return { action: "finish", label: "Go to Finish", href: finishHref(f.batchId), disabledReason: null, stepNo: s.stepNo };
    if (isWaitStep(s.kind) && s.status === "in_progress" && s.readyAt) {
      const word = /mou?ld/i.test(s.name) ? "Mould time finished" : s.kind === "hold" ? "Resting finished" : "Curing finished";
      const early = s.readyAt.getTime() > now.getTime();
      return {
        action: "wait",
        label: early ? `${word} · ${shortDay(s.readyAt)}` : word,
        href: flowPath(f, `step/${s.stepNo}`),
        disabledReason: early ? `Ready on ${shortDay(s.readyAt)}. Ending early needs approval.` : null,
        stepNo: s.stepNo,
      };
    }
    return { action: "step", label: s.name, href: flowPath(f, `step/${s.stepNo}`), disabledReason: null, stepNo: s.stepNo };
  }
  if (f.status === "awaiting_qc" || f.status === "quarantined") return { action: "quality_check", label: "Check quality", href: qualityCheckHref(f.batchId), disabledReason: null, stepNo: null };
  return none;
}

/* ================================================================== expiry (ADR-080 §7) */

/**
 * The mixing date: the day (Asia/Manila) the first making step after weighing started (Mix and
 * pour). Falls back to the batch start date (Start check) when no such step has started.
 */
export function mixingDateOf(snapshot: Snap, recs: Pick<StepRec, "stepNo" | "startedAt">[], fallback: Date): string {
  const steps = sortedSnapshotSteps(snapshot);
  const w = steps.findIndex((s) => isWeighingStep(s.stepKind));
  const after = (w >= 0 ? steps.slice(w + 1) : steps).find((s) => !["line_clearance", "checklist", "dispensing", "weighing"].includes(s.stepKind));
  const rec = after ? recs.find((r) => r.stepNo === after.stepNo) : null;
  return manilaToday(rec?.startedAt ?? fallback);
}

/**
 * Manufacture date and expiry of the finished lot: one source for the lot, the BMR and the wrap
 * label. `mixing_date` (ADR-080 §7 default for new organizations): manufacture = mixing date,
 * expiry = mixing date + shelf life. `manufacture_date`: batch start. `packaging_date`: manufacture =
 * batch start, expiry counted from the packaging step's completion (today when not completed yet).
 */
export function batchExpiryDates(
  batch: Pick<typeof batches.$inferSelect, "startedAt" | "formulaSnapshot">,
  steps: { stepNo: number; stepKind: string }[],
  recs: Pick<StepRec, "stepNo" | "startedAt" | "completedAt">[],
  basis: "mixing_date" | "manufacture_date" | "packaging_date",
  shelfLifeDays: number,
  now = new Date(),
): { manufacturedOn: string; expiresOn: string; basis: string } {
  const start = batch.startedAt ?? now;
  if (basis === "mixing_date") {
    const mix = mixingDateOf(batch.formulaSnapshot as Snap, recs, start);
    return { manufacturedOn: mix, expiresOn: addDays(mix, shelfLifeDays), basis };
  }
  const mfg = manilaToday(start);
  if (basis === "packaging_date") {
    const pk = steps.find((s) => s.stepKind === "packaging" || s.stepKind === "filling");
    const pr = pk ? recs.find((r) => r.stepNo === pk.stepNo) : null;
    const basisDate = pr?.completedAt ? manilaToday(pr.completedAt) : manilaToday(now);
    return { manufacturedOn: mfg, expiresOn: addDays(basisDate, shelfLifeDays), basis };
  }
  return { manufacturedOn: mfg, expiresOn: addDays(mfg, shelfLifeDays), basis };
}

/** Latest pick rows of a batch, newest last (for the Materials list screen). */
export async function pickRows(q: DbOrTx, batchId: string) {
  return q.select().from(batchMaterialPicks).where(eq(batchMaterialPicks.batchId, batchId)).orderBy(asc(batchMaterialPicks.pickedAt), asc(batchMaterialPicks.id));
}

/**
 * Flow facts of every live batch of a production order, in batch-number order, scoped to the
 * caller's sites (the G2 screens pick "the batch" from these when the URL names none).
 */
export async function orderBatchFacts(ctx: AuthContext, q: DbOrTx, workOrderId: string): Promise<BatchFlowFacts[]> {
  if (!ctx.can("production.batch.view") && !ctx.can("inventory.movement.post")) ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(workOrderId)) throw new DomainError("not_found", "Production order not found in your sites.");
  const rows = await q
    .select({ id: batches.id, siteId: batches.siteId })
    .from(batches)
    .where(and(eq(batches.workOrderId, workOrderId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .orderBy(asc(batches.batchNumber));
  const facts = await batchFlowFacts(q, rows.map((r) => r.id));
  return rows.map((r) => facts.get(r.id)!).filter((f) => f.status !== "rejected" && f.status !== "closed");
}
