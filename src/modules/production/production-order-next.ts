/**
 * The ONE next action of a production order (ADR-080 §1, V2-2; UX review S1, S2, S5). Pure: the
 * caller passes what the user may do at the order's site. Every action either opens the screen
 * where the work is recorded or waits for someone else; nothing here changes state, and no button
 * fakes success. On multi-batch orders each batch has its own action and the order's primary
 * button is the batch the user can act on now that is furthest along (closest to Done).
 *
 * | Batch (simple status)                         | Action (button)            | Permission at the site               |
 * |-----------------------------------------------|----------------------------|--------------------------------------|
 * | Approved (planned)                            | Get materials              | inventory.movement.post              |
 * | Approved · Materials ready                    | Start                      | production.line_clearance.create     |
 * | In progress · weighing step                   | Weigh                      | production.dispense_record.create    |
 * | In progress · curing not over                 | wait "Curing until …"      | —                                    |
 * | In progress · curing time over                | Curing finished            | production.process_step_record.create|
 * | In progress · step waiting for a check        | Check <step>               | step check permission, not the doer  |
 * | In progress · any other step                  | <step name>                | step perform permission              |
 * | In progress · every step done                 | Finish                     | production.batch.post                |
 * | In progress · Redo                            | Redo                       | production.process_step_record.create|
 * | Quality check                                 | Check quality              | quality.disposition.approve          |
 * | Passed / Failed                               | none                       | —                                    |
 *
 * Without the permission the action becomes "wait" with who can help (WhoCanHelp).
 */
import { PRODUCTION_ORDER_LABEL, type BatchStatusView, type ProductionOrderStatusView } from "./production-order-status";

export type Who = { permission: string; siteId: string };

export type NextAction =
  | { kind: "approve"; label: "Approve"; hint: string }
  | { kind: "link"; label: string; href: string; hint: string; batchId?: string }
  | { kind: "wait"; title: string; hint: string; who: Who | null; batchId?: string }
  | { kind: "none"; hint: string; batchId?: string };

export type ActionCan = {
  /** Does the user hold `permission` at the order's site? */
  can: (permission: string) => boolean;
  userId: string;
};

const WEIGH_KINDS = ["dispensing", "weighing"];

function performPermission(kind: string) {
  if (kind === "line_clearance") return "production.line_clearance.create";
  if (WEIGH_KINDS.includes(kind)) return "production.dispense_record.create";
  return "production.process_step_record.create";
}
function checkPermission(kind: string) {
  return kind === "line_clearance" ? "production.line_clearance.approve" : "production.process_step_record.approve";
}

function gate(u: ActionCan, siteId: string, permission: string, link: { label: string; href: string; hint: string; batchId: string }, waitTitle: string): NextAction {
  if (u.can(permission)) return { kind: "link", ...link };
  return { kind: "wait", title: waitTitle, hint: link.hint, who: { permission, siteId }, batchId: link.batchId };
}

/** The action of one batch of the order. */
export function batchNextAction(b: BatchStatusView & { id: string; batchNumber: string }, siteId: string, u: ActionCan, workOrderId?: string): NextAction {
  const id = b.id;
  // ADR-080 stage G2 screens (materials list, weigh cards, step cards) when the batch belongs to an order.
  const fp = (screen: string) => (workOrderId ? `/production/orders/${workOrderId}/${screen}?batch=${id}` : `/production/${id}`);
  const nr = b.batchNumber;
  switch (b.stage) {
    case "approved":
      if (b.batchStatus === "materials_staged") return gate(u, siteId, "production.line_clearance.create", { label: "Start", href: `/production/${id}`, hint: `Batch ${nr}: do the start check, then start making it.`, batchId: id }, "Ready to start");
      return gate(u, siteId, "inventory.movement.post", { label: "Get materials", href: fp("materials"), hint: `Batch ${nr}: take the materials on the list to the making area.`, batchId: id }, "Waiting for materials");
    case "in_progress": {
      if (b.batchStatus === "rework_approved") return gate(u, siteId, "production.process_step_record.create", { label: "Redo", href: `/production/${id}`, hint: `Batch ${nr}: redo the steps QA asked for.`, batchId: id }, "Waiting for the redo");
      const s = b.step;
      if (!s) return gate(u, siteId, "production.batch.post", { label: "Finish", href: `/production/${id}`, hint: `Batch ${nr}: every step is done. Count the good pieces and send the batch for the quality check.`, batchId: id }, "Ready to finish");
      const stepOf = b.stepsTotal > 0 ? ` (step ${s.stepNo} of ${b.stepsTotal})` : "";
      if (b.waitUntil && !b.waitOver) return { kind: "wait", title: b.subtitle ?? "Waiting", hint: `Batch ${nr}: ${s.name}${stepOf}. Press Curing finished on that day. Ending early needs approval.`, who: null, batchId: id };
      if (b.waitUntil && b.waitOver) return gate(u, siteId, "production.process_step_record.create", { label: "Curing finished", href: fp(`step/${s.stepNo}`), hint: `Batch ${nr}: ${s.name}${stepOf}. The waiting time is over.`, batchId: id }, "Curing time over");
      if (s.status === "awaiting_check") {
        const perm = checkPermission(s.kind);
        if (u.can(perm) && s.conductedBy !== u.userId) return { kind: "link", label: `Check ${s.name}`, href: `/production/${id}`, hint: `Batch ${nr}: ${s.name}${stepOf} needs a second person's check.`, batchId: id };
        return { kind: "wait", title: "Waiting for a check", hint: `Batch ${nr}: another person checks ${s.name}${stepOf}.`, who: { permission: perm, siteId }, batchId: id };
      }
      if (WEIGH_KINDS.includes(s.kind)) return gate(u, siteId, performPermission(s.kind), { label: "Weigh", href: fp("weigh"), hint: `Batch ${nr}: weigh the ingredients${stepOf}.`, batchId: id }, "Ready to weigh");
      return gate(u, siteId, performPermission(s.kind), { label: s.name, href: fp(`step/${s.stepNo}`), hint: `Batch ${nr}: ${s.name}${stepOf}.`, batchId: id }, `Next: ${s.name}`);
    }
    case "quality_check":
      if (b.warn) return u.can("quality.disposition.approve") ? { kind: "link", label: "Check quality", href: "/quality", hint: `Batch ${nr} is on hold in the quality check.`, batchId: id } : { kind: "wait", title: "Quality check · On hold", hint: `Batch ${nr} is on hold. QA checks it again.`, who: { permission: "quality.disposition.approve", siteId }, batchId: id };
      return gate(u, siteId, "quality.disposition.approve", { label: "Check quality", href: "/quality", hint: `Batch ${nr} is in the hold area, waiting for the quality check.`, batchId: id }, "Waiting for the quality check");
    case "passed":
      return { kind: "none", hint: `Batch ${nr} passed the quality check. Ready to sell.`, batchId: id };
    case "failed":
      return { kind: "none", hint: `Batch ${nr} failed the quality check.`, batchId: id };
  }
}

const URGENCY: Record<string, number> = { quality_check: 3, in_progress: 2, approved: 1 };

/**
 * The order's actions: one primary action and, for multi-batch orders, one per batch.
 * `approver` tells whether the user may approve a draft (permission at the site, no separation-of-duties conflict).
 */
export function productionOrderActions(
  view: ProductionOrderStatusView,
  order: { siteId: string; cancelReason?: string | null; workOrderId?: string },
  u: ActionCan,
  approver: { can: boolean; sodConflict: boolean },
): { primary: NextAction; perBatch: { batchId: string; batchNumber: string; label: string; subtitle: string | null; action: NextAction }[] } {
  const perBatch = view.batches.map((b) => ({ batchId: b.id, batchNumber: b.batchNumber, label: PRODUCTION_ORDER_LABEL[b.status], subtitle: b.subtitle, action: batchNextAction(b, order.siteId, u, order.workOrderId) }));
  const out = (primary: NextAction) => ({ primary, perBatch: view.batches.length > 1 ? perBatch : [] });
  switch (view.status) {
    case "cancelled":
      return out({ kind: "none", hint: `Cancelled: ${order.cancelReason ?? "no reason recorded"}.` });
    case "done":
      return out({ kind: "none", hint: view.warning ? `This order is done. ${view.warning}.` : "This order is done. Ready to sell." });
    case "failed":
      return out({ kind: "none", hint: "Every batch of this order failed the quality check." });
    case "draft":
      if (!approver.can) return out({ kind: "wait", title: "Waiting for approval", hint: "A manager approves the order. Approving sets the materials aside and creates the batch.", who: { permission: "production.work_order.approve", siteId: order.siteId } });
      if (approver.sodConflict) return out({ kind: "wait", title: "Another person approves", hint: "You created this order, so another person who can approve must approve it.", who: { permission: "production.work_order.approve", siteId: order.siteId } });
      return out({ kind: "approve", label: "Approve", hint: "Approving sets the materials aside and creates the batch." });
    default:
      break;
  }
  const open = perBatch.filter((p) => p.action.kind !== "none");
  if (open.length === 0) return out({ kind: "none", hint: "Nothing to do on this order right now." });
  const stageOf = (id: string) => view.batches.find((b) => b.id === id)!.stage;
  const actionable = open.filter((p) => p.action.kind === "link").sort((a, b) => (URGENCY[stageOf(b.batchId)] ?? 0) - (URGENCY[stageOf(a.batchId)] ?? 0));
  if (actionable.length > 0) return out(actionable[0].action);
  const lead = open.find((p) => p.batchId === view.leadBatchId) ?? open[0];
  return out(lead.action);
}
