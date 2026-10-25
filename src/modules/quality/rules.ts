/**
 * Quality decision rules (pure, no I/O) shared by the services and the pages.
 *
 * The transition tables below are the MVP disposition state machines (data-model 6.6/6.7,
 * process map W06). Which tests a product needs and what their limits are is NOT decided
 * here: specifications are entered by the company's QA personnel per batch and must be
 * validated by qualified reviewers before production use.
 */

import { fmtDate } from "@/lib/qty";

/** `recall` (W4C, US-6-18) is applied only from an approved recall case ("Mark recalled", recall-cases.ts). */
export type LotDecision = "release" | "reject" | "hold" | "release_from_hold" | "recall";
export type BatchDecision = "release" | "reject";

export const LOT_DECISIONS: readonly LotDecision[] = ["release", "release_from_hold", "hold", "reject"];

/** Lot quality-status machine: decision -> allowed from-states and target state. */
export const LOT_TRANSITIONS: Record<LotDecision, { from: readonly string[]; to: string; label: string; event: "released" | "rejected" | "held" | "recalled" }> = {
  release: { from: ["quarantine"], to: "released", label: "Release", event: "released" },
  release_from_hold: { from: ["on_hold"], to: "released", label: "Release from hold", event: "released" },
  hold: { from: ["quarantine", "released"], to: "on_hold", label: "Place on hold", event: "held" },
  reject: { from: ["quarantine", "on_hold", "expired"], to: "rejected", label: "Reject", event: "rejected" },
  // Wave 4 W4C: rejected stock is already blocked and stays rejected; recalled stock is never released through normal flows.
  recall: { from: ["quarantine", "released", "on_hold", "expired"], to: "recalled", label: "Mark recalled", event: "recalled" },
};

/** Batch disposition machine (only the QA part of the batch state machine). */
export const BATCH_TRANSITIONS: Record<BatchDecision, { from: readonly string[]; to: string; label: string; event: "released" | "rejected" }> = {
  release: { from: ["awaiting_qc", "quarantined"], to: "released", label: "Release batch", event: "released" },
  reject: { from: ["awaiting_qc", "quarantined"], to: "rejected", label: "Reject batch", event: "rejected" },
};

/** Batch statuses shown in the QA queue as waiting for a decision (quarantined = inspection reviewed, W2C). */
export const BATCH_AWAITING_DECISION = ["awaiting_qc", "quarantined"] as const;

/** Batch statuses in which QC test results may be recorded. */
export const TESTABLE_BATCH_STATUSES = ["in_process", "awaiting_qc"] as const;

/** Batch statuses after which a finished-goods lot may be decided at lot level. */
export const BATCH_DECIDED_STATUSES = ["released", "rejected", "closed"] as const;

export const MIN_REASON_LENGTH = 5;

/** A lot is expired when its status says so or its expiry date (Asia/Manila end of day) has passed. */
export function isLotExpired(lot: { qualityStatus: string; expiresOn: string | null }, now = new Date()): boolean {
  if (lot.qualityStatus === "expired") return true;
  if (!lot.expiresOn) return false;
  return new Date(lot.expiresOn + "T23:59:59+08:00") < now;
}

/** Why a lot decision is not available (null when it is). Server re-checks inside the transaction. */
export function lotDecisionBlocker(
  decision: LotDecision,
  lot: { lotNumber: string; qualityStatus: string; expiresOn: string | null },
  opts: { isReceiver: boolean; pendingBatchNumber?: string | null; now?: Date; releaseBlockers?: string[]; isTester?: boolean },
): { code: "state" | "blocked_lot" | "separation_of_duties"; message: string } | null {
  const t = LOT_TRANSITIONS[decision];
  // A recall applies to every affected lot, whatever the state of its batch (W07-08).
  if (opts.pendingBatchNumber && decision !== "recall") {
    return { code: "state", message: `Lot ${lot.lotNumber} is the output of batch ${opts.pendingBatchNumber}; decide it through batch release.` };
  }
  if (t.to === "released" && isLotExpired(lot, opts.now)) {
    return { code: "blocked_lot", message: `Lot ${lot.lotNumber} expired${lot.expiresOn ? ` on ${fmtDate(lot.expiresOn)}` : ""} and cannot be released. Reject it instead.` };
  }
  if (!t.from.includes(lot.qualityStatus)) {
    return { code: "state", message: `${t.label} is not possible while the lot is ${lot.qualityStatus.replace("_", " ")}.` };
  }
  if (t.to === "released" && opts.releaseBlockers?.length) {
    // Receiving and hold rules (open discrepancy, missing CoA, unlinked supplier, open QA hold; US-2-07/08/10).
    return { code: "state", message: opts.releaseBlockers.join(" ") };
  }
  if (t.to === "released") {
    if (opts.isReceiver) {
      return { code: "separation_of_duties", message: "You received this lot, so you cannot release it. Another QA user must decide (separation of duties)." };
    }
    if (opts.isTester) {
      return { code: "separation_of_duties", message: "You entered test results for this lot, so you cannot release it. Another QA user must decide (separation of duties)." };
    }
  }
  return null;
}

export type BatchReleaseFacts = {
  status: string;
  hasOutputLot: boolean;
  outputLotStatus: string | null;
  outputLotExpired: boolean;
  testCount: number;
  failedTests: string[];
  missingSteps: string[];
  pendingLines: string[];
  isOperatorOrChecker: boolean;
  /** W2C: the decider entered a test result of the batch (sod.disposition.decider_not_result_entry). */
  isTester?: boolean;
  /** W2C: the batch has a frozen inspection plan; its inspection decides test completeness (extraBlockers). */
  planDriven?: boolean;
  /** W2C: inspection, deviation, hold and receiving reasons computed by the services. */
  extraBlockers?: string[];
};

/** Every reason the batch cannot be released; empty array means release is allowed. */
export function batchReleaseBlockers(f: BatchReleaseFacts): { code: "state" | "separation_of_duties"; message: string }[] {
  const out: { code: "state" | "separation_of_duties"; message: string }[] = [];
  if (!BATCH_TRANSITIONS.release.from.includes(f.status)) out.push({ code: "state", message: `The batch is ${f.status.replace(/_/g, " ")}, not awaiting QC.` });
  if (!f.hasOutputLot) out.push({ code: "state", message: "The batch has no finished-goods output lot yet." });
  else if (f.outputLotStatus !== "quarantine") out.push({ code: "state", message: `The output lot is ${String(f.outputLotStatus).replace("_", " ")}, not quarantined.` });
  else if (f.outputLotExpired) out.push({ code: "state", message: "The output lot is past its expiry date." });
  if (!f.planDriven && f.testCount === 0) out.push({ code: "state", message: "Record at least one test result before release." });
  if (f.failedTests.length) {
    out.push({
      code: "state",
      message: `Failed test(s): ${f.failedTests.join(", ")}. A failed result blocks release unless an OOS deviation on that result is closed with the conclusion that release may proceed; otherwise reject the batch.`,
    });
  }
  for (const m of f.extraBlockers ?? []) out.push({ code: "state", message: m });
  if (f.missingSteps.length) out.push({ code: "state", message: `Checklist step(s) not completed: ${f.missingSteps.join(", ")}.` });
  if (f.pendingLines.length) out.push({ code: "state", message: `Ingredient line(s) not dispensed: ${f.pendingLines.join(", ")}.` });
  if (f.isOperatorOrChecker) out.push({ code: "separation_of_duties", message: "You weighed, checked or conducted steps on this batch, so you cannot release it (separation of duties)." });
  if (f.isTester) out.push({ code: "separation_of_duties", message: "You entered test results for this batch, so you cannot release it (separation of duties)." });
  return out;
}
