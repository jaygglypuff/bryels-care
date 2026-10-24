/**
 * Inspection and test-result rules (pure, no I/O), shared by services and pages (US-3-14, US-3-15).
 *
 * Nothing here defines a specification. Limits, units and the test list come from the QA-approved
 * inspection plan revision frozen on the batch (W1D, US-3-03); this file only compares an entered
 * value with that data, and decides the inspection state machine (docs/data-model.md §6.6).
 */
import Decimal from "decimal.js";
import { DomainError } from "@/lib/errors";

export type InspectionStatus = "pending" | "in_progress" | "awaiting_review" | "approved" | "rejected" | "cancelled";

/** Inspection state machine (data-model §6.6). awaiting_review → in_progress = returned for retest. */
export const INSPECTION_TRANSITIONS: Record<InspectionStatus, readonly InspectionStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["awaiting_review", "cancelled"],
  awaiting_review: ["approved", "rejected", "in_progress"],
  approved: [],
  rejected: [],
  cancelled: [],
};

export function canInspectionTransition(from: string, to: InspectionStatus): boolean {
  return (INSPECTION_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to) ?? false;
}

/** Statuses in which samples and results may still be added or corrected. */
export const INSPECTION_OPEN_STATUSES: readonly InspectionStatus[] = ["pending", "in_progress", "awaiting_review"];

export const INSPECTION_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  awaiting_review: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export type PlanTest = {
  id: string;
  testCode: string;
  name: string;
  method: string | null;
  valueKind: string;
  uom: string | null;
  specMin: string | null;
  specMax: string | null;
  specText: string | null;
  isRequired: boolean;
  sequence: number;
};

const num = (v: string | null) => (v === null ? null : new Decimal(v).toString());

/** The plan's specification in words, e.g. "9 – 10.5 pH", "≥ 135 g", or QA's text. */
export function specLabel(t: Pick<PlanTest, "valueKind" | "uom" | "specMin" | "specMax" | "specText">): string {
  if (t.valueKind === "numeric") {
    const u = t.uom ? ` ${t.uom}` : "";
    const min = num(t.specMin);
    const max = num(t.specMax);
    const range = min !== null && max !== null ? `${min} – ${max}${u}` : min !== null ? `≥ ${min}${u}` : max !== null ? `≤ ${max}${u}` : "";
    return [range, t.specText].filter(Boolean).join("; ") || "—";
  }
  if (t.valueKind === "pass_fail") return t.specText ?? "Pass";
  return t.specText ?? "—";
}

export type ResultInput = {
  /** numeric: the number as typed; text: the observation. */
  value?: string | null;
  /** Unit the tester read the value in (numeric tests). */
  uom?: string | null;
  /** text and pass_fail tests: whether the observation conforms. */
  conforms?: boolean | null;
};

export type EvaluatedResult = {
  valueNumeric: string | null;
  valueText: string | null;
  valuePass: boolean | null;
  uom: string | null;
  passed: boolean;
  /** Human text stored in the MVP `result` column (BMR and CoA print it). */
  resultText: string;
};

/**
 * Evaluates an entered value against a plan test. Numeric: the unit must equal the plan's unit
 * (422 otherwise; conversions are not guessed) and pass = within the plan's min/max (inclusive).
 * Text and pass/fail: the tester states whether the observation conforms to QA's specification text.
 */
export function evaluateResult(t: PlanTest, input: ResultInput): EvaluatedResult {
  const raw = (input.value ?? "").trim();
  if (t.valueKind === "numeric") {
    if (!raw) throw new DomainError("validation", "Enter the measured value.", { field: "value" });
    let v: Decimal;
    try {
      v = new Decimal(raw.replace(/,/g, ""));
    } catch {
      throw new DomainError("validation", "Enter the value as a number.", { field: "value" });
    }
    if (!v.isFinite()) throw new DomainError("validation", "Enter the value as a number.", { field: "value" });
    if (v.decimalPlaces() > 6) throw new DomainError("validation", "Use at most 6 decimals.", { field: "value" });
    const uom = (input.uom ?? "").trim();
    if (!uom) throw new DomainError("validation", `Enter the unit (${t.uom}).`, { field: "uom" });
    if (!t.uom || uom.toLowerCase() !== t.uom.toLowerCase()) {
      throw new DomainError("validation", `The unit ${uom} does not match the specification unit ${t.uom ?? "(none)"}. Enter the value in ${t.uom ?? "the plan's unit"}.`, { field: "uom" });
    }
    const passed = (t.specMin === null || v.gte(t.specMin)) && (t.specMax === null || v.lte(t.specMax));
    return { valueNumeric: v.toString(), valueText: null, valuePass: null, uom: t.uom, passed, resultText: `${v.toString()} ${t.uom}` };
  }
  if (typeof input.conforms !== "boolean") throw new DomainError("validation", "Choose whether the result conforms to the specification.", { field: "conforms" });
  if (raw.length > 500) throw new DomainError("validation", "The observation is too long (max 500 characters).", { field: "value" });
  if (t.valueKind === "text") {
    if (!raw) throw new DomainError("validation", "Describe the observation.", { field: "value" });
    return { valueNumeric: null, valueText: raw, valuePass: input.conforms, uom: null, passed: input.conforms, resultText: raw };
  }
  if (t.valueKind === "pass_fail") {
    return { valueNumeric: null, valueText: raw || null, valuePass: input.conforms, uom: null, passed: input.conforms, resultText: `${input.conforms ? "Pass" : "Fail"}${raw ? ` (${raw})` : ""}` };
  }
  throw new DomainError("validation", `Unknown test kind ${t.valueKind}.`);
}

/** Results not superseded by a correction. */
export function liveResults<R extends { id: string; supersedesId: string | null }>(rows: R[]): R[] {
  const superseded = new Set(rows.map((r) => r.supersedesId).filter((x): x is string => !!x));
  return rows.filter((r) => !superseded.has(r.id));
}

/** Required plan tests that have no live result yet. */
export function missingRequiredTests(tests: PlanTest[], live: { inspectionPlanTestId: string | null }[]): PlanTest[] {
  const done = new Set(live.map((r) => r.inspectionPlanTestId));
  return tests.filter((t) => t.isRequired && !done.has(t.id));
}
