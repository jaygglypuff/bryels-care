/**
 * UX audit round 2 part 2 (B #8, must-do 5): the site manager approves purchases but does not raise them
 * (docs/permissions-matrix.md §3.4: SM = v a on purchase_order / supplier_return; PR = v c e s p x o). Decision:
 * keep the matrix (maker ≠ approver for money going out) and name the people who can on the refused screens and in
 * "Waiting for …". These tests prove the matrix is unchanged in the service, and that the named people are the
 * right ones at the right site.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { createPurchaseOrder, createSupplierReturn } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let manager: AuthContext;
let managerRvs: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
}, 240_000);

describe("purchasing access for the site manager", () => {
  it("the site manager may not raise a purchase order or a supplier return (role escalation negative, unchanged matrix)", async () => {
    await expectCode(createPurchaseOrder(manager, { supplierId: randomUUID(), lines: [] } as never), "forbidden");
    await expectCode(createSupplierReturn(manager, { supplierId: randomUUID(), reasonCode: "other" }), "forbidden");
    expect(manager.can("procurement.purchase_order.approve")).toBe(true);
    expect(manager.can("procurement.purchase_order.create")).toBe(false);
  });

  it("the refused screen names the purchasing person at the site, never the asker", async () => {
    const who = await whoCanDo(manager, "procurement.purchase_order.create", kit.nfd.id);
    expect(who.people.map((p) => p.email)).toContain("procurement@bryels-care.test");
    expect(who.people.map((p) => p.email)).not.toContain("manager.nfd@bryels-care.test");
    expect(who.roles.length).toBeGreaterThan(0);
  });

  it("names only people who hold the right at that site (cross-site negative)", async () => {
    // At RVS the NFD-only warehouse operator does not hold supplier_return.create, so he is not named there.
    const nfd = await whoCanDo(manager, "procurement.supplier_return.create", kit.nfd.id);
    const rvs = await whoCanDo(managerRvs, "procurement.supplier_return.create", kit.rvs.id);
    expect(nfd.people.map((p) => p.email)).toContain("warehouse.nfd@bryels-care.test");
    expect(rvs.people.map((p) => p.email)).not.toContain("warehouse.nfd@bryels-care.test");
    // a site the asker is not assigned to falls back to the asker's current site, never leaks another site's people
    const asked = await whoCanDo(manager, "procurement.supplier_return.create", kit.rvs.id);
    expect(asked.people.map((p) => p.email)).toEqual(nfd.people.map((p) => p.email));
  });
});
