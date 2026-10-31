/**
 * "What sells best" on the Reports landing page (ADR-088; src/modules/analytics/top-products.ts):
 * confirmed orders only, ranked by value (or by pieces when money is hidden), money masked by permission
 * in the DTO, no site crossing, and no access without the dashboard permission.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { getKpiTile, getTopProducts } from "@/modules/analytics";
import { createOrder, submitOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";
import { inDays, newCustomer, productId, type W3d, loadW3d } from "../../support/w3d";

let kit: Kit;
let w: W3d;
let owner: AuthContext;
let ownerNfd: AuthContext;
let ownerRvs: AuthContext;
let manager: AuthContext;
let salesCs: AuthContext;
let operator: AuthContext;
let acs: string;
let before = 0;
let afterConfirmed = 0;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  w = await loadW3d();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerNfd = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd]);
  ownerRvs = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  salesCs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  acs = await productId("ACS-135");

  const units = async () => Number((await getTopProducts(ownerNfd, { days: 28, limit: 20 }))!.rows.find((r) => r.productId === acs)?.units ?? 0);
  before = await units();
  const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
  // Confirmed: 4 × 70 = 280.
  const o1 = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: "4", unitPrice: "70" }] });
  await submitOrder(w.sales, o1.id);
  afterConfirmed = await units();
  // A draft is not a sale: never counted.
  await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: "100", unitPrice: "70" }] });
}, 240_000);

describe("best-selling products", () => {
  it("counts confirmed orders only, with pieces, value and the number of orders", async () => {
    const top = await getTopProducts(ownerNfd, { days: 28 });
    expect(top).not.toBeNull();
    const row = top!.rows.find((r) => r.productId === acs);
    expect(row).toBeDefined();
    expect(afterConfirmed - before).toBe(4); // the confirmed order counts
    expect(Number(row!.units)).toBe(afterConfirmed); // the draft (100 pieces) is left out
    expect(top!.masked).toBe(false);
    expect(row!.value).not.toBeNull();
  });

  it("agrees with the sales number for the same days (value = Σ order value of the confirmed orders)", async () => {
    const top = await getTopProducts(ownerNfd, { days: 28, limit: 20 });
    const tile = await getKpiTile(ownerNfd, "KPI-SAL-01V", { scope: ownerNfd.currentSiteId, from: top!.from, to: top!.to });
    const sum = top!.rows.reduce((s, r) => s + Number(r.value), 0);
    expect(sum).toBeCloseTo(Number(tile.current?.value ?? 0), 2);
  });

  it("hides money without the financial permission (sales staff see pieces only)", async () => {
    const top = await getTopProducts(salesCs, { days: 28 });
    expect(top!.masked).toBe(true);
    expect(top!.rows.every((r) => r.value === null)).toBe(true);
  });

  it("never shows another site's orders", async () => {
    const rvs = await getTopProducts(ownerRvs, { days: 28 });
    expect(rvs!.rows.find((r) => r.productId === acs && Number(r.units) >= 4)).toBeUndefined();
  });

  it("all sites only with the owner's overview permission", async () => {
    expect((await getTopProducts(owner, { all: true, days: 28 }))!.scope.all).toBe(true);
    await expectCode(getTopProducts(manager, { all: true }), "forbidden");
  });

  it("refuses people without the dashboard permission", async () => {
    await expectCode(getTopProducts(operator), "forbidden");
  });
});
