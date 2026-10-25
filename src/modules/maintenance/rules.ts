/**
 * Maintenance state machines and due-date rules (pure, no I/O; US-6-19, process map W13).
 * Intervals, lead days and usage thresholds are the company's maintenance configuration per plan
 * (A-W4C-04); nothing here is a manufacturer or regulatory rule.
 */
import Decimal from "decimal.js";
import type { MAINTENANCE_PLAN_STATUSES, MAINTENANCE_WO_KINDS, MAINTENANCE_WO_PRIORITIES, MAINTENANCE_WO_STATUSES } from "@/db/schema";

export type MaintenanceWoStatus = (typeof MAINTENANCE_WO_STATUSES)[number];
export type MaintenanceWoKind = (typeof MAINTENANCE_WO_KINDS)[number];
export type MaintenanceWoPriority = (typeof MAINTENANCE_WO_PRIORITIES)[number];
export type MaintenancePlanStatus = (typeof MAINTENANCE_PLAN_STATUSES)[number];

/**
 * Maintenance work order: open → in_progress ⇄ on_hold (waiting for parts or a contractor) → completed
 * (service record written, equipment returned to service on pass); open | in_progress | on_hold → cancelled.
 */
export const MWO_TRANSITIONS: Record<MaintenanceWoStatus, readonly MaintenanceWoStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export const MWO_STATUS_LABEL: Record<MaintenanceWoStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MWO_KIND_LABEL: Record<MaintenanceWoKind, string> = {
  preventive: "Preventive (PM plan)",
  corrective: "Corrective / breakdown",
  inspection: "Inspection",
};

export const MWO_PRIORITY_LABEL: Record<MaintenanceWoPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

/** Plan: active ⇄ paused; active | paused → retired (reason). */
export const PLAN_TRANSITIONS: Record<MaintenancePlanStatus, readonly MaintenancePlanStatus[]> = {
  active: ["paused", "retired"],
  paused: ["active", "retired"],
  retired: [],
};

/** The service record kind a completed work order writes on the equipment (W1D equipment_service_records). */
export const SERVICE_KIND_FOR: Record<MaintenanceWoKind, "preventive_maintenance" | "repair" | "inspection"> = {
  preventive: "preventive_maintenance",
  corrective: "repair",
  inspection: "inspection",
};

export function canMoveWorkOrder(from: string, to: MaintenanceWoStatus): boolean {
  return (MWO_TRANSITIONS[from as MaintenanceWoStatus] ?? []).includes(to);
}

export function canMovePlan(from: string, to: MaintenancePlanStatus): boolean {
  return (PLAN_TRANSITIONS[from as MaintenancePlanStatus] ?? []).includes(to);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DueState = "ok" | "due_soon" | "due" | "overdue";

export const DUE_STATE_LABEL: Record<DueState, string> = { ok: "Not due", due_soon: "Due soon", due: "Due today", overdue: "Overdue" };

/**
 * Due state of a plan. Time-based: overdue the day after the due date (the same rule as the equipment's
 * `maintenance_due` availability reason, W1D), due on the date, due soon `leadDays` before it.
 * Usage-based: overdue once the usage since the last PM reaches the interval, due soon from
 * `usageDueSoonPct` % of it.
 */
export function planDueState(
  p: { status: string; triggerKind: string; nextDueOn: string | null; usageInterval: string | null },
  opts: { today: string; leadDays: number; usage?: Decimal.Value | null; usageDueSoonPct: number },
): DueState {
  if (p.status !== "active") return "ok";
  if (p.triggerKind === "time") {
    if (!p.nextDueOn) return "ok";
    if (p.nextDueOn < opts.today) return "overdue";
    if (p.nextDueOn === opts.today) return "due";
    return addDays(p.nextDueOn, -opts.leadDays) <= opts.today ? "due_soon" : "ok";
  }
  if (!p.usageInterval || opts.usage === null || opts.usage === undefined) return "ok";
  const used = new Decimal(opts.usage);
  const interval = new Decimal(p.usageInterval);
  if (used.gte(interval)) return "overdue";
  return used.gte(interval.times(opts.usageDueSoonPct).div(100)) ? "due_soon" : "ok";
}
