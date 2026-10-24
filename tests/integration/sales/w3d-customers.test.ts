/**
 * US-4-01 customers, addresses, contacts and credit terms (W3D). Tests: sales.credit_terms_masked,
 * authz.sensitive_fields.masked, role escalation and the default-address invariant.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { customerAddresses, customers } from "@/db/schema";
import { runExport } from "@/lib/export";
import {
  addAddress,
  addContact,
  createCustomer,
  customersExport,
  getCustomer,
  getCustomer360,
  listCustomers,
  removeAddress,
  removeContact,
  setCreditTerms,
  setCustomerStatus,
  setDefaultAddress,
  updateCustomer,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { auditCount, bundle, loadW3d, newCustomer, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;
const csvText = (b: Buffer) => b.toString("utf8");

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
});

describe("US-4-01 customer master", () => {
  it("creates a customer with one address that is the default ship-to and bill-to, and a primary contact", async () => {
    const c = await newCustomer(w);
    const d = await getCustomer(w.sales, c.id);
    expect(d.addresses).toHaveLength(1);
    expect(d.addresses[0]).toMatchObject({ isDefaultShipTo: true, isDefaultBillTo: true, city: "Santa Rosa" });
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0].isPrimary).toBe(true);
    expect(d.customer.shipToAddress).toContain("Santa Rosa");
    expect(await auditCount(c.id, "masterdata.customer.created")).toBe(1);
  });

  it("sales.credit_terms_masked: credit limit, payment terms and tax id are absent with a _masked hint for roles without finance.credit_terms.view", async () => {
    const c = await newCustomer(w, { creditLimit: "75000" });
    const asWarehouse = await getCustomer(w.warehouse, c.id);
    expect("creditLimitAmount" in asWarehouse.customer).toBe(false);
    expect("paymentTermsDays" in asWarehouse.customer).toBe(false);
    expect("taxIdentifier" in asWarehouse.customer).toBe(false);
    expect(asWarehouse.customer._masked).toEqual(["creditLimitAmount", "paymentTermsDays", "taxIdentifier"]);
    expect(JSON.stringify(asWarehouse)).not.toContain("75000");
    const listed = (await listCustomers(w.warehouse)).find((r) => r.id === c.id)!;
    expect("creditLimitAmount" in listed).toBe(false);
    const asFinance = await getCustomer(w.finance, c.id);
    expect(asFinance.customer.creditLimitAmount).toBe("75000.0000");
    expect(asFinance.customer._masked).toBeUndefined();
    // customer 360 never carries the credit summary for a role without the permission
    expect((await getCustomer360(w.warehouse, c.id)).credit).toBeNull();
    expect((await getCustomer360(w.finance, c.id)).credit).toMatchObject({ limit: "75000.00" });
  });

  it("authz.sensitive_fields.masked: the customer export drops the credit columns without finance.credit_terms.view", async () => {
    await newCustomer(w, { creditLimit: "123456" });
    const noCredit = withPermissions(w.sales, bundle("sales_cs").filter((p) => p !== "finance.credit_terms.view"));
    const file = await runExport(noCredit, customersExport, {}, "csv");
    expect(file.maskedColumns).toEqual(["Credit limit", "Payment terms (days)", "Tax identifier"]);
    expect(csvText(file.body)).not.toContain("123456");
    const full = await runExport(w.sales, customersExport, {}, "csv");
    expect(full.maskedColumns).toEqual([]);
    expect(csvText(full.body)).toContain("123456");
    await expectCode(runExport(w.warehouse, customersExport, {}, "csv"), "forbidden");
  });

  it("credit terms are changed only with finance.credit_terms.approve, with a reason and sales.customer.credit_terms_changed", async () => {
    const c = await newCustomer(w);
    await expectCode(setCreditTerms(w.sales, c.id, { creditLimitAmount: "1", paymentTermsDays: 1, reason: "Raise" }), "forbidden");
    await expectCode(createCustomer(w.sales, { code: "T3D-CREDIT", name: "Sneaky Credit", minShelfLifeDays: 0, shipToAddress: "x street", creditLimitAmount: "999999" }), "forbidden");
    await expectCode(setCreditTerms(w.finance, c.id, { creditLimitAmount: "50000", paymentTermsDays: 30, reason: "" }), "validation");
    await setCreditTerms(w.finance, c.id, { creditLimitAmount: "50000", paymentTermsDays: 30, taxIdentifier: "DEMO-TIN-9", reason: "Annual review (fictional)" });
    expect(await auditCount(c.id, "sales.customer.credit_terms_changed")).toBe(1);
    const [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row).toMatchObject({ creditLimitAmount: "50000.0000", paymentTermsDays: 30, taxIdentifier: "DEMO-TIN-9" });
  });

  it("placing or lifting a credit hold needs finance; other status moves follow the customer state machine", async () => {
    const c = await newCustomer(w);
    await expectCode(setCustomerStatus(w.sales, c.id, "on_hold", "Overdue (fictional)"), "forbidden");
    await setCustomerStatus(w.finance, c.id, "on_hold", "Overdue (fictional)");
    expect(await auditCount(c.id, "sales.customer.credit_hold_placed")).toBe(1);
    await expectCode(setCustomerStatus(w.sales, c.id, "prospect", "back"), "state");
    await setCustomerStatus(w.finance, c.id, "active", "Paid (fictional)");
    expect(await auditCount(c.id, "sales.customer.credit_hold_lifted")).toBe(1);
  });

  it("exactly one default ship-to and bill-to: a new default replaces the old one; a default cannot be removed", async () => {
    const c = await newCustomer(w);
    const first = (await getCustomer(w.sales, c.id)).addresses[0];
    const second = await addAddress(w.sales, c.id, { label: "Branch", line1: "9 Rizal Ave.", city: "Calamba", makeDefaultShipTo: true });
    const d = await getCustomer(w.sales, c.id);
    expect(d.addresses.filter((a) => a.isDefaultShipTo).map((a) => a.id)).toEqual([second.id]);
    expect(d.addresses.filter((a) => a.isDefaultBillTo).map((a) => a.id)).toEqual([first.id]);
    expect(d.customer.shipToAddress).toContain("Calamba");
    await expectCode(removeAddress(w.sales, second.id), "state");
    await setDefaultAddress(w.sales, first.id, "ship_to");
    await removeAddress(w.sales, second.id);
    const live = await db.select().from(customerAddresses).where(and(eq(customerAddresses.customerId, c.id), isNull(customerAddresses.deletedAt)));
    expect(live).toHaveLength(1);
    // The database refuses a second default ship-to even if a service had a bug.
    await expect(
      db.insert(customerAddresses).values({ organizationId: w.orgId, customerId: c.id, label: "Dup", line1: "x", city: "y", isDefaultShipTo: true, createdBy: w.sales.userId, updatedBy: w.sales.userId }),
    ).rejects.toThrow();
  });

  it("contacts: the primary contact mirrors onto the customer; removing it promotes the next one", async () => {
    const c = await newCustomer(w);
    const k2 = await addContact(w.sales, c.id, { name: "Second Buyer", phone: "+63 900 111 2222", isPrimary: true });
    let [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.contactName).toBe("Second Buyer");
    await removeContact(w.sales, k2.id);
    [row] = await db.select().from(customers).where(eq(customers.id, c.id));
    expect(row.contactName).toBe("Test Contact");
  });

  it("role escalation: a warehouse operator cannot create or edit customers", async () => {
    const c = await newCustomer(w);
    await expectCode(createCustomer(w.warehouse, { code: "T3D-WH", name: "Nope", minShelfLifeDays: 0, shipToAddress: "x street" }), "forbidden");
    await expectCode(updateCustomer(w.warehouse, c.id, { name: "Renamed", minShelfLifeDays: 1 }), "forbidden");
    await expectCode(addAddress(w.warehouse, c.id, { label: "x", line1: "x", city: "x" }), "forbidden");
  });

  it("customers are organization-wide but order counts only include the user's sites", async () => {
    const rows = await listCustomers(w.warehouseRvs);
    const luntian = rows.find((r) => r.code === "CUS-001")!;
    // CUS-001's seeded orders are at NFD only.
    expect(luntian.orders).toBe(0);
    expect((await listCustomers(w.sales)).find((r) => r.code === "CUS-001")!.orders).toBeGreaterThan(0);
  });
});
