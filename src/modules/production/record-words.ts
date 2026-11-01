/**
 * The batch record's timeline and the order's history in words (UX re-audit 2026-11-01 N3, ADR-105). Stored audit
 * events keep their exact keys (`production.batch.materials_confirmed`, `governance.owner_override.used`) and values
 * (`oil_temp = 30`); the screen shows a sentence and the reading's label from the steps setup (routing snapshot).
 * The printed batch record (bmr.ts) is not changed. Pure: no server-only import, unit-tested in
 * tests/unit/record-words.test.ts. Unknown keys never show raw: they fall back to a sentence built from the key.
 */
import { plainWords } from "./plain-words";

export type AuditLike = { action: string; after?: unknown; reason?: string | null };

/** Labels from the batch's frozen steps setup, so a reading reads "Oil temperature 30 °C", not "oil_temp = 30 °C". */
export type RecordLabels = {
  /** Reading (step parameter) code → its label, e.g. oil_temp → "Oil temperature". */
  parameters?: Record<string, string>;
  /** Equipment code → name, e.g. SC-01 → "Soap cutter". */
  equipment?: Record<string, string>;
  /** Step number → its (plain) name. */
  steps?: Record<string, string>;
};

const STATE_WORD: Record<string, string> = {
  draft: "Draft",
  planned: "Waiting to start",
  materials_staged: "Materials ready",
  in_process: "Being made",
  awaiting_qc: "Waiting for the quality check",
  quarantined: "In the hold area until QA decides",
  released: "Passed the quality check",
  rejected: "Failed the quality check",
  rework_approved: "Redo approved by QA",
  closed: "Closed",
  // Work order states (order history), in the production order words (ADR-080 §1).
  released_wo: "Approved",
  in_progress: "In progress",
  completed: "Quality check",
  cancelled: "Cancelled",
};

/** A batch state in words (timeline "Status … → …"). */
export function batchStateWord(state: string | null | undefined): string {
  if (!state) return "";
  return STATE_WORD[state] ?? cap(state.replace(/_/g, " "));
}

/** A work order state in the production order words (Draft, Approved, In progress, Quality check, Done, Cancelled). */
export function orderStateWord(state: string | null | undefined): string {
  if (!state) return "";
  const w: Record<string, string> = { draft: "Draft", planned: "Draft (ready to approve)", released: "Approved", in_progress: "In progress", completed: "Quality check", closed: "Done", cancelled: "Cancelled" };
  return w[state] ?? cap(state.replace(/_/g, " "));
}

const cap = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/** "Owner override (setting governance.owner_override)" → "The owner allowed it (owner override)". Other reasons stay as typed. */
export function plainReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (/^Owner override\b/i.test(reason)) return "The owner allowed it (owner override).";
  if (/^Own request approved by a top role\b/i.test(reason)) return "A top role approved their own request (allowed by the company settings).";
  return reason.replace(/\s*\(setting [a-z0-9_.]+\)/gi, "");
}

/** Last resort for a key with no sentence: "production.batch.reopen_withdrawn" → "Reopen withdrawn". Never the raw key. */
export function wordsFromKey(action: string): string {
  const parts = action.split(".");
  const last = parts.at(-1) ?? action;
  return cap(last.replace(/_/g, " "));
}

/**
 * What the owner did under the owner override (ADR-073), in words: "finished step 4 (Mixing) for the operator".
 * `forAction` is the stored key of the event the override let through; `detail` is that event's `after` (same
 * correlation id), when the caller has it, so the step number and name can be named.
 */
export function ownerOverrideDoing(forAction: string | null | undefined, detail: Record<string, unknown> | null = null, labels: RecordLabels = {}): string {
  const d = detail ?? {};
  const no = d.stepNo == null ? "" : String(d.stepNo);
  const name = (d.name == null ? "" : String(d.name)) || labels.steps?.[no] || "";
  const step = no ? `step ${no}${name ? ` (${plainWords(name)})` : ""}` : "a step";
  switch (forAction ?? "") {
    case "production.process_step_record.completed":
    case "production.process_step.completed":
      return `finished ${step} for the operator`;
    case "production.process_step_record.started":
      return `started ${step} for the operator`;
    case "production.process_step_record.checked":
      return `did the second-person check of ${step}`;
    case "production.process_step_reading.recorded":
      return "wrote a reading for the operator";
    case "production.line_clearance.answered":
      return `answered the clean-area check of ${step} for the operator`;
    case "production.dispense_record.recorded":
    case "production.dispense_record.created":
      return "weighed an ingredient for the operator";
    case "production.dispense_record.checked":
      return "did the second-person check of a weighing";
    case "production.batch.materials_confirmed":
    case "production.batch_material.staged":
      return "took the materials for the storekeeper";
    case "production.batch.finished":
    case "production.batch.submitted":
      return "finished the batch for the operator";
    case "quality.disposition.released":
    case "quality.disposition.rejected":
      return "took the QA decision";
    default:
      return forAction ? `did "${wordsFromKey(forAction).toLowerCase()}" for the person whose job it is` : "did a step for the person whose job it is";
  }
}

/** "Ana Villanueva (owner) finished step 4 (Mixing) for the operator." */
export function ownerOverrideSentence(name: string | null | undefined, forAction: string | null | undefined, detail: Record<string, unknown> | null = null, labels: RecordLabels = {}): string {
  return `${name ? `${name} (owner)` : "The owner"} ${ownerOverrideDoing(forAction, detail, labels)}.`;
}

/** One timeline line for one stored audit event. `detail`: for an owner override, the `after` of the event it let through. */
export function auditSentence(a: AuditLike, labels: RecordLabels = {}, fmt: { mass?: (g: string) => string; qty?: (v: string, uom: string, dp: number) => string } = {}, detail: Record<string, unknown> | null = null): string {
  const after = (a.after ?? {}) as Record<string, unknown>;
  const s = (k: string) => (after[k] == null ? "" : String(after[k]));
  const mass = fmt.mass ?? ((g: string) => `${g} g`);
  const qty = fmt.qty ?? ((v: string, uom: string) => `${v}${uom ? ` ${uom}` : ""}`);
  const step = () => {
    const no = s("stepNo");
    const name = s("name") || labels.steps?.[no] || "";
    return `step ${no}${name ? ` (${plainWords(name)})` : ""}`;
  };
  const param = (code: string) => labels.parameters?.[code] ?? cap(code.replace(/_/g, " "));
  const equip = (code: string) => (labels.equipment?.[code] ? `${labels.equipment[code]} (${code})` : code);
  switch (a.action) {
    case "production.batch.created":
      return s("formula") ? `Batch planned from the recipe ${s("formula")}, ${mass(s("plannedSizeG"))}` : "Batch planned";
    case "production.batch.started":
      return "Making started";
    case "production.batch.materials_confirmed":
      return "All materials taken to the making area";
    case "production.batch_material.staged":
      return `Material taken to the making area${s("materialName") ? `: ${s("materialName")}` : ""}${s("lot") ? `, lot ${s("lot")}` : ""}`;
    case "production.batch.revisions_snapshotted":
      return "Recipe and steps versions fixed for this batch";
    case "production.dispense_record.created":
    case "production.dispense_record.recorded":
      return `Weighed ${s("materialName") || s("material")} ${qty(s("actualQtyG"), "g", 1)} from lot ${s("lot")}${after.withinTolerance === false ? " (outside the allowed difference)" : ""}${after.partial ? " (part)" : ""}`;
    case "production.dispense_record.checked":
      return `Second person checked the weighing of ${s("material") || "an ingredient"}`;
    case "production.dispense_record.voided":
      return "A weighing was undone";
    case "production.dispense_record.returned":
      return "The second person sent a weighing back; it is weighed again";
    case "production.dispense_record.material_substituted":
      return "QA allowed another lot for an ingredient";
    case "production.dispense_record.over_tolerance_approved":
      return `Weight of ${s("material")} outside the allowed difference approved`;
    case "production.process_step.completed":
    case "production.process_step_record.completed":
      return `${cap(step())} ${s("status") === "awaiting_check" ? "done, waiting for the second person" : "done"}`;
    case "production.process_step_record.checked":
      return `Second person checked ${step()}`;
    case "production.process_step_record.started":
      return `${cap(step())} started`;
    case "production.process_step_record.returned":
      return `${cap(step())} sent back by the second person`;
    case "production.process_step_record.exception_approved":
      return `Exception approved on ${step()} (problem report opened)`;
    case "production.line_clearance.answered":
      return `Clean-area check answered on ${step()}`;
    case "production.process_step_reading.recorded":
      return `${param(s("parameter"))}: ${s("value")}${s("uom") ? ` ${s("uom")}` : ""}${after.isWithinLimits === false ? " (outside limits)" : ""}`;
    case "production.process_step_reading.corrected":
      return `${param(s("parameter"))} corrected to ${s("value")}${s("uom") ? ` ${s("uom")}` : ""}${after.isWithinLimits === false ? " (outside limits)" : ""}`;
    case "production.equipment_use.created":
      return `Machine ${equip(s("equipment"))} used on ${step()}`;
    case "production.equipment_use.ended":
      return `Machine ${equip(s("equipment"))} free again`;
    case "production.packaging_component.issued":
      return `Wrappers or labels taken: lot ${s("lot")}, ${s("issued")} ${s("uom")}`;
    case "production.packaging_reconciliation.counted":
    case "production.packaging_reconciliation.recounted":
      return `Wrappers counted (${s("material")}): difference ${s("variance")}${after.within === false ? " (does not match)" : ""}`;
    case "production.yield_record.recorded":
    case "production.yield_record.corrected":
      return `Pieces made written: ${s("actualUnits")} pcs`;
    case "production.yield_record.approved":
      return "Pieces made outside the range approved (problem report opened)";
    case "production.scrap_rework_record.recorded":
      return `${s("kind") === "rework" ? "Redo" : "Rejects thrown away"}: ${s("qty")} ${s("uom")}`;
    case "production.production_posting.consumption_posted":
      return "Materials used taken off stock";
    case "production.production_posting.output_posted":
      return `Finished goods put in stock: lot ${s("lot")}, ${s("qty")} ${s("uom")}`;
    case "production.batch.submitted":
    case "production.batch.completed":
    case "production.batch.finished":
      return `Batch finished and moved to the hold area${s("actualUnits") ? `: ${s("actualUnits")} pcs` : ""}${s("outputLot") ? `, lot ${s("outputLot")}` : ""}`;
    case "production.batch.label_lot_fixed":
      return `Product labels use lot ${s("lotNumber")}, expiry ${s("expiresOn")}`;
    case "production.batch.closed":
      return "Batch record closed";
    case "production.batch.reopen_requested":
      return "Asked to reopen the batch record";
    case "production.batch.reopened":
      return "Batch record reopened";
    case "production.batch.abandoned":
      return "Batch stopped before it started";
    case "production.batch.state_changed":
      return "Batch status changed";
    case "production.batch_paper_record.issued":
      return "Paper pages printed for this batch";
    case "production.batch_paper_record.transcribed":
      return "Paper pages typed in";
    case "production.batch_paper_record.voided":
      return "Paper pages cancelled";
    case "quality.disposition.released":
      return "QA said OK to use";
    case "quality.disposition.rejected":
      return "QA said not OK";
    case "governance.owner_override.used":
      return `The owner ${ownerOverrideDoing(s("forAction"), detail, labels)} (owner override)`;
    case "governance.self_approval.used":
      return "A top role approved their own request";
    // Production order history (order page, More details).
    case "production.work_order.created":
      return "Order created";
    case "production.work_order.updated":
      return "Order changed";
    case "production.work_order.planned":
      return "Recipe and steps versions chosen";
    case "production.work_order.released":
    case "production.production_order.approved":
      return "Order approved, materials set aside";
    case "production.work_order.reservations_topped_up":
      return "More materials set aside";
    case "production.work_order.cancelled":
      return "Order cancelled";
    case "production.work_order.state_changed":
      return "Order status changed";
    case "production.production_order.assigned":
      return "Person who makes it changed";
    default:
      return wordsFromKey(a.action);
  }
}
