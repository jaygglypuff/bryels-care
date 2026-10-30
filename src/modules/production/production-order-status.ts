/**
 * Production order status v2 (ADR-080 §1, supersedes ADR-074 §1). A production order is a work
 * order with its batches. Owners and operators see ONE list of statuses everywhere (chip, progress
 * strip, list filter, board columns):
 *
 *   Draft → Approved → In progress → Quality check → Done      (end states off the strip: Failed, Cancelled)
 *
 * The mapping is a pure read model over the unchanged state machines (work-orders-state.ts, state.ts).
 * The order shows its LEAST ADVANCED LIVE batch that is not decided yet; when every live batch is
 * decided by QA the order is Done (or Failed when every batch failed). "Live" = every batch except
 * one abandoned before it started (rejected without a start time), the rule syncWorkOrderProgress uses.
 *
 * | Work order                | Least advanced undecided live batch            | Shown                                        |
 * |---------------------------|------------------------------------------------|----------------------------------------------|
 * | draft, planned            | any                                            | Draft                                        |
 * | cancelled                 | any                                            | Cancelled                                    |
 * | released … closed         | planned (no material taken)                    | Approved                                     |
 * | released … closed         | planned (at least one material taken)          | Approved · Getting materials                 |
 * | released … closed         | materials_staged                               | Approved · Materials ready                   |
 * | released … closed         | in_process, open curing/hold step, not over    | In progress · Curing (Resting) until Fri 28 Nov |
 * | released … closed         | in_process, open curing/hold step, time over   | In progress · Curing time over               |
 * | released … closed         | in_process, otherwise                          | In progress · <current or next step name>    |
 * | released … closed         | in_process, every step done                    | In progress · Ready to finish                |
 * | released … closed         | rework_approved                                | In progress · Redo                           |
 * | released … closed         | awaiting_qc, quarantined (lot not on hold)     | Quality check                                |
 * | released … closed         | awaiting_qc, quarantined, lot on_hold ("Not yet") | Quality check · On hold (amber)           |
 * | released … closed         | none: every live batch passed or some failed   | Done (+ warning "1 of 2 batches failed")     |
 * | released … closed         | none: every live batch failed                  | Failed                                       |
 * | released, in_progress     | no live batch at all                           | Approved / In progress (legacy rows)         |
 * | completed, closed         | no live batch at all                           | Done (legacy rows)                           |
 *
 * Passed = batch `released`, or `closed` without ever having been `rejected`. Failed = `rejected`
 * (after it started), or `closed` after a rejection. Done therefore means QA decided, NOT "moved to
 * the hold area": a work order becomes `completed` when its last batch reaches QA, which is still
 * "Quality check" here (ADR-080 §1).
 *
 * No server-only import: client components and unit tests use it.
 */
export const PRODUCTION_ORDER_STATUSES = ["draft", "approved", "in_progress", "quality_check", "done", "failed", "cancelled"] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export const PRODUCTION_ORDER_LABEL: Record<ProductionOrderStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  in_progress: "In progress",
  quality_check: "Quality check",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Status chip key (src/ui/status.tsx) per production order status (icon + label + colour, never colour alone). */
export const PRODUCTION_ORDER_CHIP: Record<ProductionOrderStatus, string> = {
  draft: "draft",
  approved: "confirmed",
  in_progress: "in_progress",
  quality_check: "awaiting_qc",
  done: "completed",
  failed: "rejected",
  cancelled: "cancelled",
};

/** The five steps of the progress strip. Failed and Cancelled are end states shown as a banner instead. */
export const PRODUCTION_ORDER_STEPS: readonly ProductionOrderStatus[] = ["draft", "approved", "in_progress", "quality_check", "done"];

/** Filters of the orders list: Open (default) = not Done, Failed or Cancelled. */
export const OPEN_STATUSES: readonly ProductionOrderStatus[] = ["draft", "approved", "in_progress", "quality_check"];

export type StepFact = {
  stepNo: number;
  name: string;
  kind: string | null;
  status: string;
  earliestCompletionAt: Date | string | null;
  conductedBy?: string | null;
};

export type BatchFact = {
  id: string;
  batchNumber: string;
  status: string;
  startedAt: Date | string | null;
  /** The batch passed through `rejected` at some time (a closed batch then counts as failed). */
  everRejected?: boolean;
  /** Quality status of the finished lot, when one exists (`on_hold` = QA said "Not yet"). */
  lotStatus?: string | null;
  /** Steps of the frozen routing (snapshot), in order. */
  plannedSteps?: { stepNo: number; name: string; stepKind: string }[];
  /** Step records of the batch (process_step_records). */
  stepRecords?: StepFact[];
  /** Materials list progress: lines with something taken (staged) / lines in total. */
  materialsTaken?: number;
  materialsTotal?: number;
};

export type BatchStage = "approved" | "in_progress" | "quality_check" | "passed" | "failed";

export type BatchStatusView = {
  /** The underlying batch state (state.ts). */
  batchStatus: string;
  stage: BatchStage;
  /** Order status this batch would give the order on its own. */
  status: ProductionOrderStatus;
  subtitle: string | null;
  /** Amber tone: QA "Not yet" (lot on hold). */
  warn: boolean;
  /** The step the batch is on (open step, else the next one not done). */
  step: { stepNo: number; name: string; kind: string; status: string; conductedBy: string | null } | null;
  stepsTotal: number;
  /** Curing/resting: when the minimum time ends (ISO), and whether it is over. */
  waitUntil: string | null;
  waitOver: boolean;
};

const RANK: Record<BatchStage, number> = { approved: 0, in_progress: 1, quality_check: 2, passed: 3, failed: 3 };

const toDate = (v: Date | string | null | undefined) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(v));

/** A batch abandoned before it started does not count (same rule as syncWorkOrderProgress). */
export function isLiveBatch(b: { status: string; startedAt: Date | string | null }) {
  return b.status !== "rejected" || b.startedAt !== null;
}

const MANILA = "Asia/Manila";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: MANILA });

/** "Fri 28 Nov" in the plant's time zone (UX word list: dates as "Fri 28 Nov", never relative only). */
export function shortDay(v: Date | string): string {
  const d = toDate(v)!;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: MANILA, weekday: "short", day: "numeric", month: "short" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("weekday")} ${g("day")} ${g("month")}`;
}

/** "Fri 28 Nov", or "14:00" when it is today (lotion resting). */
export function untilWord(v: Date | string, now: Date): string {
  const d = toDate(v)!;
  if (dayKey(d) === dayKey(now)) return d.toLocaleTimeString("en-GB", { timeZone: MANILA, hour: "2-digit", minute: "2-digit" });
  return shortDay(d);
}

const WAIT_KINDS = ["curing", "hold"];
const OPEN_STEP = ["in_progress", "awaiting_check"];
const DONE_STEP = ["completed", "skipped"];

/** The simple status of one batch (the building block of the order status). */
export function batchStatusView(b: BatchFact, now: Date = new Date()): BatchStatusView {
  const planned = [...(b.plannedSteps ?? [])].sort((x, y) => x.stepNo - y.stepNo);
  const records = b.stepRecords ?? [];
  const stepsTotal = planned.length || records.length;
  const base = { batchStatus: b.status, subtitle: null, warn: false, step: null, stepsTotal, waitUntil: null, waitOver: false };
  switch (b.status) {
    case "draft":
    case "planned":
      return { ...base, stage: "approved", status: "approved", subtitle: (b.materialsTaken ?? 0) > 0 ? "Getting materials" : null };
    case "materials_staged":
      return { ...base, stage: "approved", status: "approved", subtitle: "Materials ready" };
    case "rework_approved":
      return { ...base, stage: "in_progress", status: "in_progress", subtitle: "Redo" };
    case "in_process": {
      const open = records.filter((r) => OPEN_STEP.includes(r.status)).sort((x, y) => x.stepNo - y.stepNo)[0];
      if (open) {
        const kind = open.kind ?? planned.find((p) => p.stepNo === open.stepNo)?.stepKind ?? "process";
        const step = { stepNo: open.stepNo, name: open.name, kind, status: open.status, conductedBy: open.conductedBy ?? null };
        const until = toDate(open.earliestCompletionAt);
        if (WAIT_KINDS.includes(kind) && open.status === "in_progress" && until) {
          const word = kind === "hold" ? "Resting" : "Curing";
          const over = until.getTime() <= now.getTime();
          return { ...base, stage: "in_progress", status: "in_progress", step, waitUntil: until.toISOString(), waitOver: over, subtitle: over ? `${word} time over` : `${word} until ${untilWord(until, now)}` };
        }
        return { ...base, stage: "in_progress", status: "in_progress", step, subtitle: open.status === "awaiting_check" ? `${open.name} · waiting for a check` : open.name };
      }
      const done = new Set(records.filter((r) => DONE_STEP.includes(r.status)).map((r) => r.stepNo));
      const next = planned.find((p) => !done.has(p.stepNo));
      if (next) return { ...base, stage: "in_progress", status: "in_progress", step: { stepNo: next.stepNo, name: next.name, kind: next.stepKind, status: "pending", conductedBy: null }, subtitle: next.name };
      return { ...base, stage: "in_progress", status: "in_progress", subtitle: "Ready to finish" };
    }
    case "awaiting_qc":
    case "quarantined":
      return b.lotStatus === "on_hold" ? { ...base, stage: "quality_check", status: "quality_check", subtitle: "On hold", warn: true } : { ...base, stage: "quality_check", status: "quality_check" };
    case "released":
      return { ...base, stage: "passed", status: "done" };
    case "closed":
      return b.everRejected ? { ...base, stage: "failed", status: "failed" } : { ...base, stage: "passed", status: "done" };
    case "rejected":
      return { ...base, stage: "failed", status: "failed" };
    default:
      throw new Error(`Unknown batch status: ${b.status}`);
  }
}

export type ProductionOrderStatusView = {
  status: ProductionOrderStatus;
  label: string;
  subtitle: string | null;
  warn: boolean;
  /** Live batches and how many are decided by QA ("1 of 2 done"). */
  batchesTotal: number;
  batchesDone: number;
  batchesFailed: number;
  /** "1 of 2 done" for multi-batch orders, else null. */
  batchesNote: string | null;
  /** Done with some failed batches: "1 of 2 batches failed". */
  warning: string | null;
  /** The batch the status comes from (least advanced, undecided), when there is one. */
  leadBatchId: string | null;
  /** "Step 6 of 8 · Curing until Fri 28 Nov" under the In progress segment of the strip. */
  stepNote: string | null;
  batches: (BatchStatusView & { id: string; batchNumber: string })[];
};

export function productionOrderStatus(workOrderStatus: string, batchFacts: BatchFact[] = [], now: Date = new Date()): ProductionOrderStatusView {
  const live = batchFacts.filter(isLiveBatch);
  const views = live.map((b) => ({ ...batchStatusView(b, now), id: b.id, batchNumber: b.batchNumber }));
  const make = (status: ProductionOrderStatus, extra: Partial<ProductionOrderStatusView> = {}): ProductionOrderStatusView => {
    const done = views.filter((v) => v.stage === "passed" || v.stage === "failed").length;
    const failed = views.filter((v) => v.stage === "failed").length;
    return {
      status,
      label: PRODUCTION_ORDER_LABEL[status],
      subtitle: null,
      warn: false,
      batchesTotal: views.length,
      batchesDone: done,
      batchesFailed: failed,
      batchesNote: views.length > 1 ? `${done} of ${views.length} done` : null,
      warning: null,
      leadBatchId: null,
      stepNote: null,
      batches: views,
      ...extra,
    };
  };
  switch (workOrderStatus) {
    case "draft":
    case "planned":
      return make("draft");
    case "cancelled":
      return make("cancelled");
    case "released":
    case "in_progress":
    case "completed":
    case "closed":
      break;
    default:
      throw new Error(`Unknown work order status: ${workOrderStatus}`);
  }
  if (views.length === 0) return make(workOrderStatus === "released" ? "approved" : workOrderStatus === "in_progress" ? "in_progress" : "done");
  const undecided = views.filter((v) => v.stage !== "passed" && v.stage !== "failed");
  if (undecided.length === 0) {
    const failed = views.filter((v) => v.stage === "failed").length;
    if (failed === views.length) return make("failed");
    return make("done", { warning: failed > 0 ? `${failed} of ${views.length} batches failed` : null });
  }
  // Least advanced first; ties keep batch order (stable sort).
  const lead = [...undecided].sort((a, b) => RANK[a.stage] - RANK[b.stage])[0];
  const stepNote = lead.stage === "in_progress" && lead.step && lead.stepsTotal > 0 ? `Step ${lead.step.stepNo} of ${lead.stepsTotal}${lead.subtitle ? ` · ${lead.subtitle}` : ""}` : lead.stage === "in_progress" ? lead.subtitle : null;
  return make(lead.status, { subtitle: lead.subtitle, warn: lead.warn, leadBatchId: lead.id, stepNote });
}

/** The 5-step strip: done / current / todo per step (null for Failed and Cancelled, shown as a banner). */
export function progressSteps(status: ProductionOrderStatus) {
  if (status === "failed" || status === "cancelled") return null;
  const i = PRODUCTION_ORDER_STEPS.indexOf(status);
  return PRODUCTION_ORDER_STEPS.map((s, k) => ({ key: s, label: PRODUCTION_ORDER_LABEL[s], state: k < i || status === "done" ? "done" : k === i ? "current" : "todo" }));
}

/** Work order statuses that can hold a production order status (SQL pre-filter of the list; the status is then computed). */
export function workOrderStatusesFor(s: ProductionOrderStatus | "open"): string[] {
  return {
    open: ["draft", "planned", "released", "in_progress", "completed"],
    draft: ["draft", "planned"],
    approved: ["released", "in_progress"],
    in_progress: ["released", "in_progress"],
    quality_check: ["in_progress", "completed"],
    done: ["in_progress", "completed", "closed"],
    failed: ["in_progress", "completed", "closed"],
    cancelled: ["cancelled"],
  }[s];
}

/** Late = the needed-by date has passed and the order is not Done or Cancelled (ADR-080, V2-2; A-PF2-12). */
export function isLate(neededBy: string | null | undefined, status: ProductionOrderStatus, today: string): boolean {
  return !!neededBy && neededBy < today && status !== "done" && status !== "cancelled";
}

/** "bars" for soap, "pieces" otherwise (UX: quantities in pieces first). */
export function pieceWord(family: string | null | undefined, n: number | string): string {
  const one = String(n) === "1";
  if ((family ?? "").toLowerCase().includes("soap")) return one ? "bar" : "bars";
  return one ? "piece" : "pieces";
}

/** "247 bars · 2 batches" / "123 bars · 1 batch". */
export function piecesText(units: string | number | null, family: string | null | undefined, batches: number): string {
  const b = `${batches} ${batches === 1 ? "batch" : "batches"}`;
  if (units === null || units === "") return b;
  const n = Number(units);
  const fmt = Number.isFinite(n) ? n.toLocaleString("en-PH", { maximumFractionDigits: 0 }) : String(units);
  return `${fmt} ${pieceWord(family, fmt)} · ${b}`;
}
