/**
 * ADR-088 "nobody types a code" on the sales forms (grade-5 sales pass): the server gives the customer number,
 * the price list number and name, and the label design code and version, inside the same transaction. Also:
 * "days to pay" on the new-customer form stays a finance-only field (role escalation refused).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customerContacts, customers } from "@/db/schema";
import { CustomerCreateSchema, PriceListSchema, approvePriceList, createArtworkVersion, createCustomer, createPriceList, manilaToday, submitPriceList } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { loadW3d, newCustomer, productId, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
});

/** The new-customer form as posted: name, phone, street, city; everything else as the form's defaults. */
const formInput = (name: string, extra: Record<string, unknown> = {}) =>
  CustomerCreateSchema.parse({ code: "", name, status: "active", segment: "", contactName: "", phone: "0917 555 0101", email: "", minShelfLifeDays: "180", defaultLeadTimeDays: "", notesInternal: "", paymentTermsDays: "", shipTo: { label: "Main", line1: "12 Mabini St.", line2: "", city: "Calamba", province: "", postalCode: "" }, ...extra });

describe("new customer: name, phone, address; the system gives the number", () => {
  it("creates the customer with the next CUS number and no contact row when no contact person is given", async () => {
    const c = await createCustomer(w.sales, formInput("Fictional Sari-Sari Store Uno"));
    expect(c.code).toMatch(/^CUS-\d{4,}$/);
    expect(c.minShelfLifeDays).toBe(180);
    expect(c.phone).toBe("0917 555 0101");
    expect(c.shipToAddress).toContain("Calamba");
    expect(await db.select().from(customerContacts).where(eq(customerContacts.customerId, c.id))).toHaveLength(0);
  });

  it("two customers saved one after the other get different numbers", async () => {
    const a = await createCustomer(w.sales, formInput("Fictional Store Dos"));
    const b = await createCustomer(w.sales, formInput("Fictional Store Tres"));
    expect(a.code).not.toBe(b.code);
  });

  it("days to pay is saved when finance adds the customer", async () => {
    const financeAdds = withPermissions(w.finance, [...w.finance.permissions, "masterdata.customer.create"]);
    const c = await createCustomer(financeAdds, formInput("Fictional Store With Terms", { paymentTermsDays: "30" }));
    const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.paymentTermsDays).toBe(30);
  });

  it("role escalation: sales cannot set days to pay through the new-customer form", async () => {
    expect(w.sales.can("finance.credit_terms.approve")).toBe(false);
    await expectCode(createCustomer(w.sales, formInput("Fictional Store Sneaky Terms", { paymentTermsDays: "90" })), "forbidden");
    expect((await db.select().from(customers).where(eq(customers.name, "Fictional Store Sneaky Terms"))).length).toBe(0);
  });

  it("refuses days to pay outside 0–365", () => {
    expect(CustomerCreateSchema.safeParse({ ...formInput("X Store"), paymentTermsDays: "400" }).success).toBe(false);
  });
});

describe("prices: no price list number to type", () => {
  it("a customer's first prices get PL-<customer number> and the name 'Prices for <customer>'", async () => {
    const c = await newCustomer(w, { name: "Fictional Prices Buyer" });
    const input = PriceListSchema.parse({ code: "", name: "", partyKind: "customer", customerId: c.id, effectiveFrom: manilaToday(), lines: [{ productId: await productId("ACS-135"), minQtyUnits: "0", unitAmount: "70" }] });
    const pl = await createPriceList(w.sales, input);
    expect(pl.code).toBe(`PL-${c.code}`);
    expect(pl.name).toBe("Prices for Fictional Prices Buyer");
    expect(pl.versionNo).toBe(1);
  });

  it("new prices for the same customer reuse its number and become the next version", async () => {
    const c = await newCustomer(w, { name: "Fictional Versions Buyer" });
    const lines = [{ productId: await productId("GBS-135"), unitAmount: "60" }];
    const v1 = await createPriceList(w.sales, { partyKind: "customer", customerId: c.id, effectiveFrom: manilaToday(), lines });
    await submitPriceList(w.sales, v1.id);
    await approvePriceList(w.finance, v1.id, null);
    const v2 = await createPriceList(w.sales, { partyKind: "customer", customerId: c.id, effectiveFrom: manilaToday(), lines: [{ productId: lines[0].productId, unitAmount: "62" }] });
    expect(v2.code).toBe(v1.code);
    expect(v2.versionNo).toBe(2);
    // A second draft while one is open is refused, not silently duplicated.
    await expectCode(createPriceList(w.sales, { partyKind: "customer", customerId: c.id, effectiveFrom: manilaToday(), lines }), "conflict");
  });

  it("a typed number still works (under More details)", async () => {
    const c = await newCustomer(w);
    const pl = await createPriceList(w.sales, { code: "pl-typed-1", partyKind: "customer", customerId: c.id, effectiveFrom: manilaToday(), lines: [{ productId: await productId("ACS-135"), unitAmount: "71" }] });
    expect(pl.code).toBe("PL-TYPED-1");
  });
});

describe("label design: no code or version to type", () => {
  it("gives ART-<product code> and v1, v2 for the next one", async () => {
    const c = await newCustomer(w);
    const productIdAcs = await productId("AHL-250");
    const a1 = await createArtworkVersion(w.sales, { customerId: c.id, productId: productIdAcs, description: "First label" });
    expect(a1.artworkCode).toMatch(/^ART-/);
    const a2 = await createArtworkVersion(w.sales, { customerId: c.id, productId: productIdAcs });
    expect(a2.artworkCode).toBe(a1.artworkCode);
    expect(Number(a2.versionLabel.slice(1))).toBe(Number(a1.versionLabel.slice(1)) + 1);
  });

  it("a typed version that already exists is refused", async () => {
    const pid = await productId("ACS-135");
    const a = await createArtworkVersion(w.sales, { productId: pid, artworkCode: "ART-G5-DUP", versionLabel: "v1" });
    expect(a.versionLabel).toBe("v1");
    await expectCode(createArtworkVersion(w.sales, { productId: pid, artworkCode: "ART-G5-DUP", versionLabel: "v1" }), "conflict");
  });

  it("role escalation: a role without masterdata.customer_requirement.create cannot add a label design", async () => {
    await expectCode(createArtworkVersion(w.warehouse, { productId: await productId("ACS-135") }), "forbidden");
  });
});
