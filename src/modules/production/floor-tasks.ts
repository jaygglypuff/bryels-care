import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, processStepRecords, products, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { currentStepOf } from "./flow-facts";
import { batchNextAction, type NextAction } from "./production-order-next";
import { batchStatusView, type BatchFact } from "./production-order-status";
import { type FormulaSnapshot, isWeighingStep } from "./shared";

/**
 * The operator's task list (UX review "Your tasks today"): ONE task per batch at the
 * current site that the user can act on now or soon, whether or not the batch belongs to a
 * production order. Read model only; nothing here changes state. The task's one button reuses the
 * order screens' next action (`batchNextAction`, production-order-next.ts) and the step position
 * from the flow facts (`currentStepOf`, flow-facts.ts), so Home, My work and the order page agree.
 *
 * | Batch state                                   | Task (verb + thing)               | Permission at the site               |
 * |-----------------------------------------------|-----------------------------------|--------------------------------------|
 * | planned, order approved (released/in_progress)| Get the materials                 | inventory.movement.post              |
 * | planned, no order (older batches)             | Get the materials                 | production.batch.edit                |
 * | materials_staged                              | Start the batch                   | production.line_clearance.create     |
 * | in_process, weighing step                     | Weigh the ingredients             | production.dispense_record.create    |
 * | in_process, curing/resting not over           | Curing until Sat 1 Nov            | — (nobody can act; shown as waiting) |
 * | in_process, curing/resting over               | Curing is over: end it            | production.process_step_record.create|
 * | in_process, step waiting for a check          | Check <step>                      | step check permission, not the doer  |
 * | in_process, transfer step or every step done  | Finish the batch                  | production.batch.post                |
 * | in_process, any other step                    | <step name>                       | step perform permission              |
 * | rework_approved                               | Redo the steps QA asked for       | production.process_step_record.create|
 *
 * Who: a batch of an order assigned to the user comes first, then batches nobody took (order not
 * assigned, or no order); a batch of an order assigned to someone else is never listed
 * (work_orders.assigned_operator_id). Without the permission the task says who can do it, by first
 * name or role, never by e-mail address. Requires production.batch.view; current site only.
 */

export type FloorTaskKind = "get_materials" | "start" | "weigh" | "step" | "check" | "wait" | "finish" | "redo";

export type FloorTask = {
  batchId: string;
  batchNumber: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
  productName: string;
  kind: FloorTaskKind;
  /** Verb + thing in operator words ("Weigh the ingredients", "Curing until Sat 1 Nov"). */
  title: string;
  /** "Step 2 of 7 · Weighing"; "Not started" before the first step. */
  stepLabel: string;
  stepIndex: number | null;
  stepsTotal: number;
  /** Steps done ÷ steps, 0–100 (whole number). */
  percent: number;
  /** The one screen to continue on (order screens when the batch has an order, else the batch page). */
  href: string;
  /** "Start" before the batch has started, "Check" for a second-person check, else "Continue". */
  buttonLabel: string;
  /** The user holds the permission at the batch site and nothing (curing, a check by another) blocks. */
  canDo: boolean;
  /** "Waiting for Jun or Dino" / "Waiting for Warehouse Operator"; null when the user can act or nobody can yet. */
  waitingFor: string | null;
  /** One plain sentence under the title (why it waits, or what to do). */
  hint: string;
  assignedToMe: boolean;
};

const RUNNING = ["materials_staged", "in_process", "rework_approved"];
const APPROVED_ORDER = ["released", "in_progress"];
const ORDER_RANK: Record<FloorTaskKind, number> = { finish: 0, check: 1, step: 2, weigh: 3, redo: 4, start: 5, get_materials: 6, wait: 7 };

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** "Jun or Dino" (people first, by first name), else the role names; never e-mail addresses. */
export function waitingWords(who: { roles: string[]; people: { name: string }[] }): string {
  const names = [...new Set(who.people.map((p) => firstName(p.name)))];
  if (names.length > 0 && names.length <= 3) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  if (who.roles.length > 0) return who.roles.slice(0, 2).join(" or ");
  return "someone who can do this step";
}

function taskOf(a: NextAction, step: { name: string; kind: string; status: string } | null, waitingLabel: string | null, batchStatus: string): { kind: FloorTaskKind; title: string } {
  if (batchStatus === "planned") return { kind: "get_materials", title: "Get the materials" };
  if (batchStatus === "materials_staged") return { kind: "start", title: "Start the batch" };
  if (batchStatus === "rework_approved") return { kind: "redo", title: "Redo the steps QA asked for" };
  if (!step) return { kind: "finish", title: "Finish the batch" };
  if (waitingLabel && a.kind === "wait" && !a.who) return { kind: "wait", title: waitingLabel };
  if (step.status === "awaiting_check") return { kind: "check", title: a.kind === "link" ? `Check ${step.name.toLowerCase()}` : `${step.name}: waiting for a check` };
  if (step.kind === "transfer") return { kind: "finish", title: "Finish the batch" };
  if (isWeighingStep(step.kind)) return { kind: "weigh", title: "Weigh the ingredients" };
  if (waitingLabel) return { kind: "step", title: `${waitingLabel.split(" until ")[0]} is over: end it` };
  return { kind: "step", title: step.name };
}

/** The operator's tasks at the current site (see the table above). */
export async function myFloorTasks(ctx: AuthContext, now: Date = new Date()): Promise<FloorTask[]> {
  ctx.require("production.batch.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!ctx.canAt("production.batch.view", siteId)) ctx.requireAt("production.batch.view", siteId);
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      startedAt: batches.startedAt,
      snapshot: batches.formulaSnapshot,
      siteId: batches.siteId,
      workOrderId: batches.workOrderId,
      workOrderNumber: workOrders.workOrderNumber,
      assignedOperatorId: workOrders.assignedOperatorId,
      productName: products.name,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(workOrders, eq(workOrders.id, batches.workOrderId))
    .where(
      and(
        eq(batches.organizationId, ctx.organizationId),
        eq(batches.siteId, siteId),
        or(
          inArray(batches.status, RUNNING),
          // waiting for materials: a batch of an approved order, or an older batch made without an order
          and(eq(batches.status, "planned"), or(isNull(batches.workOrderId), inArray(workOrders.status, APPROVED_ORDER))),
        ),
        // never a batch of an order assigned to someone else
        or(isNull(workOrders.assignedOperatorId), eq(workOrders.assignedOperatorId, ctx.userId)),
      ),
    )
    .orderBy(asc(batches.batchNumber))
    .limit(200);
  if (rows.length === 0) return [];
  const recs = await db
    .select({ batchId: processStepRecords.batchId, stepNo: processStepRecords.stepNo, name: processStepRecords.name, kind: processStepRecords.stepKind, status: processStepRecords.status, startedAt: processStepRecords.startedAt, earliestCompletionAt: processStepRecords.earliestCompletionAt, conductedBy: processStepRecords.conductedBy })
    .from(processStepRecords)
    .where(inArray(processStepRecords.batchId, rows.map((r) => r.id)));
  const can = { can: (p: string) => ctx.can(p as never) && ctx.canAt(p as never, siteId), userId: ctx.userId };
  const whoCache = new Map<string, Promise<string>>();
  const waitingFor = (permission: string) => {
    if (!whoCache.has(permission)) whoCache.set(permission, whoCanDo(ctx, permission, siteId).then(waitingWords));
    return whoCache.get(permission)!;
  };

  const tasks: FloorTask[] = [];
  for (const r of rows) {
    const snap = r.snapshot as FormulaSnapshot;
    const mine = recs.filter((x) => x.batchId === r.id);
    const planned = [...(snap.steps ?? [])].sort((a, z) => a.stepNo - z.stepNo).map((s) => ({ stepNo: s.stepNo, name: s.name, stepKind: s.stepKind }));
    const fact: BatchFact = { id: r.id, batchNumber: r.batchNumber, status: r.status, startedAt: r.startedAt, plannedSteps: planned, stepRecords: mine };
    const view = { ...batchStatusView(fact, now), id: r.id, batchNumber: r.batchNumber };
    const cur = currentStepOf(snap, mine, now);
    let action = batchNextAction(view, siteId, can, r.workOrderId ?? undefined);
    // An older batch made without an order: the batch page confirms the materials (production.batch.edit).
    if (r.status === "planned" && !r.workOrderId) {
      action = can.can("production.batch.edit")
        ? { kind: "link", label: "Start", href: `/production/${r.id}`, hint: `Batch ${r.batchNumber}: bring the materials to the weighing area, then confirm them.`, batchId: r.id }
        : { kind: "wait", title: "Waiting for materials", hint: `Batch ${r.batchNumber}: the materials are brought to the weighing area.`, who: { permission: "production.batch.edit", siteId }, batchId: r.id };
    }
    if (action.kind === "none" || action.kind === "approve") continue;
    const total = planned.length || cur?.total || 0;
    const index = r.status === "in_process" || r.status === "rework_approved" ? (cur?.index ?? total) : null;
    const doneSteps = r.status === "in_process" || r.status === "rework_approved" ? (cur ? cur.index - 1 : total) : 0;
    const t = taskOf(action, cur ? { name: cur.name, kind: cur.kind, status: cur.status } : null, cur?.waitingLabel ?? null, r.status);
    const word = t.kind === "weigh" ? "Weighing" : cur?.name ?? "Every step done";
    const stepLabel = index !== null && total > 0 ? `Step ${Math.min(index, total)} of ${total} · ${cur ? word : "Every step done"}` : r.status === "materials_staged" ? "Materials ready · not started" : "Not started";
    const canDo = action.kind === "link";
    const href = action.kind === "link" ? action.href : r.workOrderId ? `/production/orders/${r.workOrderId}` : `/production/${r.id}`;
    tasks.push({
      batchId: r.id,
      batchNumber: r.batchNumber,
      workOrderId: r.workOrderId,
      workOrderNumber: r.workOrderNumber,
      productName: r.productName,
      kind: t.kind,
      title: t.title,
      stepLabel,
      stepIndex: index,
      stepsTotal: total,
      percent: total > 0 ? Math.round((doneSteps / total) * 100) : 0,
      href,
      buttonLabel: t.kind === "check" ? "Check" : r.status === "planned" || r.status === "materials_staged" ? "Start" : canDo ? "Continue" : "Open",
      canDo,
      waitingFor: action.kind === "wait" && action.who ? await waitingFor(action.who.permission) : null,
      hint: action.hint,
      assignedToMe: !!r.assignedOperatorId && r.assignedOperatorId === ctx.userId,
    });
  }
  return tasks.sort((a, z) => Number(z.assignedToMe) - Number(a.assignedToMe) || Number(z.canDo) - Number(a.canDo) || ORDER_RANK[a.kind] - ORDER_RANK[z.kind] || a.batchNumber.localeCompare(z.batchNumber));
}

/** The three counts of "Your tasks today": batches the user can act on, of those weighing, and waiting ones. */
export function floorTaskCounts(tasks: FloorTask[]) {
  return { forYou: tasks.filter((t) => t.canDo).length, weighing: tasks.filter((t) => t.kind === "weigh").length, waiting: tasks.filter((t) => !t.canDo).length };
}
