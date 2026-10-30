/**
 * Consultant review 2026-10-30 (ADR-085): Scan / look up accepts plain words, not only exact codes. A
 * typed "coconut", "Coconut Oil", a supplier's lot number or the last digits of a lot number gives a
 * short "Did you mean…" list; an exact lot number still opens the lot directly. Never another site's
 * lots (cross-site negative); needs inventory.lot.view (role negative).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots, sites } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { resolveScanCard } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let whNfd: AuthContext;
let whRvs: AuthContext;
let finance: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  whNfd = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
}, 240_000);

const matchesOf = (c: Awaited<ReturnType<typeof resolveScanCard>>) => (c.outcome === "not_found" ? (c.matches ?? []) : []);

describe("keyword look-up", () => {
  it("a material name (any case, with spaces) lists that material's lots", async () => {
    for (const q of ["coconut", "Coconut Oil", "  COCONUT  "]) {
      const c = await resolveScanCard(whNfd, q);
      expect(c.outcome, q).toBe("not_found");
      const m = matchesOf(c);
      expect(m.length, q).toBeGreaterThan(0);
      expect(m.every((x) => /coconut/i.test(x.title)), q).toBe(true);
      expect(m[0].href).toMatch(/^\/inventory\/[0-9a-f-]{36}$/);
    }
  });

  it("an exact lot number still opens the lot directly", async () => {
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, kit.nfd.id)).limit(1);
    const c = await resolveScanCard(whNfd, lot.lotNumber.toLowerCase());
    expect(c.outcome).toBe("found");
  });

  it("the supplier's lot number and the last digits of a lot number find the lot", async () => {
    const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.nfd.id), eq(inventoryLots.itemKind, "material"))).limit(1);
    if (lot.supplierLotNumber) expect(matchesOf(await resolveScanCard(whNfd, lot.supplierLotNumber.slice(0, -1))).some((x) => x.href.endsWith(lot.id))).toBe(true);
    const tail = lot.lotNumber.slice(-4);
    const c = await resolveScanCard(whNfd, tail);
    const found = c.outcome === "found" ? c.identifier === lot.lotNumber : matchesOf(c).some((x) => x.href.endsWith(lot.id));
    expect(found).toBe(true);
  });

  it("several words must all match (AND), and nothing found says so plainly", async () => {
    const both = matchesOf(await resolveScanCard(whNfd, "coconut oil"));
    expect(both.length).toBeGreaterThan(0);
    const none = await resolveScanCard(whNfd, "coconut zzzz");
    expect(none.outcome).toBe("not_found");
    expect(matchesOf(none)).toEqual([]);
  });

  it("cross-site: an RVS-only user never sees NFD lots", async () => {
    const [rvsSite] = await db.select().from(sites).where(eq(sites.id, kit.rvs.id));
    expect(rvsSite).toBeTruthy();
    const m = matchesOf(await resolveScanCard(whRvs, "coconut"));
    const ids = m.map((x) => x.href.split("/").pop()!);
    if (ids.length) {
      const rows = await db.select({ siteId: inventoryLots.siteId, id: inventoryLots.id }).from(inventoryLots);
      for (const id of ids) expect(rows.find((r) => r.id === id)?.siteId).toBe(kit.rvs.id);
    }
  });

  it("role negative: without inventory.lot.view the look-up is refused", async () => {
    if (finance.can("inventory.lot.view")) return;
    await expectCode(resolveScanCard(finance, "coconut"), "forbidden");
  });
});
