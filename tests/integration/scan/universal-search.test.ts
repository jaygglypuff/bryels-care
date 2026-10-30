/**
 * Universal search behind "Scan or search" (owner review 2026-10-30, extends ADR-085): typed words return
 * groups — materials and products, lots, batches, customer orders, purchase orders, customers, suppliers —
 * at most 5 each, every word must match. Each group is permission- and site-scoped in the service:
 * role negatives (a warehouse user without sales.sales_order.view sees no customer orders) and cross-site
 * negatives (an RVS-only user never sees NFD orders, batches or lots).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, inventoryLots, purchaseOrders, salesOrders, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { GROUP_LIMIT, resolveScanCard, searchEverything, type SearchGroup } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let whNoSales: AuthContext;
let prodOp: AuthContext;
let salesRvs: AuthContext;
let finance: AuthContext;

async function withPerms(email: string, perms: readonly string[], sites: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, kit.orgId, u.displayName, u.email, ["custom"], new Set(perms), sites, sites[0].id);
}

const groupsOf = async (ctx: AuthContext, text: string): Promise<SearchGroup[]> => {
  const c = await resolveScanCard(ctx, text);
  return c.outcome === "not_found" ? (c.groups ?? []) : [];
};
const keys = (g: SearchGroup[]) => g.map((x) => x.key);
const hrefs = (g: SearchGroup[], key: string) => g.find((x) => x.key === key)?.hits.map((h) => h.href) ?? [];
const idOf = (href: string) => href.split("?")[0].split("/").pop()!;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  // The task's example: a warehouse user whose role lacks sales.sales_order.view.
  whNoSales = await withPerms("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions.filter((p) => p !== "sales.sales_order.view"), [kit.nfd]);
  prodOp = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]).catch(() => withPerms("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [kit.nfd]));
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
}, 240_000);

describe("universal search", () => {
  it("a product word groups materials/products, lots and batches; plain lines with links; at most 5 per group", async () => {
    const g = await groupsOf(owner, "acapulco");
    expect(keys(g)).toEqual(expect.arrayContaining(["items", "lots", "batches"]));
    for (const grp of g) {
      expect(grp.hits.length).toBeGreaterThan(0);
      expect(grp.hits.length).toBeLessThanOrEqual(GROUP_LIMIT);
      for (const h of grp.hits) {
        expect(h.title).toBeTruthy();
        expect(h.href).toMatch(/^\//);
      }
    }
    const items = g.find((x) => x.key === "items")!;
    expect(items.hits.every((h) => /acapulco/i.test(h.title))).toBe(true);
    expect(items.hits[0].title).not.toMatch(/^(MAT|PKG|ACS)-/); // the name comes first, not the code
    expect(items.hits.some((h) => /OK to use at NFD|none in stock at NFD/.test(h.detail))).toBe(true);
    expect(hrefs(g, "batches").every((h) => /^\/production\/[0-9a-f-]{36}$/.test(h))).toBe(true);
    // 11 seeded customer orders start with SO-26: the group stops at 5.
    expect(hrefs(await searchEverything(owner, "so-26"), "sales_orders")).toHaveLength(GROUP_LIMIT);
  });

  it("customer name finds the customer and their orders; supplier name finds the supplier and purchase orders", async () => {
    const c = await groupsOf(owner, "Luntian");
    expect(keys(c)).toEqual(expect.arrayContaining(["customers", "sales_orders"]));
    expect(hrefs(c, "sales_orders").every((h) => /^\/sales\/[0-9a-f-]{36}$/.test(h))).toBe(true);
    expect(hrefs(c, "customers").every((h) => /^\/sales\/customers\/[0-9a-f-]{36}$/.test(h))).toBe(true);
    const s = await groupsOf(owner, "cebu chemicals");
    expect(keys(s)).toEqual(expect.arrayContaining(["suppliers", "purchase_orders"]));
    expect(hrefs(s, "purchase_orders").every((h) => /^\/procurement\/orders\/[0-9a-f-]{36}$/.test(h))).toBe(true);
  });

  it("every word must match (AND); nothing found says so plainly", async () => {
    const c = await resolveScanCard(owner, "luntian zzzz");
    expect(c.outcome).toBe("not_found");
    expect(c.outcome === "not_found" && c.groups).toBeFalsy();
    expect(c.outcome === "not_found" && c.message).toMatch(/Nothing matches/);
  });

  it("role negative: a warehouse user without sales.sales_order.view sees no customer orders (but still customers)", async () => {
    expect(whNoSales.can("sales.sales_order.view")).toBe(false);
    const g = await groupsOf(whNoSales, "luntian");
    expect(keys(g)).not.toContain("sales_orders");
    expect(keys(g)).toContain("customers");
    // The service itself refuses, not only the card.
    expect(keys(await searchEverything(whNoSales, "luntian"))).not.toContain("sales_orders");
  });

  it("role negative: a production operator sees no customers, suppliers, customer or purchase orders", async () => {
    for (const p of ["sales.sales_order.view", "procurement.purchase_order.view", "masterdata.customer.view", "masterdata.supplier.view"]) expect(prodOp.can(p as never)).toBe(false);
    for (const text of ["luntian", "cebu", "laguna"]) {
      const k = keys(await searchEverything(prodOp, text));
      for (const hidden of ["sales_orders", "purchase_orders", "customers", "suppliers"]) expect(k, text).not.toContain(hidden);
    }
  });

  it("cross-site: an RVS-only user sees only RVS orders, batches and lots", async () => {
    // Luntian has orders only at NFD: the customer is found (organisation master data), its orders are not.
    const lu = await groupsOf(salesRvs, "luntian");
    expect(keys(lu)).toContain("customers");
    expect(keys(lu)).not.toContain("sales_orders");
    // Isla Spa has an order at each site: only the RVS one is listed.
    const g = await groupsOf(salesRvs, "isla spa");
    const orderIds = hrefs(g, "sales_orders").map(idOf);
    expect(orderIds.length).toBeGreaterThan(0);
    const rows = await db.select({ id: salesOrders.id, siteId: salesOrders.siteId }).from(salesOrders).where(inArray(salesOrders.id, orderIds));
    expect(rows.every((r) => r.siteId === kit.rvs.id)).toBe(true);
    const all = await searchEverything(salesRvs, "acapulco");
    const batchIds = hrefs(all, "batches").map(idOf);
    if (batchIds.length) expect((await db.select().from(batches).where(inArray(batches.id, batchIds))).every((b) => b.siteId === kit.rvs.id)).toBe(true);
    const lotIds = hrefs(await groupsOf(salesRvs, "acapulco"), "lots").map(idOf);
    if (lotIds.length) expect((await db.select().from(inventoryLots).where(inArray(inventoryLots.id, lotIds))).every((l) => l.siteId === kit.rvs.id)).toBe(true);
    // An NFD purchase order number is not found by an RVS-only buyer.
    const [nfdPo] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.siteId, kit.nfd.id)).limit(1);
    const buyerRvs = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
    expect(hrefs(await searchEverything(buyerRvs, nfdPo.poNumber), "purchase_orders")).toEqual([]);
  });

  it("role negative: without inventory.lot.view the search is refused", async () => {
    await expectCode(searchEverything(finance, "luntian"), "forbidden");
    await expectCode(resolveScanCard(finance, "luntian"), "forbidden");
  });
});
