import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials } from "./masterdata";
import { equipment, equipmentServiceRecords } from "./engineering";
import { inventoryLots, stockMovements } from "./inventory";

/**
 * Wave 4 W4C: equipment maintenance (US-6-19, FR-production-15; data-model A-DM-30, §13.7 deferred
 * tables now built). Preventive-maintenance plans on the W1D equipment register (time or usage
 * based), maintenance work orders with a state machine, spare parts as ordinary materials and lots
 * (issued through the stock ledger) and the equipment's availability: an overdue plan is a
 * `maintenance_due` reason, a work order in progress takes the equipment to `maintenance`.
 * Intervals, lead times and checklists are the company's maintenance configuration, never fixed rules.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const MAINTENANCE_PLAN_TRIGGERS = ["time", "usage"] as const;
/** Usage counted from production's equipment_uses since the last completed PM: distinct batches or hours of use. */
export const MAINTENANCE_USAGE_METRICS = ["batches", "hours"] as const;
export const MAINTENANCE_PLAN_STATUSES = ["active", "paused", "retired"] as const;

/** Preventive-maintenance plan of one piece of equipment (numbering PM). */
export const maintenancePlans = pgTable(
  "maintenance_plans",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    planNumber: text("plan_number").notNull(),
    title: text("title").notNull(),
    /** Checklist / instructions as written by the company's maintenance lead. */
    instructions: text("instructions"),
    triggerKind: text("trigger_kind").notNull(),
    intervalDays: integer("interval_days"),
    usageMetric: text("usage_metric"),
    usageInterval: numeric("usage_interval", QTY),
    /** Days before the due date the plan shows as "due soon" (null = setting maintenance.pm.due_soon_days). */
    leadDays: integer("lead_days"),
    /** Whether the PM work takes the equipment out of use while it is done (stored status `maintenance`). */
    takesEquipmentDown: boolean("takes_equipment_down").notNull().default(true),
    responsibleUserId: uuid("responsible_user_id").references(() => users.id),
    status: text("status").notNull().default("active"),
    /** Time-based: the next due date. Usage-based: null (due when the usage since lastCompletedAt reaches the interval). */
    nextDueOn: date("next_due_on"),
    /** Usage is counted from this instant (plan start or the last completed PM). */
    usageSince: timestamp("usage_since", { withTimezone: true }).notNull().defaultNow(),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    lastWorkOrderId: uuid("last_work_order_id"),
    statusReason: text("status_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_maintenance_plans_org_number").on(t.organizationId, t.planNumber),
    index("ix_maintenance_plans_equipment").on(t.equipmentId, t.status),
    check("ck_maintenance_plans_trigger", sql`${t.triggerKind} in (${inList(MAINTENANCE_PLAN_TRIGGERS)})`),
    check("ck_maintenance_plans_status", sql`${t.status} in (${inList(MAINTENANCE_PLAN_STATUSES)})`),
    check(
      "ck_maintenance_plans_time",
      sql`${t.triggerKind} <> 'time' or (${t.intervalDays} is not null and ${t.intervalDays} > 0 and ${t.nextDueOn} is not null and ${t.usageMetric} is null and ${t.usageInterval} is null)`,
    ),
    check(
      "ck_maintenance_plans_usage",
      sql`${t.triggerKind} <> 'usage' or (${t.usageMetric} in (${inList(MAINTENANCE_USAGE_METRICS)}) and ${t.usageInterval} is not null and ${t.usageInterval} > 0 and ${t.intervalDays} is null and ${t.nextDueOn} is null)`,
    ),
    check("ck_maintenance_plans_lead", sql`${t.leadDays} is null or (${t.leadDays} >= 0 and ${t.leadDays} <= 365)`),
    check("ck_maintenance_plans_reason", sql`${t.status} = 'active' or ${t.statusReason} is not null`),
  ],
);

/** Maintenance work order state machine (`MWO_TRANSITIONS` in src/modules/maintenance/rules.ts). */
export const MAINTENANCE_WO_STATUSES = ["open", "in_progress", "on_hold", "completed", "cancelled"] as const;
export const MAINTENANCE_WO_KINDS = ["preventive", "corrective", "inspection"] as const;
export const MAINTENANCE_WO_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MAINTENANCE_WO_RESULTS = ["completed", "pass", "fail"] as const;

/**
 * Maintenance work order (numbering MWO). Completing it writes the W1D service record
 * (`equipment_service_records`, kind preventive_maintenance or repair or inspection) through the
 * equipment service, which applies due dates and returns the equipment to service.
 */
export const maintenanceWorkOrders = pgTable(
  "maintenance_work_orders",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    planId: uuid("plan_id").references(() => maintenancePlans.id),
    workOrderNumber: text("work_order_number").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    /** The equipment is out of use while the work is in progress (and from reporting when `reported_down`). */
    takesEquipmentDown: boolean("takes_equipment_down").notNull().default(true),
    /** A breakdown report: the equipment was taken out of service when the work order was raised. */
    reportedDown: boolean("reported_down").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedBy: uuid("started_by").references(() => users.id),
    holdReason: text("hold_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    workDone: text("work_done"),
    result: text("result"),
    serviceRecordId: uuid("service_record_id").references(() => equipmentServiceRecords.id),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("uq_maintenance_wos_org_number").on(t.organizationId, t.workOrderNumber),
    uniqueIndex("uq_maintenance_wos_org_idem").on(t.organizationId, t.idempotencyKey),
    /** One live preventive work order per plan. */
    uniqueIndex("uq_maintenance_wos_plan_live").on(t.planId).where(sql`${t.planId} is not null and ${t.status} in ('open', 'in_progress', 'on_hold')`),
    index("ix_maintenance_wos_site_status").on(t.siteId, t.status),
    index("ix_maintenance_wos_equipment").on(t.equipmentId, t.status),
    check("ck_maintenance_wos_kind", sql`${t.kind} in (${inList(MAINTENANCE_WO_KINDS)})`),
    check("ck_maintenance_wos_status", sql`${t.status} in (${inList(MAINTENANCE_WO_STATUSES)})`),
    check("ck_maintenance_wos_priority", sql`${t.priority} in (${inList(MAINTENANCE_WO_PRIORITIES)})`),
    check("ck_maintenance_wos_result", sql`${t.result} is null or ${t.result} in (${inList(MAINTENANCE_WO_RESULTS)})`),
    check("ck_maintenance_wos_started", sql`${t.status} in ('open', 'cancelled') or (${t.startedAt} is not null and ${t.startedBy} is not null)`),
    check(
      "ck_maintenance_wos_completed",
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null and ${t.completedBy} is not null and ${t.workDone} is not null and ${t.result} is not null and ${t.serviceRecordId} is not null)`,
    ),
    check("ck_maintenance_wos_hold", sql`${t.status} <> 'on_hold' or ${t.holdReason} is not null`),
    check("ck_maintenance_wos_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
    check("ck_maintenance_wos_preventive_plan", sql`${t.kind} <> 'preventive' or ${t.planId} is not null`),
  ],
);

export const maintenanceWorkOrderStateTransitions = pgTable(
  "maintenance_work_order_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    workOrderId: uuid("work_order_id").notNull().references(() => maintenanceWorkOrders.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_mwo_transitions_wo").on(t.workOrderId, t.occurredAt)],
);

/** Spare parts issued to a work order: one `issue` stock movement each (source document maintenance_work_order). */
export const maintenanceWorkOrderParts = pgTable(
  "maintenance_work_order_parts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    workOrderId: uuid("work_order_id").notNull().references(() => maintenanceWorkOrders.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    uomBase: text("uom_base").notNull(),
    stockMovementId: uuid("stock_movement_id").notNull().references(() => stockMovements.id),
    issuedBy: uuid("issued_by").notNull().references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_mwo_parts_movement").on(t.stockMovementId),
    index("ix_mwo_parts_wo").on(t.workOrderId),
    check("ck_mwo_parts_qty", sql`${t.qtyBase} > 0`),
  ],
);

/**
 * Spare-parts list: which materials are kept as spares at a site, optionally for one piece of equipment,
 * with a minimum stock for the "below minimum" view. The parts themselves are ordinary materials and lots.
 */
export const maintenanceSpareParts = pgTable(
  "maintenance_spare_parts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    minQtyBase: numeric("min_qty_base", QTY),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("uq_maintenance_spare_parts").on(t.siteId, t.materialId, t.equipmentId).nullsNotDistinct(),
    check("ck_maintenance_spare_parts_min", sql`${t.minQtyBase} is null or ${t.minQtyBase} >= 0`),
  ],
);
