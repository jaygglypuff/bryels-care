/**
 * Low stock read model (owner QA 2026-10-30): materials (reorder policy minimum) and products (product
 * minimum) below their minimum at the caller's sites, counting usable stock only (released, in date).
 * PKG-0101 Soap wrapper: seeded minimum 20,000 pcs at NFD, usable stock far below. Cross-site and
 * permission negatives. Also: the Reorder suggestions screen computes when the nightly job never ran.
 */
import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { materialReorderPolicies, materials, productMinStock, products, reorderSuggestions } from "@/db/schema";
import { fmtStock, lowStockItems } from "@/modules/inventory";
import { ensureReorderSuggestionsFresh, listReorderSuggestions } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let pkg: typeof materials.$inferSelect;

/** Independent check: usable (released, not expired) stock of a material at a site. */
async function usable(siteId: string, materialId: string) {
  const [r] = (await db.execute(sql`
    select coalesce(sum(b.qty_base), 0)::text as q from inventory_balances b join inventory_lots l on l.id = b.lot_id
     where b.site_id = ${siteId}::uuid and l.material_id = ${materialId}::uuid and b.qty_base > 0 and l.quality_status = 'released'
       and (l.expires_on is null or l.expires_on >= (now() at time zone 'Asia/Manila')::date)`)) as unknown as { q: string }[];
  return new Decimal(r.q);
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  [pkg] = await db.select().from(materials).where(eq(materials.code, "PKG-0101"));
}, 180_000);

describe("lowStockItems", () => {
  it("PKG-0101 is below its 20,000 pcs minimum at NFD; on hand = usable stock only; decimal strings", async () => {
    const [policy] = await db.select().from(materialReorderPolicies).where(and(eq(materialReorderPolicies.siteId, kit.nfd.id), eq(materialReorderPolicies.materialId, pkg.id)));
    expect(new Decimal(policy.minStockBase).eq(20000)).toBe(true);
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const items = await lowStockItems(wh);
    const it0 = items.find((i) => i.kind === "material" && i.code === "PKG-0101");
    expect(it0).toBeTruthy();
    const onHand = await usable(kit.nfd.id, pkg.id);
    expect(onHand.lt(20000)).toBe(true);
    expect(it0).toMatchObject({ id: pkg.id, name: pkg.name, unit: pkg.baseUom, siteId: kit.nfd.id, siteCode: "NFD" });
    expect(new Decimal(it0!.onHand).eq(onHand)).toBe(true);
    expect(new Decimal(it0!.minimum).eq(20000)).toBe(true);
    expect(new Decimal(it0!.shortBy).eq(new Decimal(20000).minus(onHand))).toBe(true);
    expect(it0!.minimumText).toBe("20,000 pcs");
    expect(it0!.href).toMatch(/^\/(procurement\/reorder|inventory\/availability\?q=PKG-0101)$/);
    // Every row is really below its minimum.
    for (const i of items) expect(new Decimal(i.onHand).lt(i.minimum)).toBe(true);
  });

  it("stock waiting for quality (quarantine, on hold) is not counted as on hand but is reported separately", async () => {
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const row = (await lowStockItems(wh)).find((i) => i.code === "PKG-0101")!;
    const [r] = (await db.execute(sql`
      select coalesce(sum(b.qty_base), 0)::text as q from inventory_balances b join inventory_lots l on l.id = b.lot_id
       where b.site_id = ${kit.nfd.id}::uuid and l.material_id = ${pkg.id}::uuid and b.qty_base > 0 and l.quality_status in ('quarantine', 'on_hold')`)) as unknown as { q: string }[];
    expect(new Decimal(row.waitingForQuality).eq(r.q)).toBe(true);
    expect(new Decimal(row.onHand).eq(await usable(kit.nfd.id, pkg.id))).toBe(true);
  });

  it("products with a minimum are included when below it", async () => {
    const [p] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    await db.delete(productMinStock).where(and(eq(productMinStock.siteId, kit.nfd.id), eq(productMinStock.productId, p.id)));
    await db.insert(productMinStock).values({ organizationId: kit.orgId, siteId: kit.nfd.id, productId: p.id, minStockUnits: "99999999", updatedBy: manager.userId });
    const row = (await lowStockItems(manager)).find((i) => i.kind === "product" && i.id === p.id);
    expect(row).toMatchObject({ code: "ACS-135", minimum: "99999999", siteId: kit.nfd.id });
  });

  it("cross-site negative: an RVS-only user never sees NFD rows and cannot ask for NFD (404)", async () => {
    const rvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
    const items = await lowStockItems(rvs);
    expect(items.some((i) => i.siteId === kit.nfd.id)).toBe(false);
    await expectCode(lowStockItems(rvs, { siteIds: [kit.nfd.id] }), "not_found");
  });

  it("role negative: without inventory.balance.view → forbidden", async () => {
    const noView = await asUser(kit, "operator.nfd@bryels-care.test", ["custom_no_stock"], [kit.nfd]);
    await expectCode(lowStockItems(noView), "forbidden");
  });

  it("explicit site filter within scope returns only that site", async () => {
    const both = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
    const items = await lowStockItems(both, { siteIds: [kit.rvs.id] });
    expect(items.every((i) => i.siteId === kit.rvs.id)).toBe(true);
  });

  it("fmtStock groups thousands and converts g/mL from 1,000, decimal-safe", () => {
    expect(fmtStock("2880", "pcs")).toBe("2,880 pcs");
    expect(fmtStock("20000", "g")).toBe("20 kg");
    expect(fmtStock("1234.5", "mL")).toBe("1.23 L");
    expect(fmtStock("0.1", "g")).toBe("0.1 g");
  });
});

describe("Reorder suggestions when the nightly job never ran", () => {
  it("opening the screen computes them once (PKG-0101 suggested), then not again within 26 h", async () => {
    const proc = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]);
    // The seed never ran the job: no computation is recorded and no suggestion exists.
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from audit_events where action = 'procurement.reorder_suggestion.computed'`)) as unknown as { n: number }[];
    expect(Number(n)).toBe(0);
    expect((await db.select().from(reorderSuggestions)).length).toBe(0);
    const first = await ensureReorderSuggestionsFresh(proc);
    expect(first.computedNow).toBe(true);
    expect((await listReorderSuggestions(proc)).some((r) => r.materialCode === "PKG-0101")).toBe(true);
    const again = await ensureReorderSuggestionsFresh(proc);
    expect(again.computedNow).toBe(false);
    expect(again.lastComputedAt).toBeInstanceOf(Date);
  });
});
