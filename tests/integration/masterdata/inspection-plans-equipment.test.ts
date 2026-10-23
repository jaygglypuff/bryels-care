import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, downtimeEvents, equipment, equipmentServiceRecords, equipmentStateTransitions, products } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import {
  changeEquipmentStatus,
  createEquipment,
  createInspectionPlan,
  createInspectionPlanRevision,
  decideEquipmentOverride,
  decideInspectionPlan,
  deriveAvailability,
  equipmentAvailability,
  getEquipment,
  getInspectionPlan,
  listEquipment,
  recordServiceRecord,
  requestEquipmentOverride,
  reviewServiceRecord,
  saveInspectionPlanDraft,
  submitInspectionPlan,
} from "@/modules/masterdata";
import { expectCode, manilaDate, setupW1D } from "./helpers";

let nfd: SiteRef;
let rvs: SiteRef;
let planner: AuthContext;
let manager: AuthContext;
let managerRvsOnly: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let warehouse: AuthContext;
const eqId: Record<string, string> = {};
const today = manilaDate(0);

beforeAll(async () => {
  const s = await setupW1D();
  nfd = s.nfd;
  rvs = s.rvs;
  planner = await s.ctxFor("planner.nfd@bryels-care.test", "production_planner", [nfd]);
  manager = await s.ctxFor("manager.nfd@bryels-care.test", "site_manager", [nfd]);
  managerRvsOnly = await s.ctxFor("manager.nfd@bryels-care.test", "site_manager", [rvs]);
  qa = await s.ctxFor("qa.nfd@bryels-care.test", "qa_qc", [nfd, rvs]);
  qaLead = await s.ctxFor("qa.lead@bryels-care.test", "qa_qc", [nfd, rvs]);
  operator = await s.ctxFor("operator.nfd@bryels-care.test", "production_operator", [nfd]);
  checker = await s.ctxFor("checker.nfd@bryels-care.test", "production_operator", [nfd]);
  warehouse = await s.ctxFor("warehouse.nfd@bryels-care.test", "warehouse_operator", [nfd]);
  for (const e of await db.select().from(equipment)) eqId[e.code] = e.id;
}, 180_000);

describe("inspection plans (US-3-03)", () => {
  let planId: string;

  it("seeds placeholder plans flagged for QA review and resolves the effective plan", async () => {
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const p = await getInspectionPlan(qa, { planKind: "finished_product", productId: acs.id, date: today });
    expect(p?.plan.code).toBe("IP-ACS-FP");
    expect(p?.plan.isPlaceholder).toBe(true);
    expect(p?.tests.map((t) => t.testCode)).toEqual(["PH", "APPEAR", "NETWT"]);
  });

  it("refuses role escalation", async () => {
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    await expectCode(createInspectionPlan(planner, { code: "IP-AHL-FP", name: "Lotion FP", planKind: "finished_product", productId: ahl.id }), "forbidden");
    await expectCode(createInspectionPlan(manager, { code: "IP-AHL-FP", name: "Lotion FP", planKind: "finished_product", productId: ahl.id }), "forbidden");
  });

  it("validates the subject and numeric specifications", async () => {
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    await expectCode(createInspectionPlan(qa, { code: "IP-AHL-FP", name: "Lotion FP", planKind: "incoming", productId: ahl.id }), "validation");
    ({ planId } = await createInspectionPlan(qa, { code: "IP-AHL-FP", name: "Lotion FP", planKind: "finished_product", productId: ahl.id }));
    const base = { planId, name: "Lotion finished product (test)", isPlaceholder: true };
    await expectCode(saveInspectionPlanDraft(qa, { ...base, tests: [{ testCode: "PH", name: "pH", valueKind: "numeric", specMin: "5" }] }), "validation"); // no unit
    await expectCode(saveInspectionPlanDraft(qa, { ...base, tests: [{ testCode: "PH", name: "pH", valueKind: "numeric", uom: "pH" }] }), "validation"); // no limit
    await expectCode(saveInspectionPlanDraft(qa, { ...base, tests: [{ testCode: "PH", name: "pH", valueKind: "numeric", uom: "pH", specMin: "7", specMax: "5" }] }), "validation");
    await expectCode(saveInspectionPlanDraft(qa, { ...base, tests: [{ testCode: "APP", name: "Appearance", valueKind: "text" }] }), "validation"); // criterion
    await saveInspectionPlanDraft(qa, {
      ...base,
      tests: [
        { testCode: "PH", name: "pH", valueKind: "numeric", uom: "pH", specMin: "5.0", specMax: "7.0" },
        { testCode: "APP", name: "Appearance", valueKind: "text", specText: "PLACEHOLDER (QA to confirm)" },
      ],
    });
  });

  it("needs approval by a second QA user", async () => {
    await submitInspectionPlan(qa, planId);
    await expectCode(decideInspectionPlan(qa, { id: planId, decision: "approved" }), "separation_of_duties");
    await expectCode(decideInspectionPlan(manager, { id: planId, decision: "approved" }), "forbidden");
    const r = await decideInspectionPlan(qaLead, { id: planId, decision: "approved" });
    expect(r.status).toBe("approved");
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    const p = await getInspectionPlan(planner, { planKind: "finished_product", productId: ahl.id, date: today });
    expect(p?.tests).toHaveLength(2);
    await expectCode(saveInspectionPlanDraft(qa, { planId, name: "x", tests: [] }), "state");
    const { revisionNo } = await createInspectionPlanRevision(qa, planId);
    expect(revisionNo).toBe(2);
  });
});

describe("equipment availability (US-3-04)", () => {
  it("derives availability from status, due dates, cleaning and qualification", () => {
    const base = { status: "in_service", calibrationDueDate: "2026-10-30", maintenanceDueDate: null, cleaningStatus: "clean", cleaningRule: "per_batch", qualificationStatus: "not_required", blockingRule: "block" };
    expect(deriveAvailability(base, "2026-10-30").selectable).toBe(true); // usable through the due date
    const overdue = deriveAvailability(base, "2026-10-31");
    expect(overdue.selectable).toBe(false);
    expect(overdue.reasons.map((r) => r.code)).toEqual(["calibration_due"]);
    const warn = deriveAvailability({ ...base, blockingRule: "warn" }, "2026-10-31");
    expect(warn.selectable).toBe(true);
    expect(warn.warnings.map((r) => r.code)).toEqual(["calibration_due"]);
    expect(deriveAvailability({ ...base, blockingRule: "warn", status: "out_of_service" }, "2026-10-01").selectable).toBe(false);
    expect(deriveAvailability({ ...base, cleaningStatus: "dirty" }, "2026-10-01").reasons[0].code).toBe("cleaning_required");
    expect(deriveAvailability({ ...base, cleaningStatus: "dirty", cleaningRule: "none" }, "2026-10-01").available).toBe(true);
    expect(deriveAvailability({ ...base, qualificationStatus: "pending" }, "2026-10-01").reasons[0].code).toBe("qualification_pending");
  });

  it("reports the seeded register: SC-01 usable, SC-02 calibration overdue, MIX-02 out of service", async () => {
    expect((await equipmentAvailability(operator, eqId["SC-01"])).usable).toBe(true);
    const sc2 = await equipmentAvailability(operator, eqId["SC-02"]);
    expect(sc2.usable).toBe(false);
    expect(sc2.blockingReasons.map((r) => r.code)).toEqual(["calibration_due"]);
    const mix2 = await equipmentAvailability(operator, eqId["MIX-02"]);
    expect(mix2.blockingReasons.map((r) => r.code)).toEqual(["out_of_service"]);
    const [open] = await db.select().from(downtimeEvents).where(eq(downtimeEvents.equipmentId, eqId["MIX-02"]));
    expect(open.endedAt).toBeNull();
  });

  it("authz.cross_site: another site's equipment is invisible", async () => {
    await expectCode(equipmentAvailability(managerRvsOnly, eqId["SC-01"]), "not_found");
    expect(await listEquipment(managerRvsOnly)).toHaveLength(0);
    expect(await getEquipment(managerRvsOnly, eqId["SC-01"])).toBeNull();
    await expectCode(recordServiceRecord(managerRvsOnly, { equipmentId: eqId["SC-01"], serviceKind: "cleaning", result: "completed" }), "not_found");
    await expectCode(listEquipment(managerRvsOnly, { siteId: nfd.id }), "not_found");
    await expectCode(createEquipment(managerRvsOnly, { siteId: nfd.id, code: "SC-09", name: "x", equipmentKind: "scale" }), "not_found");
  });

  it("refuses role escalation on the register", async () => {
    await expectCode(recordServiceRecord(warehouse, { equipmentId: eqId["SC-01"], serviceKind: "cleaning", result: "completed" }), "forbidden");
    await expectCode(createEquipment(operator, { siteId: nfd.id, code: "SC-09", name: "x", equipmentKind: "scale" }), "forbidden");
    await expectCode(changeEquipmentStatus(warehouse, { equipmentId: eqId["SC-01"], toStatus: "maintenance", reason: "x" }), "forbidden");
  });

  it("registers equipment with a transition and audit", async () => {
    const { equipmentId } = await createEquipment(manager, { siteId: nfd.id, code: "sc-03", name: "Pocket scale", equipmentKind: "scale", calibrationIntervalDays: 30, capacityMin: "0.1", capacityMax: "500", capacityUom: "g" });
    const [e] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
    expect(e.code).toBe("SC-03");
    const tr = await db.select().from(equipmentStateTransitions).where(eq(equipmentStateTransitions.equipmentId, equipmentId));
    expect(tr.map((t) => t.toState)).toEqual(["in_service"]);
    await expectCode(createEquipment(manager, { siteId: nfd.id, code: "SC-03", name: "dup", equipmentKind: "scale" }), "conflict");
  });
});

describe("controlled override CX-CAL (production.equipment_override_requires_approver)", () => {
  let requestId: string;

  it("cannot be requested for usable equipment", async () => {
    await expectCode(requestEquipmentOverride(operator, { equipmentId: eqId["SC-01"], reason: "Not needed" }), "state");
  });

  it("needs a site manager and a QA co-approval, both other than the requester", async () => {
    ({ requestId } = await requestEquipmentOverride(operator, { equipmentId: eqId["SC-02"], reason: "Risk assessed: verified with check weights 100 g / 1 kg within 0.05 g; only scale for small additives today.", workReference: "B-26-0099", validHours: 4 }));
    await expectCode(requestEquipmentOverride(checker, { equipmentId: eqId["SC-02"], reason: "duplicate" }), "conflict");
    await expectCode(decideEquipmentOverride(operator, { id: requestId, decision: "approved" }), "forbidden");
    await expectCode(decideEquipmentOverride(qa, { id: requestId, decision: "approved" }), "forbidden"); // step 1 is the site manager
    const s1 = await decideEquipmentOverride(manager, { id: requestId, decision: "approved", note: "Accepted for today" });
    expect(s1.status).toBe("pending_approval");
    expect((await equipmentAvailability(operator, eqId["SC-02"])).usable).toBe(false);
    await expectCode(decideEquipmentOverride(manager, { id: requestId, decision: "approved" }), "forbidden"); // step 2 is QA
    const s2 = await decideEquipmentOverride(qa, { id: requestId, decision: "approved", note: "QA co-approval" });
    expect(s2.status).toBe("approved");
    const av = await equipmentAvailability(operator, eqId["SC-02"]);
    expect(av.selectable).toBe(false);
    expect(av.usable).toBe(true);
    expect(av.override?.id).toBe(requestId);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, requestId), eq(auditEvents.action, "production.equipment_use.override_approved")));
    expect(ev).toBeTruthy();
  });

  it("the requester can never approve their own override", async () => {
    const { requestId: own } = await requestEquipmentOverride(manager, { equipmentId: eqId["MIX-02"], reason: "Manager wants to use the backup mixer" });
    await expectCode(decideEquipmentOverride(manager, { id: own, decision: "approved" }), "separation_of_duties");
  });
});

describe("service records and the return to service (W13-05, G-W13-B)", () => {
  it("a passing calibration updates the due date and clears the block; repeats are idempotent", async () => {
    const key = "svc-test-0001";
    const a = await recordServiceRecord(operator, { equipmentId: eqId["SC-02"], serviceKind: "calibration", result: "pass", nextDueDate: manilaDate(90), referenceNumber: "CAL-TEST-1", idempotencyKey: key });
    const b = await recordServiceRecord(operator, { equipmentId: eqId["SC-02"], serviceKind: "calibration", result: "pass", nextDueDate: manilaDate(90), referenceNumber: "CAL-TEST-1", idempotencyKey: key });
    expect(b.recordId).toBe(a.recordId);
    expect(await db.select().from(equipmentServiceRecords).where(eq(equipmentServiceRecords.referenceNumber, "CAL-TEST-1"))).toHaveLength(1);
    const [e] = await db.select().from(equipment).where(eq(equipment.id, eqId["SC-02"]));
    expect(e.calibrationDueDate).toBe(manilaDate(90));
    expect((await equipmentAvailability(operator, eqId["SC-02"])).selectable).toBe(true);
    await expectCode(recordServiceRecord(operator, { equipmentId: eqId["SC-02"], serviceKind: "calibration", result: "completed" }), "validation");
    await expectCode(recordServiceRecord(operator, { equipmentId: eqId["SC-02"], serviceKind: "calibration", result: "pass", nextDueDate: manilaDate(-1) }), "validation");
  });

  it("a failed calibration blocks until a QA review, even after a later pass", async () => {
    const fail = await recordServiceRecord(operator, { equipmentId: eqId["SC-01"], serviceKind: "calibration", result: "fail", notes: "Reads 0.4 % high at 10 kg" });
    expect(fail.status).toBe("out_of_service");
    expect((await equipmentAvailability(checker, eqId["SC-01"])).blockingReasons.map((r) => r.code)).toEqual(["out_of_service"]);
    const pass = await recordServiceRecord(checker, { equipmentId: eqId["SC-01"], serviceKind: "calibration", result: "pass", nextDueDate: manilaDate(90) });
    expect(pass.status).toBe("out_of_service");
    await expectCode(changeEquipmentStatus(manager, { equipmentId: eqId["SC-01"], toStatus: "in_service", reason: "Try" }), "state");
    await expectCode(reviewServiceRecord(operator, { recordId: fail.recordId, note: "x" }), "forbidden");
    await expectCode(reviewServiceRecord(qa, { recordId: fail.recordId, note: "" }), "validation");
    const r = await reviewServiceRecord(qa, { recordId: fail.recordId, note: "Batches since last good calibration assessed: none affected (test)" });
    expect(r.statusChange?.to).toBe("in_service");
    const [d] = await db.select().from(downtimeEvents).where(eq(downtimeEvents.equipmentId, eqId["SC-01"]));
    expect(d.endedAt).not.toBeNull();
  });

  it("status changes follow the state machine and need a reason", async () => {
    await expectCode(changeEquipmentStatus(manager, { equipmentId: eqId["MLD-01"], toStatus: "in_service", reason: "noop" }), "state");
    await expectCode(changeEquipmentStatus(manager, { equipmentId: eqId["MLD-01"], toStatus: "maintenance", reason: "" }), "validation");
    const r = await changeEquipmentStatus(manager, { equipmentId: eqId["MLD-01"], toStatus: "maintenance", reason: "Frame repair" });
    expect(r.to).toBe("maintenance");
    const back = await recordServiceRecord(operator, { equipmentId: eqId["MLD-01"], serviceKind: "repair", result: "completed", notes: "Frame welded" });
    expect(back.status).toBe("in_service");
  });

  it("dirty equipment is blocked until cleaned", async () => {
    await recordServiceRecord(operator, { equipmentId: eqId["MIX-01"], serviceKind: "cleaning", result: "fail", notes: "Residue found" });
    expect((await equipmentAvailability(operator, eqId["MIX-01"])).blockingReasons.map((r) => r.code)).toEqual(["cleaning_required"]);
    await recordServiceRecord(checker, { equipmentId: eqId["MIX-01"], serviceKind: "cleaning", result: "completed" });
    expect((await equipmentAvailability(operator, eqId["MIX-01"])).usable).toBe(true);
  });
});
