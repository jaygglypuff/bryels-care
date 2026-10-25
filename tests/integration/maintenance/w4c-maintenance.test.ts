import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  batches,
  equipment,
  equipmentServiceRecords,
  equipmentUses,
  maintenancePlans,
  maintenanceWorkOrderParts,
  maintenanceWorkOrderStateTransitions,
  maintenanceWorkOrders,
  materials,
  stockMovements,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { detectAll } from "@/modules/action-centre";
import {
  MWO_TRANSITIONS,
  canMoveWorkOrder,
  changeMaintenancePlanStatus,
  completeMaintenanceWorkOrder,
  createMaintenancePlan,
  createMaintenanceWorkOrder,
  createPlanWorkOrder,
  getMaintenancePlan,
  getMaintenanceWorkOrder,
  issueSparePart,
  listMaintenancePlans,
  listMaintenanceWorkOrders,
  listSpareParts,
  pmDueCandidates,
  planDueState,
  registerSparePart,
  transitionMaintenanceWorkOrder,
  updateMaintenancePlan,
} from "@/modules/maintenance";
import { equipmentAvailability, listEquipment } from "@/modules/masterdata";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, onHand, type Kit } from "../../support/kit";

/** US-6-19 preventive maintenance, maintenance work orders, spare parts and equipment availability (W4C). */

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let warehouse: AuthContext;
let owner: AuthContext;
let qa: AuthContext;
let managerRvs: AuthContext;
const eqId: Record<string, string> = {};

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function freshEquipment(code: string, kind = "mixer") {
  const [e] = await db
    .insert(equipment)
    .values({ organizationId: kit.orgId, siteId: kit.nfd.id, code, name: `Test ${code}`, equipmentKind: kind, status: "in_service", cleaningStatus: "clean", cleaningRule: "none", blockingRule: "block", statusChangedBy: manager.userId, createdBy: manager.userId })
    .returning();
  eqId[code] = e.id;
  return e;
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
});

describe("US-6-19 preventive maintenance plans", () => {
  let planId: string;

  it("statemachine.maintenance_work_order and due-state rules", () => {
    expect(MWO_TRANSITIONS.open).toEqual(["in_progress", "cancelled"]);
    expect(canMoveWorkOrder("open", "completed")).toBe(false);
    expect(canMoveWorkOrder("on_hold", "in_progress")).toBe(true);
    const base = { status: "active", triggerKind: "time", usageInterval: null };
    expect(planDueState({ ...base, nextDueOn: "2026-10-10" }, { today: "2026-10-11", leadDays: 7, usageDueSoonPct: 90 })).toBe("overdue");
    expect(planDueState({ ...base, nextDueOn: "2026-10-11" }, { today: "2026-10-11", leadDays: 7, usageDueSoonPct: 90 })).toBe("due");
    expect(planDueState({ ...base, nextDueOn: "2026-10-15" }, { today: "2026-10-11", leadDays: 7, usageDueSoonPct: 90 })).toBe("due_soon");
    expect(planDueState({ status: "active", triggerKind: "usage", nextDueOn: null, usageInterval: "10" }, { today: "2026-10-11", leadDays: 7, usage: "9", usageDueSoonPct: 90 })).toBe("due_soon");
    expect(planDueState({ status: "paused", triggerKind: "usage", nextDueOn: null, usageInterval: "10" }, { today: "2026-10-11", leadDays: 7, usage: "12", usageDueSoonPct: 90 })).toBe("ok");
  });

  it("a time-based plan sets the equipment's next maintenance date; overdue PM blocks the equipment (W1D availability)", async () => {
    const e = await freshEquipment("MIX-T1");
    const today = manilaToday();
    await expectCode(createMaintenancePlan(operator, { equipmentId: e.id, title: "Gearbox oil", triggerKind: "time", intervalDays: 30 }), "forbidden");
    await expectCode(createMaintenancePlan(manager, { equipmentId: e.id, title: "Gearbox oil", triggerKind: "time" }), "validation");
    const r = await createMaintenancePlan(manager, { equipmentId: e.id, title: "Gearbox oil and seals", triggerKind: "time", intervalDays: 30, firstDueOn: plusDays(today, 2), responsibleUserId: operator.userId });
    planId = r.planId;
    expect(r.planNumber).toMatch(/^PM-\d{4}$/);
    const [eq1] = await db.select().from(equipment).where(eq(equipment.id, e.id));
    expect(eq1.maintenanceDueDate).toBe(plusDays(today, 2));
    expect((await equipmentAvailability(operator, e.id)).usable).toBe(true);
    const later = new Date(Date.now() + 4 * 86_400_000);
    const av = await equipmentAvailability(operator, e.id, later);
    expect(av.usable).toBe(false);
    expect(av.blockingReasons.map((x) => x.code)).toEqual(["maintenance_due"]);
    const plans = await listMaintenancePlans(manager, { equipmentId: e.id });
    expect(plans[0]).toMatchObject({ id: planId, dueState: "due_soon" });
    expect((await pmDueCandidates(kit.orgId)).find((c) => c.entityId === planId)).toMatchObject({ kind: "pm_due", siteId: kit.nfd.id });
    const due = await pmDueCandidates(kit.orgId, new Date(Date.now() + 5 * 86_400_000));
    expect(due.find((c) => c.entityId === planId)?.kind).toBe("pm_overdue");
    await expectCode(updateMaintenancePlan(manager, { planId, nextDueOn: plusDays(today, -1) }), "validation");
  });

  it("authz.cross_site.maintenance_plan: another site's plans are invisible", async () => {
    await expectCode(getMaintenancePlan(managerRvs, planId), "not_found");
    expect(await listMaintenancePlans(managerRvs)).toHaveLength(0);
  });

  it("a usage-based plan that reached its interval is a maintenance_due reason through the registered provider", async () => {
    const e = await freshEquipment("MLD-T1", "mould");
    await createMaintenancePlan(manager, { equipmentId: e.id, title: "Frame inspection every 2 batches", triggerKind: "usage", usageMetric: "batches", usageInterval: "2" });
    expect((await equipmentAvailability(operator, e.id)).usable).toBe(true);
    const bs = await db.select().from(batches).where(eq(batches.siteId, kit.nfd.id)).limit(2);
    for (const b of bs) await db.insert(equipmentUses).values({ organizationId: kit.orgId, siteId: kit.nfd.id, batchId: b.id, equipmentId: e.id, operatorId: operator.userId, startedAt: new Date(), endedAt: new Date(), statusAtStart: "in_service", cleaningStatusAtStart: "clean" });
    const av = await equipmentAvailability(operator, e.id);
    expect(av.usable).toBe(false);
    expect(av.blockingReasons[0]).toMatchObject({ code: "maintenance_due" });
    expect(av.blockingReasons[0].detail).toMatch(/2 of 2 batches/);
    const listed = (await listEquipment(operator)).find((x) => x.id === e.id)!;
    expect(listed.availability.selectable).toBe(false);
    const kinds = (await detectAll(kit.orgId, new Date())).filter((c) => c.entityType === "maintenance_plan").map((c) => c.kind);
    expect(kinds).toContain("pm_overdue");
  });
});

describe("US-6-19 maintenance work orders and spare parts", () => {
  let woId: string;
  let partLot: Awaited<ReturnType<typeof makeLot>>;
  let shelfId: string;

  it("raises the PM plan's work order (one live per plan); starting it takes the equipment to maintenance", async () => {
    const [p] = await db.select().from(maintenancePlans).where(eq(maintenancePlans.equipmentId, eqId["MIX-T1"]));
    await expectCode(createPlanWorkOrder(warehouse, { planId: p.id }), "forbidden");
    const r = await createPlanWorkOrder(manager, { planId: p.id, idempotencyKey: "w4c-mwo-1" });
    woId = r.workOrderId;
    expect(r.workOrderNumber).toMatch(/^MWO-\d{2}-\d{4}$/);
    expect((await createPlanWorkOrder(manager, { planId: p.id, idempotencyKey: "w4c-mwo-1" })).replayed).toBe(true);
    await expectCode(createPlanWorkOrder(manager, { planId: p.id }), "conflict");
    const [w] = await db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, woId));
    expect(w).toMatchObject({ kind: "preventive", status: "open", assignedTo: operator.userId, takesEquipmentDown: true });
    await expectCode(completeMaintenanceWorkOrder(operator, { workOrderId: woId, workDone: "Changed oil", result: "pass" }), "state");
    await transitionMaintenanceWorkOrder(operator, { workOrderId: woId, to: "in_progress" });
    const [e] = await db.select().from(equipment).where(eq(equipment.id, eqId["MIX-T1"]));
    expect(e.status).toBe("maintenance");
    const av = await equipmentAvailability(operator, e.id);
    expect(av.usable).toBe(false);
    expect(av.blockingReasons.map((x) => x.code)).toEqual(["out_of_service"]);
    await expectCode(getMaintenanceWorkOrder(managerRvs, woId), "not_found");
    expect(await listMaintenanceWorkOrders(managerRvs)).toHaveLength(0);
    expect((await getMaintenanceWorkOrder(owner, woId)).can.start).toBe(false);
  });

  it("issues spare parts through postMovement: listed materials, released lots only, idempotent", async () => {
    const [m] = await db.insert(materials).values({ organizationId: kit.orgId, code: "SPR-T001", name: "Test mixer seal kit", materialKind: "consumable", baseUom: "pcs" }).returning();
    const shelf = await loc(kit.nfd.id, "PKG-01");
    shelfId = shelf.id;
    partLot = await makeLot(manager, kit.nfd.id, shelf.id, "5", { materialCode: "SPR-T001", expiresOn: null });
    const held = await makeLot(manager, kit.nfd.id, shelf.id, "5", { materialCode: "SPR-T001", expiresOn: null, status: "quarantine" });
    await expectCode(issueSparePart(warehouse, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelf.id, qty: "1", idempotencyKey: "w4c-part-0" }), "validation");
    await expectCode(registerSparePart(warehouse, { siteId: kit.nfd.id, materialId: m.id, equipmentId: eqId["MIX-T1"], minQty: "2" }), "forbidden");
    await registerSparePart(manager, { siteId: kit.nfd.id, materialId: m.id, equipmentId: eqId["MIX-T1"], minQty: "2" });
    await expectCode(issueSparePart(operator, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelf.id, qty: "1", idempotencyKey: "w4c-part-1" }), "forbidden");
    await expectCode(issueSparePart(warehouse, { workOrderId: woId, lotId: held.id, fromLocationId: shelf.id, qty: "1", idempotencyKey: "w4c-part-h" }), "blocked_lot");
    await expectCode(issueSparePart(warehouse, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelf.id, qty: "9", idempotencyKey: "w4c-part-9" }), "insufficient_stock");
    const r = await issueSparePart(warehouse, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelf.id, qty: "2", idempotencyKey: "w4c-part-1" });
    const again = await issueSparePart(warehouse, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelf.id, qty: "2", idempotencyKey: "w4c-part-1" });
    expect(again).toMatchObject({ partId: r.partId, replayed: true });
    expect(await onHand(partLot.id, shelf.id)).toBe("3");
    const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.id, r.movementId));
    expect(mv).toMatchObject({ movementType: "issue", sourceDocumentType: "maintenance_work_order", sourceDocumentId: woId });
    expect(await db.select().from(maintenanceWorkOrderParts).where(eq(maintenanceWorkOrderParts.workOrderId, woId))).toHaveLength(1);
    const parts = await listSpareParts(manager);
    expect(parts.find((p) => p.materialId === m.id)).toMatchObject({ onHand: "3", belowMin: false });
  });

  it("completing writes the W1D service record, resets the plan and returns the equipment to service", async () => {
    await expectCode(completeMaintenanceWorkOrder(warehouse, { workOrderId: woId, workDone: "Changed oil", result: "pass" }), "forbidden");
    const r = await completeMaintenanceWorkOrder(operator, { workOrderId: woId, workDone: "Gearbox oil changed, seals replaced", result: "pass", idempotencyKey: "w4c-done-1" });
    expect(r.equipmentStatus).toBe("in_service");
    expect((await completeMaintenanceWorkOrder(operator, { workOrderId: woId, workDone: "Gearbox oil changed, seals replaced", result: "pass", idempotencyKey: "w4c-done-1" })).replayed).toBe(true);
    const [w] = await db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, woId));
    expect(w.status).toBe("completed");
    const [svc] = await db.select().from(equipmentServiceRecords).where(eq(equipmentServiceRecords.id, w.serviceRecordId!));
    expect(svc).toMatchObject({ serviceKind: "preventive_maintenance", result: "pass" });
    const [p] = await db.select().from(maintenancePlans).where(eq(maintenancePlans.equipmentId, eqId["MIX-T1"]));
    expect(p.nextDueOn).toBe(plusDays(manilaToday(), 30));
    const [e] = await db.select().from(equipment).where(eq(equipment.id, eqId["MIX-T1"]));
    expect(e).toMatchObject({ status: "in_service", maintenanceDueDate: plusDays(manilaToday(), 30) });
    const tr = await db.select().from(maintenanceWorkOrderStateTransitions).where(eq(maintenanceWorkOrderStateTransitions.workOrderId, woId));
    expect(tr.map((t) => t.toState)).toEqual(["open", "in_progress", "completed"]);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, woId), eq(auditEvents.action, "maintenance.work_order.completed")))).toHaveLength(1);
    await expectCode(issueSparePart(warehouse, { workOrderId: woId, lotId: partLot.id, fromLocationId: shelfId, qty: "1", idempotencyKey: "w4c-part-late" }), "state");
  });

  it("a reported breakdown takes the equipment out of service at once; a failed repair keeps it there", async () => {
    const e = await freshEquipment("MIX-T2");
    await expectCode(createMaintenanceWorkOrder(warehouse, { equipmentId: e.id, kind: "corrective", title: "Noise" }), "forbidden");
    await expectCode(createMaintenanceWorkOrder(owner, { equipmentId: e.id, kind: "corrective", title: "Noise" }), "forbidden");
    await expectCode(createMaintenanceWorkOrder(managerRvs, { equipmentId: e.id, kind: "corrective", title: "Noise" }), "not_found");
    const r = await createMaintenanceWorkOrder(operator, { equipmentId: e.id, kind: "corrective", title: "Bearing noise, mixer stopped", reportedDown: true, priority: "urgent" });
    expect(r.equipmentStatus).toBe("out_of_service");
    expect((await equipmentAvailability(operator, e.id)).usable).toBe(false);
    await transitionMaintenanceWorkOrder(operator, { workOrderId: r.workOrderId, to: "in_progress" });
    await expectCode(transitionMaintenanceWorkOrder(operator, { workOrderId: r.workOrderId, to: "on_hold" }), "validation");
    await transitionMaintenanceWorkOrder(operator, { workOrderId: r.workOrderId, to: "on_hold", reason: "Waiting for the bearing" });
    await transitionMaintenanceWorkOrder(operator, { workOrderId: r.workOrderId, to: "in_progress" });
    await completeMaintenanceWorkOrder(operator, { workOrderId: r.workOrderId, workDone: "Bearing replaced but noise remains", result: "fail" });
    const [after] = await db.select().from(equipment).where(eq(equipment.id, e.id));
    expect(after.status).toBe("out_of_service");
    const r2 = await createMaintenanceWorkOrder(manager, { equipmentId: e.id, kind: "corrective", title: "Replace gearbox" });
    await transitionMaintenanceWorkOrder(manager, { workOrderId: r2.workOrderId, to: "in_progress" });
    expect((await completeMaintenanceWorkOrder(manager, { workOrderId: r2.workOrderId, workDone: "Gearbox replaced, test run OK", result: "pass" })).equipmentStatus).toBe("in_service");
    // Cancelling needs maintenance.work_order.void (site manager), with a reason.
    const r3 = await createMaintenanceWorkOrder(operator, { equipmentId: e.id, kind: "inspection", title: "Quarterly inspection", takesEquipmentDown: false });
    await expectCode(transitionMaintenanceWorkOrder(operator, { workOrderId: r3.workOrderId, to: "cancelled", reason: "Not needed" }), "forbidden");
    expect((await transitionMaintenanceWorkOrder(manager, { workOrderId: r3.workOrderId, to: "cancelled", reason: "Merged into the gearbox job" })).status).toBe("cancelled");
  });

  it("retiring a plan with an open work order is refused; pausing needs a reason", async () => {
    const [p] = await db.select().from(maintenancePlans).where(eq(maintenancePlans.equipmentId, eqId["MIX-T1"]));
    const w = await createPlanWorkOrder(manager, { planId: p.id });
    await expectCode(changeMaintenancePlanStatus(manager, { planId: p.id, toStatus: "retired", reason: "Equipment sold" }), "state");
    await transitionMaintenanceWorkOrder(manager, { workOrderId: w.workOrderId, to: "cancelled", reason: "Plan to be retired" });
    await expectCode(changeMaintenancePlanStatus(manager, { planId: p.id, toStatus: "paused" }), "validation");
    await changeMaintenancePlanStatus(manager, { planId: p.id, toStatus: "retired", reason: "Equipment sold" });
    const [e] = await db.select().from(equipment).where(eq(equipment.id, eqId["MIX-T1"]));
    expect(e.maintenanceDueDate).toBeNull();
  });
});
