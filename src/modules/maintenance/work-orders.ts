import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { equipment, inventoryLots, locations, maintenancePlans, maintenanceWorkOrderParts, maintenanceWorkOrderStateTransitions, maintenanceWorkOrders, materials, sites, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { changeEquipmentStatus, equipmentAvailability, recordServiceRecord } from "@/modules/masterdata";
import { notifyRoles, notifyUsers } from "@/modules/platform";
import { MWO_KIND_LABEL, MWO_STATUS_LABEL, SERVICE_KIND_FOR, addDays, canMoveWorkOrder, type MaintenanceWoKind, type MaintenanceWoStatus } from "./rules";
import { AssignWorkOrderInput, CompleteWorkOrderInput, CreateWorkOrderInput, PlanWorkOrderInput, WorkOrderTransitionInput, parse } from "./schemas";
import { assertTechnician, equipmentInScope, manilaToday, namesOf, syncEquipmentDue, usersWithPermissionAt, withIdempotency } from "./shared";

/**
 * Maintenance work orders (US-6-19, process map W13-01/W13-05): corrective (breakdown) and inspection
 * orders raised by technicians or supervisors, preventive orders raised from a PM plan. State machine in
 * rules.ts (`MWO_TRANSITIONS`), one transition row and audit event per change. A work order that takes the
 * equipment down moves it to `maintenance` when work starts (a reported breakdown takes it out of service
 * when raised), so the W1D equipment gate refuses its use; completing writes the W1D service record through
 * `recordServiceRecord`, which sets due dates and returns the equipment to service on a passing result.
 */

type WoRow = typeof maintenanceWorkOrders.$inferSelect;
const LIVE: MaintenanceWoStatus[] = ["open", "in_progress", "on_hold"];

async function lockWo(tx: Tx, ctx: AuthContext, id: string): Promise<WoRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
  const [w] = await tx.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.id, id), eq(maintenanceWorkOrders.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!w || !ctx.allowedSiteIds.includes(w.siteId)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
  return w;
}

async function move(tx: Tx, ctx: AuthContext, w: WoRow, to: MaintenanceWoStatus, reason: string | null, set: Partial<typeof maintenanceWorkOrders.$inferInsert> = {}) {
  if (!canMoveWorkOrder(w.status, to)) throw new DomainError("state", `Work order ${w.workOrderNumber} is ${MWO_STATUS_LABEL[w.status as MaintenanceWoStatus]?.toLowerCase() ?? w.status}; it cannot move to ${MWO_STATUS_LABEL[to].toLowerCase()}.`);
  await tx.update(maintenanceWorkOrders).set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(maintenanceWorkOrders.id, w.id));
  await tx.insert(maintenanceWorkOrderStateTransitions).values({ organizationId: ctx.organizationId, siteId: w.siteId, workOrderId: w.id, fromState: w.status, toState: to, actorId: ctx.userId, reason });
  const from = w.status;
  Object.assign(w, set, { status: to });
  return from;
}

async function insertWo(tx: Tx, ctx: AuthContext, v: Omit<typeof maintenanceWorkOrders.$inferInsert, "organizationId" | "workOrderNumber" | "createdBy" | "statusChangedBy">) {
  const workOrderNumber = await nextNumber(tx, ctx.organizationId, "MWO");
  const [w] = await tx.insert(maintenanceWorkOrders).values({ ...v, organizationId: ctx.organizationId, workOrderNumber, createdBy: ctx.userId, statusChangedBy: ctx.userId }).returning();
  await tx.insert(maintenanceWorkOrderStateTransitions).values({ organizationId: ctx.organizationId, siteId: w.siteId, workOrderId: w.id, fromState: null, toState: "open", actorId: ctx.userId, reason: w.title });
  return w;
}

async function notifyAssignee(tx: Tx, ctx: AuthContext, w: WoRow, equipmentCode: string) {
  if (!w.assignedTo || w.assignedTo === ctx.userId) return;
  await notifyUsers(tx, [w.assignedTo], {
    organizationId: ctx.organizationId,
    siteId: w.siteId,
    kind: "maintenance.work_order.assigned",
    severity: w.priority === "urgent" ? "critical" : "info",
    title: `Maintenance ${w.workOrderNumber} on ${equipmentCode} is assigned to you`,
    body: w.title,
    entityType: "maintenance_work_order",
    entityId: w.id,
    link: `/maintenance/work-orders/${w.id}`,
    dedupeKey: `mwo-assigned:${w.id}:${w.assignedTo}`,
  });
}

/** Raises a corrective or inspection work order; a reported breakdown takes the equipment out of service at once. */
export async function createMaintenanceWorkOrder(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.work_order.create");
  const input = parse(CreateWorkOrderInput, raw);
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"mwo:" + input.idempotencyKey}))`);
      const [dup] = await tx.select({ id: maintenanceWorkOrders.id, n: maintenanceWorkOrders.workOrderNumber, siteId: maintenanceWorkOrders.siteId }).from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.organizationId, ctx.organizationId), eq(maintenanceWorkOrders.idempotencyKey, input.idempotencyKey))).limit(1);
      if (dup) {
        ctx.requireSite(dup.siteId);
        return { workOrderId: dup.id, workOrderNumber: dup.n, equipmentStatus: null, replayed: true };
      }
    }
    const e = await equipmentInScope(tx, ctx, input.equipmentId);
    ctx.requireAt("maintenance.work_order.create", e.siteId);
    if (input.assignedTo) await assertTechnician(tx, ctx, input.assignedTo, e.siteId, "assignedTo");
    const w = await insertWo(tx, ctx, {
      siteId: e.siteId,
      equipmentId: e.id,
      kind: input.kind,
      priority: input.priority,
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      assignedTo: input.assignedTo,
      takesEquipmentDown: input.takesEquipmentDown || input.reportedDown,
      reportedDown: input.reportedDown,
      idempotencyKey: input.idempotencyKey,
    });
    let equipmentStatus: string | null = null;
    if (input.reportedDown && e.status === "in_service") {
      await changeEquipmentStatus(ctx, { equipmentId: e.id, toStatus: "out_of_service", reason: `Breakdown reported: ${w.workOrderNumber} ${w.title}`.slice(0, 500) }, { tx });
      equipmentStatus = "out_of_service";
    }
    await audit(tx, ctx, { action: "maintenance.work_order.created", entityType: "maintenance_work_order", entityId: w.id, entityNumber: w.workOrderNumber, siteId: w.siteId, reason: w.description, after: { equipment: e.code, kind: w.kind, priority: w.priority, reportedDown: w.reportedDown, takesEquipmentDown: w.takesEquipmentDown, assignedTo: w.assignedTo, equipmentStatus } });
    await notifyAssignee(tx, ctx, w, e.code);
    if (input.reportedDown || input.priority === "urgent") {
      await notifyRoles(tx, { roleCodes: ["site_manager"], siteId: w.siteId }, { organizationId: ctx.organizationId, siteId: w.siteId, kind: "maintenance.work_order.breakdown", severity: "critical", title: `${e.code} ${input.reportedDown ? "reported down" : "needs urgent maintenance"}: ${w.workOrderNumber}`, body: w.title, entityType: "maintenance_work_order", entityId: w.id, link: `/maintenance/work-orders/${w.id}`, dedupeKey: `mwo-breakdown:${w.id}` });
    }
    return { workOrderId: w.id, workOrderNumber: w.workOrderNumber, equipmentStatus, replayed: false };
  });
}

/** Raises the preventive work order of an active PM plan (one live work order per plan). */
export async function createPlanWorkOrder(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.work_order.create");
  const input = parse(PlanWorkOrderInput, raw);
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"mwo:" + input.idempotencyKey}))`);
      const [dup] = await tx.select({ id: maintenanceWorkOrders.id, n: maintenanceWorkOrders.workOrderNumber }).from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.organizationId, ctx.organizationId), eq(maintenanceWorkOrders.idempotencyKey, input.idempotencyKey))).limit(1);
      if (dup) return { workOrderId: dup.id, workOrderNumber: dup.n, replayed: true };
    }
    const [p] = await tx.select().from(maintenancePlans).where(and(eq(maintenancePlans.id, input.planId), eq(maintenancePlans.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!p || !ctx.allowedSiteIds.includes(p.siteId)) throw new DomainError("not_found", "PM plan not found in your sites.");
    ctx.requireAt("maintenance.work_order.create", p.siteId);
    if (p.status !== "active") throw new DomainError("state", `PM plan ${p.planNumber} is ${p.status}; resume it first.`);
    const [live] = await tx.select({ n: maintenanceWorkOrders.workOrderNumber }).from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.planId, p.id), inArray(maintenanceWorkOrders.status, LIVE))).limit(1);
    if (live) throw new DomainError("conflict", `Work order ${live.n} for this plan is already open.`);
    const assignedTo = input.assignedTo ?? p.responsibleUserId;
    if (assignedTo) await assertTechnician(tx, ctx, assignedTo, p.siteId, "assignedTo");
    const [e] = await tx.select({ code: equipment.code }).from(equipment).where(eq(equipment.id, p.equipmentId)).limit(1);
    const w = await insertWo(tx, ctx, {
      siteId: p.siteId,
      equipmentId: p.equipmentId,
      planId: p.id,
      kind: "preventive",
      priority: input.priority,
      title: `${p.planNumber}: ${p.title}`.slice(0, 200),
      description: p.instructions,
      dueDate: input.dueDate ?? p.nextDueOn ?? manilaToday(),
      assignedTo,
      takesEquipmentDown: p.takesEquipmentDown,
      idempotencyKey: input.idempotencyKey,
    });
    await audit(tx, ctx, { action: "maintenance.work_order.created", entityType: "maintenance_work_order", entityId: w.id, entityNumber: w.workOrderNumber, siteId: w.siteId, after: { equipment: e.code, kind: "preventive", planId: p.id, plan: p.planNumber, dueDate: w.dueDate, assignedTo } });
    await notifyAssignee(tx, ctx, w, e.code);
    return { workOrderId: w.id, workOrderNumber: w.workOrderNumber, replayed: false };
  });
}

/** Assigns a technician, due date or priority while the work order is live. */
export async function assignMaintenanceWorkOrder(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.work_order.edit");
  const input = parse(AssignWorkOrderInput, raw);
  return db.transaction(async (tx) => {
    const w = await lockWo(tx, ctx, input.workOrderId);
    ctx.requireAt("maintenance.work_order.edit", w.siteId);
    if (!LIVE.includes(w.status as MaintenanceWoStatus)) throw new DomainError("state", `Work order ${w.workOrderNumber} is ${w.status}.`);
    await assertTechnician(tx, ctx, input.assignedTo, w.siteId, "assignedTo");
    const set: Partial<typeof maintenanceWorkOrders.$inferInsert> = { assignedTo: input.assignedTo };
    if (input.dueDate !== undefined) set.dueDate = input.dueDate;
    if (input.priority) set.priority = input.priority;
    await tx.update(maintenanceWorkOrders).set(set).where(eq(maintenanceWorkOrders.id, w.id));
    await audit(tx, ctx, { action: "maintenance.work_order.assigned", entityType: "maintenance_work_order", entityId: w.id, entityNumber: w.workOrderNumber, siteId: w.siteId, before: { assignedTo: w.assignedTo, dueDate: w.dueDate, priority: w.priority }, after: set });
    const [e] = await tx.select({ code: equipment.code }).from(equipment).where(eq(equipment.id, w.equipmentId)).limit(1);
    await notifyAssignee(tx, ctx, { ...w, ...set } as WoRow, e.code);
    return { workOrderId: w.id };
  });
}

/**
 * Start / resume (→ in_progress), wait (→ on_hold, reason) or cancel (→ cancelled, reason,
 * maintenance.work_order.void). Starting a work order that takes the equipment down moves an in-service
 * equipment to `maintenance` (W1D state machine; downtime event opened).
 */
export async function transitionMaintenanceWorkOrder(ctx: AuthContext, raw: unknown) {
  const input = parse(WorkOrderTransitionInput, raw);
  ctx.require(input.to === "cancelled" ? "maintenance.work_order.void" : "maintenance.work_order.edit");
  return db.transaction(async (tx) => {
    const w = await lockWo(tx, ctx, input.workOrderId);
    ctx.requireAt(input.to === "cancelled" ? "maintenance.work_order.void" : "maintenance.work_order.edit", w.siteId);
    if ((input.to === "on_hold" || input.to === "cancelled") && (!input.reason || input.reason.length < 5)) {
      throw new DomainError("validation", "Give a reason of at least 5 characters.", { field: "reason", fieldErrors: { reason: "Required." } });
    }
    let equipmentStatus: string | null = null;
    const [e] = await tx.select().from(equipment).where(eq(equipment.id, w.equipmentId)).limit(1);
    if (input.to === "in_progress") {
      const first = !w.startedAt;
      await move(tx, ctx, w, "in_progress", input.reason ?? (first ? "Work started" : "Work resumed"), first ? { startedAt: new Date(), startedBy: ctx.userId, holdReason: null } : { holdReason: null });
      if (w.takesEquipmentDown && e.status === "in_service") {
        await changeEquipmentStatus(ctx, { equipmentId: e.id, toStatus: "maintenance", reason: `Maintenance ${w.workOrderNumber} in progress` }, { tx });
        equipmentStatus = "maintenance";
      }
    } else if (input.to === "on_hold") {
      await move(tx, ctx, w, "on_hold", input.reason, { holdReason: input.reason });
    } else {
      await move(tx, ctx, w, "cancelled", input.reason, { cancelReason: input.reason });
    }
    await audit(tx, ctx, {
      action: input.to === "in_progress" ? "maintenance.work_order.started" : input.to === "on_hold" ? "maintenance.work_order.on_hold" : "maintenance.work_order.cancelled",
      entityType: "maintenance_work_order",
      entityId: w.id,
      entityNumber: w.workOrderNumber,
      siteId: w.siteId,
      reason: input.reason,
      after: { status: input.to, equipmentStatus },
    });
    return { status: input.to, equipmentStatus, equipmentStillDown: input.to === "cancelled" && e.status !== "in_service" };
  });
}

/**
 * Completes the work order (in progress → completed): writes the W1D service record (preventive_maintenance,
 * repair or inspection; result pass / fail / completed) in the same transaction. A passing preventive order
 * resets its PM plan (time based: next due = completion date + interval; usage based: usage counted from
 * now) and the equipment's next-maintenance date follows its plans. A failed result leaves the equipment out
 * of service (W1D) and the plan due. Other live orders that take the equipment down keep it in maintenance.
 */
export async function completeMaintenanceWorkOrder(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.work_order.edit");
  ctx.require("masterdata.equipment.edit");
  const input = parse(CompleteWorkOrderInput, raw);
  return db.transaction(async (tx) => {
    const w = await lockWo(tx, ctx, input.workOrderId);
    ctx.requireAt("maintenance.work_order.edit", w.siteId);
    return withIdempotency(tx, ctx, input.idempotencyKey, "maintenance.work_order.complete", async () => {
      if (w.status !== "in_progress") throw new DomainError("state", `Work order ${w.workOrderNumber} is ${MWO_STATUS_LABEL[w.status as MaintenanceWoStatus]?.toLowerCase() ?? w.status}; start it before completing.`);
      const kind = w.kind as MaintenanceWoKind;
      const pass = input.result !== "fail";
      const plan = w.planId ? ((await tx.select().from(maintenancePlans).where(eq(maintenancePlans.id, w.planId)).for("update").limit(1))[0] ?? null) : null;
      const today = manilaToday();
      const nextPlanDue = plan && pass && plan.triggerKind === "time" && plan.intervalDays ? addDays(today, plan.intervalDays) : null;
      const svc = await recordServiceRecord(
        ctx,
        {
          equipmentId: w.equipmentId,
          serviceKind: SERVICE_KIND_FOR[kind],
          result: input.result,
          performedByExternal: input.performedByExternal ?? undefined,
          nextDueDate: nextPlanDue ?? undefined,
          referenceNumber: input.referenceNumber ?? w.workOrderNumber,
          notes: `${w.workOrderNumber}: ${input.workDone}`.slice(0, 2000),
        },
        { tx },
      );
      const now = new Date();
      await move(tx, ctx, w, "completed", input.workDone.slice(0, 500), { completedAt: now, completedBy: ctx.userId, workDone: input.workDone, result: input.result, serviceRecordId: svc.recordId });
      let planUpdate: Record<string, unknown> | null = null;
      if (plan && pass) {
        const set: Partial<typeof maintenancePlans.$inferInsert> = { lastCompletedAt: now, lastWorkOrderId: w.id, updatedAt: now };
        if (plan.triggerKind === "time") set.nextDueOn = nextPlanDue;
        else set.usageSince = now;
        await tx.update(maintenancePlans).set(set).where(eq(maintenancePlans.id, plan.id));
        planUpdate = { plan: plan.planNumber, nextDueOn: set.nextDueOn ?? null, usageSince: set.usageSince ?? null };
      }
      // The equipment's stored next-maintenance date is the earliest active time-based plan (W1D derives availability from it).
      const sync = plan ? await syncEquipmentDue(tx, ctx, w.equipmentId, `${w.workOrderNumber} completed`) : null;
      // Another live order that takes the equipment down keeps it in maintenance.
      const [other] = await tx
        .select({ n: maintenanceWorkOrders.workOrderNumber })
        .from(maintenanceWorkOrders)
        .where(and(eq(maintenanceWorkOrders.equipmentId, w.equipmentId), ne(maintenanceWorkOrders.id, w.id), eq(maintenanceWorkOrders.takesEquipmentDown, true), inArray(maintenanceWorkOrders.status, ["in_progress", "on_hold"])))
        .limit(1);
      let status = svc.status;
      if (other && status === "in_service") {
        await changeEquipmentStatus(ctx, { equipmentId: w.equipmentId, toStatus: "maintenance", reason: `Maintenance ${other.n} still in progress` }, { tx });
        status = "maintenance";
      }
      await audit(tx, ctx, {
        action: "maintenance.work_order.completed",
        entityType: "maintenance_work_order",
        entityId: w.id,
        entityNumber: w.workOrderNumber,
        siteId: w.siteId,
        reason: input.workDone,
        after: { result: input.result, serviceRecordId: svc.recordId, equipmentStatus: status, statusChange: svc.statusChange, planUpdate, maintenanceDueDate: sync?.maintenanceDueDate ?? null },
      });
      if (!pass) {
        await notifyRoles(tx, { roleCodes: ["site_manager"], siteId: w.siteId }, { organizationId: ctx.organizationId, siteId: w.siteId, kind: "maintenance.work_order.failed", severity: "critical", title: `${w.workOrderNumber} failed: the equipment stays out of service`, body: input.workDone, entityType: "maintenance_work_order", entityId: w.id, link: `/maintenance/work-orders/${w.id}`, dedupeKey: `mwo-failed:${w.id}` });
      }
      return { status: "completed" as const, equipmentStatus: status, serviceRecordId: svc.recordId };
    });
  });
}

/* ------------------------------------------------------------------ queries */

export async function listMaintenanceWorkOrders(ctx: AuthContext, f: { status?: string; equipmentId?: string; mine?: boolean } = {}) {
  ctx.require("maintenance.work_order.view");
  const conds = [eq(maintenanceWorkOrders.organizationId, ctx.organizationId), inArray(maintenanceWorkOrders.siteId, ctx.allowedSiteIds)];
  if (f.equipmentId) conds.push(eq(maintenanceWorkOrders.equipmentId, f.equipmentId));
  if (f.mine) conds.push(eq(maintenanceWorkOrders.assignedTo, ctx.userId));
  if (!f.status || f.status === "live") conds.push(inArray(maintenanceWorkOrders.status, LIVE));
  else if (f.status !== "all" && (Object.keys(MWO_STATUS_LABEL) as string[]).includes(f.status)) conds.push(eq(maintenanceWorkOrders.status, f.status));
  const today = manilaToday();
  const rows = await db
    .select({ w: maintenanceWorkOrders, equipmentCode: equipment.code, equipmentName: equipment.name, equipmentStatus: equipment.status, siteCode: sites.code, assignee: users.displayName, planNumber: maintenancePlans.planNumber })
    .from(maintenanceWorkOrders)
    .innerJoin(equipment, eq(equipment.id, maintenanceWorkOrders.equipmentId))
    .innerJoin(sites, eq(sites.id, maintenanceWorkOrders.siteId))
    .leftJoin(users, eq(users.id, maintenanceWorkOrders.assignedTo))
    .leftJoin(maintenancePlans, eq(maintenancePlans.id, maintenanceWorkOrders.planId))
    .where(and(...conds))
    .orderBy(desc(maintenanceWorkOrders.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.w, equipmentCode: r.equipmentCode, equipmentName: r.equipmentName, equipmentStatus: r.equipmentStatus, siteCode: r.siteCode, assigneeName: r.assignee, planNumber: r.planNumber, kindLabel: MWO_KIND_LABEL[r.w.kind as MaintenanceWoKind] ?? r.w.kind, statusLabel: MWO_STATUS_LABEL[r.w.status as MaintenanceWoStatus] ?? r.w.status, overdue: LIVE.includes(r.w.status as MaintenanceWoStatus) && !!r.w.dueDate && r.w.dueDate < today }));
}

export async function getMaintenanceWorkOrder(ctx: AuthContext, id: string) {
  ctx.require("maintenance.work_order.view");
  const w = await db.transaction(async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
    const [row] = await tx.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.id, id), eq(maintenanceWorkOrders.organizationId, ctx.organizationId))).limit(1);
    if (!row || !ctx.allowedSiteIds.includes(row.siteId)) throw new DomainError("not_found", "Maintenance work order not found in your sites.");
    return row;
  });
  const [e] = await db.select({ e: equipment, siteCode: sites.code }).from(equipment).innerJoin(sites, eq(sites.id, equipment.siteId)).where(eq(equipment.id, w.equipmentId)).limit(1);
  const plan = w.planId ? ((await db.select({ id: maintenancePlans.id, number: maintenancePlans.planNumber, title: maintenancePlans.title, triggerKind: maintenancePlans.triggerKind }).from(maintenancePlans).where(eq(maintenancePlans.id, w.planId)).limit(1))[0] ?? null) : null;
  const parts = await db
    .select({ p: maintenanceWorkOrderParts, materialCode: materials.code, materialName: materials.name, lotNumber: inventoryLots.lotNumber, locationCode: locations.code })
    .from(maintenanceWorkOrderParts)
    .innerJoin(materials, eq(materials.id, maintenanceWorkOrderParts.materialId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, maintenanceWorkOrderParts.lotId))
    .innerJoin(locations, eq(locations.id, maintenanceWorkOrderParts.fromLocationId))
    .where(eq(maintenanceWorkOrderParts.workOrderId, w.id))
    .orderBy(asc(maintenanceWorkOrderParts.issuedAt));
  const timeline = await db
    .select({ from: maintenanceWorkOrderStateTransitions.fromState, to: maintenanceWorkOrderStateTransitions.toState, reason: maintenanceWorkOrderStateTransitions.reason, at: maintenanceWorkOrderStateTransitions.occurredAt, by: users.displayName })
    .from(maintenanceWorkOrderStateTransitions)
    .innerJoin(users, eq(users.id, maintenanceWorkOrderStateTransitions.actorId))
    .where(eq(maintenanceWorkOrderStateTransitions.workOrderId, w.id))
    .orderBy(asc(maintenanceWorkOrderStateTransitions.occurredAt));
  const names = await namesOf([w.assignedTo, w.createdBy, w.startedBy, w.completedBy, ...parts.map((p) => p.p.issuedBy)]);
  let availability: Awaited<ReturnType<typeof equipmentAvailability>> | null = null;
  try {
    availability = await equipmentAvailability(ctx, w.equipmentId);
  } catch (err) {
    if (!(err instanceof DomainError) || err.code !== "forbidden") throw err;
  }
  const live = LIVE.includes(w.status as MaintenanceWoStatus);
  return {
    workOrder: { ...w, kindLabel: MWO_KIND_LABEL[w.kind as MaintenanceWoKind] ?? w.kind, statusLabel: MWO_STATUS_LABEL[w.status as MaintenanceWoStatus] ?? w.status, assigneeName: w.assignedTo ? (names.get(w.assignedTo) ?? null) : null, createdByName: names.get(w.createdBy) ?? null, startedByName: w.startedBy ? (names.get(w.startedBy) ?? null) : null, completedByName: w.completedBy ? (names.get(w.completedBy) ?? null) : null },
    equipment: { id: e.e.id, code: e.e.code, name: e.e.name, status: e.e.status, siteCode: e.siteCode, maintenanceDueDate: e.e.maintenanceDueDate },
    availability,
    plan,
    parts: parts.map((p) => ({ ...p.p, materialCode: p.materialCode, materialName: p.materialName, lotNumber: p.lotNumber, locationCode: p.locationCode, issuedByName: names.get(p.p.issuedBy) ?? null })),
    timeline,
    technicians: live ? await usersWithPermissionAt(db, ctx.organizationId, "maintenance.work_order.edit", w.siteId) : [],
    can: {
      start: (w.status === "open" || w.status === "on_hold") && ctx.canAt("maintenance.work_order.edit", w.siteId),
      hold: w.status === "in_progress" && ctx.canAt("maintenance.work_order.edit", w.siteId),
      complete: w.status === "in_progress" && ctx.canAt("maintenance.work_order.edit", w.siteId) && ctx.canAt("masterdata.equipment.edit", w.siteId),
      cancel: live && ctx.canAt("maintenance.work_order.void", w.siteId),
      assign: live && ctx.canAt("maintenance.work_order.edit", w.siteId),
      issueParts: (w.status === "in_progress" || w.status === "on_hold") && ctx.canAt("maintenance.work_order.post", w.siteId),
    },
  };
}

/** Context for the "Report a problem / raise a work order" form. */
export async function maintenanceFormContext(ctx: AuthContext, ref: { equipmentId?: string | null } = {}) {
  ctx.require("maintenance.work_order.create");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("maintenance.work_order.create", s));
  const eq_ = siteIds.length
    ? await db.select({ id: equipment.id, code: equipment.code, name: equipment.name, status: equipment.status, siteId: equipment.siteId, siteCode: sites.code }).from(equipment).innerJoin(sites, eq(sites.id, equipment.siteId)).where(and(eq(equipment.organizationId, ctx.organizationId), inArray(equipment.siteId, siteIds))).orderBy(asc(sites.code), asc(equipment.code))
    : [];
  const pre = ref.equipmentId ? eq_.find((x) => x.id === ref.equipmentId) ?? null : null;
  return { equipment: eq_, preselected: pre, technicians: await usersWithPermissionAt(db, ctx.organizationId, "maintenance.work_order.edit", pre?.siteId ?? ctx.currentSiteId) };
}

/** Live maintenance of one piece of equipment (equipment page card). */
export async function equipmentMaintenanceSummary(ctx: AuthContext, equipmentId: string) {
  if (!ctx.can("maintenance.work_order.view") && !ctx.can("maintenance.plan.view")) return null;
  const e = await equipmentInScope(db, ctx, equipmentId);
  const orders = ctx.can("maintenance.work_order.view")
    ? await db.select().from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.equipmentId, e.id), inArray(maintenanceWorkOrders.status, LIVE))).orderBy(desc(maintenanceWorkOrders.createdAt))
    : [];
  const plans = ctx.can("maintenance.plan.view") ? await db.select().from(maintenancePlans).where(and(eq(maintenancePlans.equipmentId, e.id), eq(maintenancePlans.status, "active"))).orderBy(asc(maintenancePlans.planNumber)) : [];
  return { orders, plans };
}
