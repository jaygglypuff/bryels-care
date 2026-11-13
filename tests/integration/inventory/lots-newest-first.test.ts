/**
 * ADR-132 §8 (round 5 C report B18): the trace and recall pickers say "Lots at your site (newest first)" and now list
 * them newest first (last received or made); every other list keeps FEFO (earliest expiry first). Site scoping is
 * unchanged: a person never sees another site's lots in either order.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { listLots } from "@/modules/inventory";
import { resetTestDatabase } from "../../support/db";
import { asUser, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let qa: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
}, 180_000);

describe("listLots order", () => {
  it("'newest' lists the last received or made lot first", async () => {
    const rows = await listLots(qa, { includeEmpty: true, order: "newest" });
    expect(rows.length).toBeGreaterThan(2);
    const created = new Map((await db.select({ id: inventoryLots.id, at: inventoryLots.createdAt }).from(inventoryLots).where(inArray(inventoryLots.id, rows.map((r) => r.id)))).map((r) => [r.id, r.at.getTime()]));
    for (let i = 1; i < rows.length; i++) expect(created.get(rows[i - 1].id)!, `${rows[i - 1].lotNumber} before ${rows[i].lotNumber}`).toBeGreaterThanOrEqual(created.get(rows[i].id)!);
  });

  it("the default stays earliest expiry first", async () => {
    const rows = (await listLots(qa, { includeEmpty: true })).filter((r) => r.expiresOn);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].expiresOn! <= rows[i].expiresOn!).toBe(true);
  });

  it("stays inside the current site", async () => {
    const rows = await listLots(qa, { includeEmpty: true, order: "newest" });
    const sites = new Set((await db.select({ site: inventoryLots.siteId }).from(inventoryLots).where(inArray(inventoryLots.id, rows.map((r) => r.id)))).map((r) => r.site));
    expect([...sites]).toEqual([kit.nfd.id]);
  });
});
