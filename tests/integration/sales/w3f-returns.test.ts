import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, containerContents, containers, customerReturnLines, customerReturnStateTransitions, customerReturns, inventoryBalances, inventoryLots, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { decideLot, traceGenealogy } from "@/modules/quality";
import {
  addReturnLine,
  approveCustomerReturn,
  cancelCustomerReturn,
  closeCustomerReturn,
  createCustomerReturn,
  getCustomerReturn,
  listCustomerReturns,
  markReturnInspected,
  postCustomerReturn,
  removeReturnLine,
  sendBackCustomerReturn,
  shipmentReturnState,
  submitCustomerReturn,
} from "@/modules/sales";
import { RETURN_TRANSITIONS, canMoveReturn } from "@/modules/sales/returns-rules";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { salesAndWarehouse, shipToCustomer } from "./w3f-fixtures";

let kit: Kit;
let sales: AuthContext;
let warehouse: AuthContext;
let warehouseRvs: AuthContext;
let manager: AuthContext;
let qa: AuthContext;
let shipped: Awaited<ReturnType<typeof shipToCustomer>>;
let retLocId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  ({ sales, warehouse } = await salesAndWarehouse(kit));
  warehouseRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  shipped = await shipToCustomer(sales, warehouse, "CUS-002", [{ sku: "ACS-135", qty: "24" }]);
  retLocId = (await loc(kit.nfd.id, "RET-01")).id;
});

const lineCount = async (returnId: string) => (await db.select().from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, returnId))).length;

describe("US-4-16 customer returns received by scan into quarantine", () => {
  it("statemachine.customer_return: transition table", () => {
    expect(RETURN_TRANSITIONS.draft).toContain("submitted");
    expect(canMoveReturn("draft", "received")).toBe(false);
    expect(canMoveReturn("received", "cancelled")).toBe(false);
    expect(canMoveReturn("approved", "received")).toBe(true);
  });

  it("creates a draft against a shipment (RT number) and scans a lot line, refusing more than was shipped (V-OVER)", async () => {
    const r = await createCustomerReturn(warehouse, { shipmentId: shipped.shipment.id, reasonCode: "damaged_in_transit", idempotencyKey: "w3f-rt-1" });
    expect(r.returnNumber).toMatch(/^RT-\d{2}-\d{4}$/);
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.id, r.returnId));
    expect(ret.status).toBe("draft");
    expect(ret.customerId).toBe(shipped.customer.id);
    expect(ret.toLocationId).toBe(retLocId); // the site's customer-returns quarantine location
    const lot = shipped.lots[0];
    await expectCode(addReturnLine(warehouse, { returnId: r.returnId, code: `BC:LOT:${lot.lotNumber}`, qty: "25", condition: "damaged" }), "validation");
    await expectCode(addReturnLine(warehouse, { returnId: r.returnId, code: `BC:LOT:${lot.lotNumber}`, qty: "1.5", condition: "damaged" }), "validation");
    const l = await addReturnLine(warehouse, { returnId: r.returnId, code: `BC:LOT:${lot.lotNumber}`, qty: "6", condition: "damaged" });
    expect(l.lotNumber).toBe(lot.lotNumber);
    // A lot that was not on this shipment.
    const [other] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.nfd.id), eq(inventoryLots.itemKind, "material"))).limit(1);
    await expectCode(addReturnLine(warehouse, { returnId: r.returnId, code: other.lotNumber, qty: "1", condition: "unknown" }), "validation");
    expect(await lineCount(r.returnId)).toBe(1);
  });

  it("scans a box once (V-DUP) and resolves it to the shipped lot", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    const lot = shipped.lots[0];
    const [box] = await db.insert(containers).values({ organizationId: kit.orgId, siteId: kit.nfd.id, containerNumber: "BX-W3F-RT-1", status: "shipped", createdBy: warehouse.userId }).returning();
    await db.insert(containerContents).values({ organizationId: kit.orgId, siteId: kit.nfd.id, containerId: box.id, lotId: lot.lotId, qtyBase: "0", baseUom: "pcs" });
    const l = await addReturnLine(warehouse, { returnId: ret.id, code: "BC:BOX:BX-W3F-RT-1", qty: "4", condition: "sellable" });
    expect(l.lotNumber).toBe(lot.lotNumber);
    await expectCode(addReturnLine(warehouse, { returnId: ret.id, code: "BC:BOX:BX-W3F-RT-1", qty: "1", condition: "sellable" }), "conflict");
    await removeReturnLine(warehouse, { returnId: ret.id, lineId: l.lineId });
    expect(await lineCount(ret.id)).toBe(1);
  });

  it("stock.blocked.location_class: a storage location is refused as the return destination", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    const fg = await loc(kit.nfd.id, "FG-01");
    const e = await expectCode(addReturnLine(warehouse, { returnId: ret.id, code: shipped.lots[0].lotNumber, qty: "1", condition: "sellable", toLocationId: fg.id }), "blocked_lot");
    expect(e.details?.rule).toBe("V-LOC");
    await expectCode(createCustomerReturn(warehouse, { shipmentId: shipped.shipment.id, reasonCode: "damaged_in_transit", toLocationId: fg.id }), "blocked_lot");
  });

  it("authz.cross_site.customer_return: an RVS warehouse user cannot see or use the NFD shipment and return", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    await expectCode(createCustomerReturn(warehouseRvs, { shipmentId: shipped.shipment.id, reasonCode: "damaged_in_transit" }), "not_found");
    await expectCode(getCustomerReturn(warehouseRvs, ret.id), "not_found");
    await expectCode(addReturnLine(warehouseRvs, { returnId: ret.id, code: shipped.lots[0].lotNumber, qty: "1", condition: "unknown" }), "not_found");
    expect((await listCustomerReturns(warehouseRvs, {})).find((x) => x.id === ret.id)).toBeUndefined();
  });

  it("authz.role_escalation + SoD: the submitter cannot approve; warehouse and sales cannot approve or post", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    await submitCustomerReturn(warehouse, { returnId: ret.id });
    await expectCode(approveCustomerReturn(warehouse, { returnId: ret.id }), "forbidden");
    await expectCode(approveCustomerReturn(sales, { returnId: ret.id }), "forbidden");
    await expectCode(postCustomerReturn(warehouse, { returnId: ret.id, idempotencyKey: "x" }), "forbidden");
    // A manager who also submitted cannot approve their own (SoD by user id).
    const r2 = await createCustomerReturn(warehouse, { shipmentId: shipped.shipment.id, reasonCode: "customer_refused" });
    await addReturnLine(warehouse, { returnId: r2.returnId, code: shipped.lots[0].lotNumber, qty: "1", condition: "unknown" });
    const managerAsSubmitter = await asUser(kit, "manager.nfd@bryels-care.test", ["site_manager", "warehouse_operator"], [kit.nfd]);
    await submitCustomerReturn(managerAsSubmitter, { returnId: r2.returnId });
    await expectCode(approveCustomerReturn(managerAsSubmitter, { returnId: r2.returnId }), "separation_of_duties");
    await sendBackCustomerReturn(qa, { returnId: r2.returnId, reason: "Check the quantity with the driver." });
    await cancelCustomerReturn(warehouse, { returnId: r2.returnId, reason: "Customer kept the goods." });
    const [c2] = await db.select().from(customerReturns).where(eq(customerReturns.id, r2.returnId));
    expect(c2.status).toBe("cancelled");
    // Posting before approval is a state error.
    await expectCode(postCustomerReturn(manager, { returnId: ret.id, idempotencyKey: "w3f-post-early" }), "state");
  });

  it("posts approved lines: a new quarantine lot per line, a `return` movement into RET-01, shipment returned (partial)", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    await approveCustomerReturn(manager, { returnId: ret.id, note: "Driver confirmed six damaged bars." });
    const before = await shipmentReturnState(db, shipped.shipment.id);
    expect(before.state).toBe("not_returned");
    // Two concurrent posts with the same key: one posting.
    const [a, b] = await Promise.all([postCustomerReturn(manager, { returnId: ret.id, idempotencyKey: "w3f-post-1" }), postCustomerReturn(manager, { returnId: ret.id, idempotencyKey: "w3f-post-1" })]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const lines = await db.select().from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, ret.id));
    expect(lines).toHaveLength(1);
    const [rl] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lines[0].returnLotId!));
    expect(rl.qualityStatus).toBe("quarantine");
    expect(rl.originLotId).toBe(shipped.lots[0].lotId);
    expect(rl.productId).toBe(shipped.lots[0].productId);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentType, "customer_return"), eq(stockMovements.sourceDocumentId, ret.id)));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("return");
    expect(mv[0].toLocationId).toBe(retLocId);
    expect(Number(mv[0].qtyBase)).toBe(6);
    const [bal] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, rl.id), eq(inventoryBalances.locationId, retLocId)));
    expect(Number(bal.qtyBase)).toBe(6);
    const [after] = await db.select().from(customerReturns).where(eq(customerReturns.id, ret.id));
    expect(after.status).toBe("received");
    expect(after.receivedBy).toBe(manager.userId);
    const st = await shipmentReturnState(db, shipped.shipment.id);
    expect(st.state).toBe("partially_returned");
    const evs = await db.select().from(auditEvents).where(eq(auditEvents.entityId, ret.id));
    expect(evs.map((e) => e.action)).toEqual(expect.arrayContaining(["sales.customer_return.created", "sales.customer_return.submitted", "sales.customer_return.approved", "sales.customer_return.posted"]));
    const shipEv = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, shipped.shipment.id), eq(auditEvents.action, "sales.shipment.returned")));
    expect(shipEv).toHaveLength(1);
    expect((shipEv[0].after as { partial: boolean }).partial).toBe(true);
    const tr = await db.select().from(customerReturnStateTransitions).where(eq(customerReturnStateTransitions.customerReturnId, ret.id)).orderBy(customerReturnStateTransitions.occurredAt);
    expect(tr.map((t) => t.toState)).toEqual(["draft", "submitted", "approved", "received"]);
    // The W2C genealogy follows the `returned` re-lot edge both ways.
    const back = await traceGenealogy(qa, { lotNumber: rl.lotNumber });
    expect(back.reverse[0]?.number).toBe(shipped.lots[0].lotNumber);
    const fwd = await traceGenealogy(qa, { lotNumber: shipped.lots[0].lotNumber });
    const relot = fwd.forward.find((n) => n.id === rl.id);
    expect(relot?.qtyRole).toBe("relotted");
    expect(Number(relot?.qty)).toBe(6);
  });

  it("QA dispositions the returned lot through the normal lot decision; then inspected → closed", async () => {
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.idempotencyKey, "w3f-rt-1"));
    await expectCode(markReturnInspected(qa, { returnId: ret.id }), "state"); // return lot still in quarantine
    const [line] = await db.select().from(customerReturnLines).where(eq(customerReturnLines.customerReturnId, ret.id));
    // Only qa_qc decides returned stock (the site manager who posted it holds no disposition right).
    await expectCode(decideLot(manager, { lotId: line.returnLotId!, decision: "release", reason: "Looks fine to me" }), "forbidden");
    await decideLot(qa, { lotId: line.returnLotId!, decision: "reject", reason: "Crushed bars, not resaleable." });
    await markReturnInspected(qa, { returnId: ret.id });
    await closeCustomerReturn(qa, { returnId: ret.id });
    const v = await getCustomerReturn(sales, ret.id);
    expect(v.header.status).toBe("closed");
    expect(v.lines[0].returnLotStatus).toBe("rejected");
    expect(v.lines[0].disposition?.decision).toBe("reject");
  });

  it("concurrency: two returns racing for the remaining shipped quantity never exceed it", async () => {
    const r1 = await createCustomerReturn(warehouse, { shipmentId: shipped.shipment.id, reasonCode: "customer_refused" });
    const r2 = await createCustomerReturn(warehouse, { shipmentId: shipped.shipment.id, reasonCode: "customer_refused" });
    const lot = shipped.lots[0].lotNumber;
    // 24 shipped, 6 already returned: 18 left; each asks for 10.
    const res = await Promise.allSettled([addReturnLine(warehouse, { returnId: r1.returnId, code: lot, qty: "10", condition: "unknown" }), addReturnLine(warehouse, { returnId: r2.returnId, code: lot, qty: "10", condition: "unknown" })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((x) => x.status === "rejected")).toHaveLength(1);
  });
});
