/**
 * ADR-110 C5 (end-to-end walk P9): equipment that blocks weighing says why in plain words and offers the fix on the
 * floor ("Record cleaning", the same service and audit as the equipment page); calibration overdue names who fixes
 * it. Cross-site and role negatives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, equipment, equipmentServiceRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { recordServiceRecord } from "@/modules/masterdata";
import { equipmentOptions } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";

let kit: Kit;
let operator: AuthContext;
let operatorRvs: AuthContext;
let qa: AuthContext;
let sc01: typeof equipment.$inferSelect;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  // After a batch: SC-01 dirty (cleaning after every batch); SC-02 calibration overdue since 1 Nov.
  await db.update(equipment).set({ cleaningStatus: "dirty" }).where(and(eq(equipment.siteId, kit.nfd.id), eq(equipment.code, "SC-01")));
  await db.update(equipment).set({ calibrationDueDate: "2026-11-01" }).where(and(eq(equipment.siteId, kit.nfd.id), eq(equipment.code, "SC-02")));
  [sc01] = await db.select().from(equipment).where(and(eq(equipment.siteId, kit.nfd.id), eq(equipment.code, "SC-01")));
}, 180_000);

describe("C5 blocked equipment says why and offers the fix", () => {
  it("each blocked scale says why in plain words; cleaning is offered to the operator, calibration names who fixes it", async () => {
    const opts = await equipmentOptions(operator, kit.nfd.id, "scale");
    const a = opts.find((o) => o.code === "SC-01")!;
    const b = opts.find((o) => o.code === "SC-02")!;
    expect(a.usable).toBe(false);
    expect(a.why).toEqual(["SC-01 needs cleaning after the last batch"]);
    expect(a.canRecordCleaning).toBe(true);
    expect(b.usable).toBe(false);
    expect(b.why[0]).toMatch(/^SC-02 calibration is overdue since 1 Nov/);
    expect(b.canRecordCleaning).toBe(false);
    expect(b.fixHelp[0]).toMatch(/Maintenance or the site manager fixes it/);
  });

  it("a person without the equipment right is not offered Record cleaning and cannot record it", async () => {
    const opts = await equipmentOptions(qa, kit.nfd.id, "scale");
    if (opts.length) expect(opts.find((o) => o.code === "SC-01")!.canRecordCleaning).toBe(false);
    await expectCode(recordServiceRecord(qa, { equipmentId: sc01.id, serviceKind: "cleaning", result: "pass" }), "forbidden");
  });

  it("another site cannot see or clean it", async () => {
    await expect(equipmentOptions(operatorRvs, kit.nfd.id, "scale")).rejects.toMatchObject({ code: "not_found" });
    await expectCode(recordServiceRecord(operatorRvs, { equipmentId: sc01.id, serviceKind: "cleaning", result: "pass" }), "not_found");
  });

  it("Record cleaning on the floor uses the equipment service: a service record, the audit event, and the scale is usable again", async () => {
    await recordServiceRecord(operator, { equipmentId: sc01.id, serviceKind: "cleaning", result: "pass", notes: "Cleaning recorded on the floor (weighing or step screen)", idempotencyKey: "c5-clean-0001" });
    const recs = await db.select().from(equipmentServiceRecords).where(eq(equipmentServiceRecords.equipmentId, sc01.id));
    expect(recs.some((r) => r.serviceKind === "cleaning" && r.performedBy === operator.userId)).toBe(true);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, sc01.id), eq(auditEvents.action, "masterdata.equipment.serviced")))).toHaveLength(1);
    const a = (await equipmentOptions(operator, kit.nfd.id, "scale")).find((o) => o.code === "SC-01")!;
    expect(a.usable).toBe(true);
    expect(a.why).toEqual([]);
  });
});
