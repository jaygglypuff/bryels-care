/**
 * US-4-06 order status board and customer 360 (W3D): columns equal the order states, cards move
 * only where permitted (server-checked), the customer page masks money by role, plug-in sections.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { customers } from "@/db/schema";
import { BOARD_COLUMNS, ORDER_STATUSES, createOrder, getCustomer360, moveOrderCard, orderBoard, registerCustomer360Section } from "@/modules/sales";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";

let w: W3d;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
});

describe("US-4-06 order board", () => {
  it("has one column per resting order state (submitted passes through) and shows the site's orders", async () => {
    expect(BOARD_COLUMNS.map((c) => c.key)).toEqual(ORDER_STATUSES.filter((s) => s !== "submitted"));
    const board = await orderBoard(w.sales);
    const all = board.columns.flatMap((c) => c.cards);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => board.columns.find((col) => col.key === c.status))).toBe(true);
    // Late flag (owner usability fix): only open orders past their requested date count days late.
    expect(all.every((c) => (c.daysLate > 0) === c.overdue)).toBe(true);
  });

  it("cards drag only where permitted, and the server re-checks the move", async () => {
    const c = await newCustomer(w, { creditLimit: "1000000" });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(5), lines: [{ productId: await productId("ACS-135"), qtyUnits: "12", unitPrice: "70" }] });
    const card = (await orderBoard(w.warehouse)).columns.find((x) => x.key === "draft")!.cards.find((x) => x.id === o.id)!;
    expect(card.moves.confirmed.allowed).toBe(false);
    expect(card.value).toBeUndefined(); // warehouse sees no money
    await expectCode(moveOrderCard(w.warehouse, { orderId: o.id, toColumn: "confirmed" }), "forbidden");
    const mine = (await orderBoard(w.sales)).columns.find((x) => x.key === "draft")!.cards.find((x) => x.id === o.id)!;
    expect(mine.moves.confirmed).toMatchObject({ allowed: true });
    expect(mine.moves.cancelled.allowed).toBe(false);
    expect(mine.value).toBe("840.00");
    const r = await moveOrderCard(w.sales, { orderId: o.id, toColumn: "confirmed" });
    expect(r.ok).toBe(true);
    const after = (await orderBoard(w.sales)).columns.find((x) => x.key === "confirmed")!.cards.some((x) => x.id === o.id);
    expect(after).toBe(true);
    await expectCode(moveOrderCard(w.sales, { orderId: o.id, toColumn: "shipped" }), "state");
    await expectCode(moveOrderCard(w.warehouseRvs, { orderId: o.id, toColumn: "allocated" }), "not_found");
  });
});

describe("US-4-06 customer 360", () => {
  it("shows orders, quotes, requirements, shipments and history with money masked by role; plug-in sections need their permission", async () => {
    const [luntian] = (await db.select().from(customers)).filter((c) => c.code === "CUS-001");
    registerCustomer360Section({ key: "test_complaints", title: "Complaints", permission: "quality.deviation.view", load: async () => [{ id: "x", label: "Fictional complaint" }] });
    const asSales = await getCustomer360(w.sales, luntian.id);
    expect(asSales.orders.length).toBeGreaterThan(0);
    expect(asSales.orders[0].value).toBeDefined();
    expect(asSales.shipments.length).toBeGreaterThan(0);
    expect(asSales.history.length).toBeGreaterThan(0);
    const asWarehouse = await getCustomer360(w.warehouse, luntian.id);
    expect(asWarehouse.orders.every((o) => o.value === undefined)).toBe(true);
    expect(asWarehouse.priceLists).toEqual([]);
    expect(asWarehouse.quotes).toEqual([]);
    expect(asWarehouse.credit).toBeNull();
    // warehouse holds quality.deviation.view (W2C) and so sees the plug-in section; sales_cs does not
    expect(ROLE_BUNDLES.warehouse_operator.permissions).toContain("quality.deviation.view");
    expect(asWarehouse.sections.map((s) => s.key)).toContain("test_complaints");
    expect(asSales.sections.map((s) => s.key)).not.toContain("test_complaints");
    await expectCode(getCustomer360(w.qa, "00000000-0000-0000-0000-000000000000"), "not_found");
  });
});

describe("W3D role bundles (docs/permissions-matrix.md §3.8, §3.10)", () => {
  it("sales_cs cannot approve orders; system administrators and site managers never see prices or credit terms", () => {
    expect(ROLE_BUNDLES.sales_cs.permissions).not.toContain("sales.sales_order.approve");
    expect(ROLE_BUNDLES.sales_cs.permissions).toContain("sales.sales_order.submit");
    for (const r of ["system_admin", "site_manager", "qa_qc", "warehouse_operator", "production_operator", "production_planner"]) {
      expect(ROLE_BUNDLES[r].permissions, r).not.toContain("sales.price_list.view");
      expect(ROLE_BUNDLES[r].permissions, r).not.toContain("finance.credit_terms.view");
    }
    expect(ROLE_BUNDLES.finance.permissions).toEqual(expect.arrayContaining(["sales.sales_order.approve", "sales.price_list.approve", "finance.credit_terms.approve"]));
    expect(ROLE_BUNDLES.finance.permissions).not.toContain("sales.price_list.edit");
    expect(ROLE_BUNDLES.owner_director.permissions).not.toContain("sales.sales_order.submit");
  });
});
