/**
 * CAPA, CAPA action, change control and recall case state machines and labels (pure, no I/O;
 * docs/data-model.md §3.6 as built in W4C, process map W07-04, W07-08..10, ux-system §9.14).
 * Shared by the services, the pages and the unit-level assertions of the integration tests.
 */

import type { CAPA_ACTION_STATUSES, CAPA_SOURCES, CAPA_STATUSES, CHANGE_CONTROL_ENTITY_TYPES, CHANGE_CONTROL_STATUSES, RECALL_CASE_STATUSES, RECALL_KINDS } from "@/db/schema";

export type CapaStatus = (typeof CAPA_STATUSES)[number];
export type CapaSource = (typeof CAPA_SOURCES)[number];
export type CapaActionStatus = (typeof CAPA_ACTION_STATUSES)[number];

/**
 * CAPA: open (root cause, actions being defined) → in_progress (actions under way) → verification
 * (submitted for closure; effectiveness check pending) → closed (effective, closer ≠ submitter).
 * A check recorded as not effective returns the CAPA to in_progress for new actions.
 */
export const CAPA_TRANSITIONS: Record<CapaStatus, readonly CapaStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["verification", "cancelled"],
  verification: ["closed", "in_progress"],
  closed: [],
  cancelled: [],
};

export const CAPA_STATUS_LABEL: Record<CapaStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  verification: "Verification",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const CAPA_SOURCE_LABEL: Record<CapaSource, string> = {
  deviation: "Deviation",
  complaint: "Customer complaint",
  audit: "Audit finding",
  change_control: "Change control",
  other: "Other",
};

/** CAPA action: open → done (owner or QA, with evidence) → verified (a second person); open | done → cancelled. */
export const CAPA_ACTION_TRANSITIONS: Record<CapaActionStatus, readonly CapaActionStatus[]> = {
  open: ["done", "cancelled"],
  done: ["verified", "open", "cancelled"],
  verified: [],
  cancelled: [],
};

export function canMoveCapa(from: string, to: CapaStatus): boolean {
  return (CAPA_TRANSITIONS[from as CapaStatus] ?? []).includes(to);
}

export function canMoveCapaAction(from: string, to: CapaActionStatus): boolean {
  return (CAPA_ACTION_TRANSITIONS[from as CapaActionStatus] ?? []).includes(to);
}

/** An action is overdue when it is still open (not done) after its due date (Manila business date). */
export function isActionOverdue(a: { status: string; dueDate: string }, today: string): boolean {
  return a.status === "open" && a.dueDate < today;
}

/** Why a CAPA cannot be submitted for closure (empty = it can). */
export function capaSubmitBlockers(c: { status: string; rootCause: string | null; effectivenessCriteria: string | null }, actions: { actionNo: number; status: string }[]): string[] {
  const out: string[] = [];
  if (c.status !== "in_progress") out.push(`The CAPA is ${c.status.replace(/_/g, " ")}; only a CAPA in progress can be submitted for closure.`);
  if (!c.rootCause) out.push("Record the root cause first.");
  if (!c.effectivenessCriteria) out.push("Describe how effectiveness will be checked.");
  const live = actions.filter((a) => a.status !== "cancelled");
  if (live.length === 0) out.push("Add at least one action.");
  const unverified = live.filter((a) => a.status !== "verified");
  if (unverified.length) out.push(`Action(s) ${unverified.map((a) => a.actionNo).join(", ")} are not verified yet.`);
  return out;
}

/* ------------------------------------------------------------------ change control */

export type ChangeControlStatus = (typeof CHANGE_CONTROL_STATUSES)[number];
export type ChangeControlEntityType = (typeof CHANGE_CONTROL_ENTITY_TYPES)[number];

/**
 * Change control: draft → submitted (impact assessment + risk level) → approved | rejected (approval
 * rules `change_control`); approved → implemented (the linked revision is approved; implementer records
 * what was done) → closed (a person other than the implementer confirms). draft | submitted → cancelled;
 * submitted → draft when an approver returns it.
 */
export const CHANGE_CONTROL_TRANSITIONS: Record<ChangeControlStatus, readonly ChangeControlStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "draft", "cancelled"],
  approved: ["implemented", "cancelled"],
  rejected: [],
  implemented: ["closed"],
  closed: [],
  cancelled: [],
};

export const CHANGE_CONTROL_STATUS_LABEL: Record<ChangeControlStatus, string> = {
  draft: "Draft",
  submitted: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  implemented: "Implemented",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const CHANGE_ENTITY_LABEL: Record<ChangeControlEntityType, string> = {
  formula_revision: "Formula revision",
  routing_revision: "Routing revision",
  inspection_plan: "Inspection plan revision",
  work_instruction_revision: "Work instruction revision",
  other: "Other (no versioned record)",
};

export function canMoveChangeControl(from: string, to: ChangeControlStatus): boolean {
  return (CHANGE_CONTROL_TRANSITIONS[from as ChangeControlStatus] ?? []).includes(to);
}

/* ------------------------------------------------------------------ recall case */

export type RecallCaseStatus = (typeof RECALL_CASE_STATUSES)[number];
export type RecallKind = (typeof RECALL_KINDS)[number];

/**
 * Recall case: draft (scope captured from the explorer, QA prepares) → submitted (QA proposes) →
 * approved (every approval step: qa_qc then owner_director by default) → notifying (lots marked
 * `recalled`, or for a mock recall the drill started without marking) → recovering (returns and
 * accounting) → closed (reconciliation shipped − returned − accounted, gaps explained).
 * A rejected approval returns the case to draft; draft | submitted | approved → cancelled (reason).
 */
export const RECALL_CASE_TRANSITIONS: Record<RecallCaseStatus, readonly RecallCaseStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["notifying", "cancelled"],
  notifying: ["recovering"],
  recovering: ["closed"],
  closed: [],
  cancelled: [],
};

export const RECALL_CASE_STATUS_LABEL: Record<RecallCaseStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  notifying: "Notifying customers",
  recovering: "Recovering stock",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RECALL_KIND_LABEL: Record<RecallKind, string> = {
  recall: "Recall",
  withdrawal: "Withdrawal",
  mock: "Mock recall (drill)",
};

export function canMoveRecallCase(from: string, to: RecallCaseStatus): boolean {
  return (RECALL_CASE_TRANSITIONS[from as RecallCaseStatus] ?? []).includes(to);
}

/** Lot statuses "Mark recalled" acts on; rejected stock is already blocked and stays rejected. */
export const RECALLABLE_LOT_STATUSES = ["quarantine", "released", "on_hold", "expired"] as const;
