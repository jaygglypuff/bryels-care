import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  batchStateTransitions,
  batches,
  dispositions,
  inventoryBalances,
  inventoryLots,
  locations,
  organizations,
  sites,
  stockMovements,
  users,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { decideBatch, decideLot, getBatchRelease, getLotDisposition, getQaQueue } from "@/modules/quality/dispositions";
import { recordTestResult } from "@/modules/quality/tests";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let qa: AuthContext;
let qaLead: AuthContext;
let qaRvsOnly: AuthContext;
let warehouseWithApprove: AuthContext;
let operatorWithApprove: AuthContext;
let warehouse: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function lot(lotNumber: string) {
  const [l] = await db.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, lotNumber));
  return l;
}
async function loc(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l;
}
async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return b?.qtyBase ?? "0";
}
async function batchByNumber(n: string) {
  const [b] = await db.select().from(batches).where(eq(batches.batchNumber, n));
  return b;
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  const qaPerms = ROLE_BUNDLES.qa_qc.permissions;
  qa = await ctxFor("qa.nfd@bryels-care.test", qaPerms, [nfd, rvs]);
  qaRvsOnly = await ctxFor("qa.nfd@bryels-care.test", qaPerms, [rvs]);
  qaLead = await ctxFor("qa.lead@bryels-care.test", qaPerms, [nfd, rvs]);
  // Deliberately over-privileged contexts so the separation-of-duties rule is what blocks them.
  warehouseWithApprove = await ctxFor("warehouse.nfd@bryels-care.test", qaPerms, [nfd]);
  operatorWithApprove = await ctxFor("operator.nfd@bryels-care.test", qaPerms, [nfd]);
  warehouse = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
});

describe("lot disposition", () => {
  it("lists quarantined material lots, held lots and batches awaiting QC in the queue", async () => {
    const q = await getQaQueue(qa);
    const lotNumbers = q.lots.map((l) => l.lotNumber);
    expect(lotNumbers).toEqual(expect.arrayContaining(["L-2610-00013", "L-2610-00014", "L-2610-00011"]));
    expect(lotNumbers).not.toContain("L-2610-00017"); // finished lot is decided via its batch
    expect(q.batches.map((b) => b.batchNumber)).toContain("B-26-0003");
    expect(q.batches.find((b) => b.batchNumber === "B-26-0003")!.testCount).toBe(1);
  });

  it("refuses a user without quality.disposition.approve", async () => {
    const l = await lot("L-2610-00013");
    await expect(decideLot(warehouse, { lotId: l.id, decision: "release", reason: "Looks fine to me" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getLotDisposition(warehouse, l.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("fails closed for a lot outside the user's sites", async () => {
    const l = await lot("L-2610-00013");
    await expect(decideLot(qaRvsOnly, { lotId: l.id, decision: "release", reason: "CoA reviewed, conforms" })).rejects.toMatchObject({ code: "not_found" });
    await expect(getLotDisposition(qaRvsOnly, l.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("blocks the receiver from releasing the lot they received (separation of duties)", async () => {
    const l = await lot("L-2610-00013");
    await expect(decideLot(warehouseWithApprove, { lotId: l.id, decision: "release", reason: "CoA reviewed, conforms" })).rejects.toMatchObject({
      code: "separation_of_duties",
    });
    expect((await lot("L-2610-00013")).qualityStatus).toBe("quarantine");
  });

  it("requires a reason of at least 5 characters", async () => {
    const l = await lot("L-2610-00013");
    await expect(decideLot(qa, { lotId: l.id, decision: "release", reason: " ok " })).rejects.toMatchObject({ code: "validation" });
  });

  it("releases a quarantined lot exactly once under concurrent submissions", async () => {
    const l = await lot("L-2610-00013");
    const results = await Promise.allSettled([
      decideLot(qa, { lotId: l.id, decision: "release", reason: "CoA reviewed, appearance conforms" }),
      decideLot(qa, { lotId: l.id, decision: "release", reason: "CoA reviewed, appearance conforms" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "state" });
    expect((await lot("L-2610-00013")).qualityStatus).toBe("released");
    const rows = await db.select().from(dispositions).where(and(eq(dispositions.subjectType, "lot"), eq(dispositions.subjectId, l.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "release", fromStatus: "quarantine", toStatus: "released", decidedBy: qa.userId });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, l.id), eq(auditEvents.action, "quality.disposition.released")));
    expect(ev).toHaveLength(1);
    expect(ev[0].reason).toBe("CoA reviewed, appearance conforms");
  });

  it("never releases an expired lot, but can reject it into the rejected location", async () => {
    const l = await lot("L-2610-00008");
    await expect(decideLot(qa, { lotId: l.id, decision: "release", reason: "Trying to release" })).rejects.toMatchObject({ code: "blocked_lot" });
    const b01 = await loc(nfd.id, "B-01");
    const rej = await loc(nfd.id, "REJ");
    const before = await onHand(l.id, b01.id);
    expect(Number(before)).toBeGreaterThan(0);
    await decideLot(qa, { lotId: l.id, decision: "reject", reason: "Expired before use; destroy" });
    expect((await lot("L-2610-00008")).qualityStatus).toBe("rejected");
    expect(await onHand(l.id, b01.id)).toBe("0.000000");
    expect(await onHand(l.id, rej.id)).toBe(before);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, l.id), eq(stockMovements.toLocationId, rej.id)));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("transfer");
  });

  it("blocks release of a quarantined lot whose expiry date has passed", async () => {
    const l = await lot("L-2610-00014");
    await db.update(inventoryLots).set({ expiresOn: "2026-01-01" }).where(eq(inventoryLots.id, l.id));
    await expect(decideLot(qa, { lotId: l.id, decision: "release", reason: "CoA reviewed, conforms" })).rejects.toMatchObject({ code: "blocked_lot" });
    await db.update(inventoryLots).set({ expiresOn: l.expiresOn }).where(eq(inventoryLots.id, l.id));
  });

  it("places a released lot on hold and releases it from hold", async () => {
    const l = await lot("L-2610-00009");
    await decideLot(qa, { lotId: l.id, decision: "hold", reason: "Supplier complaint under review" });
    expect((await lot("L-2610-00009")).qualityStatus).toBe("on_hold");
    await expect(decideLot(qa, { lotId: l.id, decision: "release", reason: "Release attempt" })).rejects.toMatchObject({ code: "state" });
    await decideLot(qa, { lotId: l.id, decision: "release_from_hold", reason: "Supplier confirmed lot is fine" });
    expect((await lot("L-2610-00009")).qualityStatus).toBe("released");
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.entityId, l.id));
    expect(ev.map((e) => e.action)).toEqual(expect.arrayContaining(["quality.disposition.held", "quality.disposition.released"]));
    // The QA queue lists recent decisions name first (ADR-088): the material's name, the lot number second.
    const recent = (await getQaQueue(qa)).decisions.find((d) => d.subjectId === l.id);
    expect(recent?.subjectNumber).toBe("L-2610-00009");
    expect(recent?.subjectName).toBeTruthy();
    expect(recent?.subjectName).not.toBe("L-2610-00009");
  });

  it("does not decide a finished-goods lot whose batch is still awaiting QC", async () => {
    const l = await lot("L-2610-00017");
    await expect(decideLot(qa, { lotId: l.id, decision: "release", reason: "Lot-level release attempt" })).rejects.toMatchObject({ code: "state" });
  });
});

describe("test results and batch release", () => {
  it("refuses test entry without quality.test_result.create", async () => {
    const b = await batchByNumber("B-26-0003");
    await expect(recordTestResult(warehouse, { batchId: b.id, testName: "pH", specification: "9-10.5", result: "9.9", passed: true })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(recordTestResult(qaRvsOnly, { batchId: b.id, testName: "pH", specification: "9-10.5", result: "9.9", passed: true })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("blocks the batch operator from releasing it (separation of duties)", async () => {
    const b = await batchByNumber("B-26-0003");
    await expect(decideBatch(operatorWithApprove, { batchId: b.id, decision: "release", reason: "All good, ship it" })).rejects.toMatchObject({
      code: "separation_of_duties",
    });
  });

  it("records tests and releases the batch, moving the output lot to finished goods", async () => {
    const b = await batchByNumber("B-26-0003");
    await recordTestResult(qa, { batchId: b.id, testName: "Appearance", specification: "Smooth green bar, no cracks", result: "Conforms", passed: true });
    await recordTestResult(qa, { batchId: b.id, testName: "Net weight (n=10)", specification: "≥ 135 g each", result: "135.9 g avg", passed: true });
    // W2C (US-3-15, sod.disposition.decider_not_result_entry): the user who entered results cannot release.
    const own = await getBatchRelease(qa, b.id);
    expect(own.blockers.map((x) => x.code)).toEqual(["separation_of_duties"]);
    await expect(decideBatch(qa, { batchId: b.id, decision: "release", reason: "All tests within specification" })).rejects.toMatchObject({ code: "separation_of_duties" });
    const view = await getBatchRelease(qaLead, b.id);
    expect(view.tests).toHaveLength(3);
    expect(view.blockers).toEqual([]);

    const qua = await loc(nfd.id, "QUA-01");
    const fg = await loc(nfd.id, "FG-01");
    const outLot = await lot("L-2610-00017");
    const qty = await onHand(outLot.id, qua.id);
    await decideBatch(qaLead, { batchId: b.id, decision: "release", reason: "All tests within specification; BMR reviewed" });

    expect((await batchByNumber("B-26-0003")).status).toBe("released");
    expect((await lot("L-2610-00017")).qualityStatus).toBe("released");
    expect(await onHand(outLot.id, qua.id)).toBe("0.000000");
    expect(await onHand(outLot.id, fg.id)).toBe(qty);
    const tr = await db.select().from(batchStateTransitions).where(and(eq(batchStateTransitions.batchId, b.id), eq(batchStateTransitions.toState, "released")));
    expect(tr).toHaveLength(1);
    expect(tr[0].fromState).toBe("awaiting_qc");
    const disp = await db.select().from(dispositions).where(eq(dispositions.decidedBy, qaLead.userId));
    expect(disp.filter((d) => d.subjectId === b.id && d.subjectType === "batch")).toHaveLength(1);
    expect(disp.filter((d) => d.subjectId === outLot.id && d.subjectType === "lot" && d.toStatus === "released")).toHaveLength(1);

    await expect(decideBatch(qaLead, { batchId: b.id, decision: "release", reason: "Second attempt" })).rejects.toMatchObject({ code: "state" });
  });

  it("does not release a batch with a failed test", async () => {
    const b = await batchByNumber("B-26-0004");
    await recordTestResult(qa, { batchId: b.id, testName: "pH", specification: "9.0 – 10.5", result: "11.2", passed: false });
    const view = await getBatchRelease(qa, b.id);
    expect(view.blockers.map((x) => x.message).join(" ")).toMatch(/Failed test/);
    await expect(decideBatch(qa, { batchId: b.id, decision: "release", reason: "Release attempt" })).rejects.toMatchObject({ code: "state" });
  });
});
