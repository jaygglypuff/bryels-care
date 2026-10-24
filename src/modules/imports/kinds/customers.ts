import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { createCustomer } from "@/modules/sales";
import { nameMatches, nextLoaderCode } from "./common";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * `customers` (docs/data-migration-plan.md §7.5): created through W3D's customer service
 * (`createCustomer(ctx, input, { tx })`, US-4-01), so the import follows the rules of the screen:
 * code unique, a ship-to address is required (it becomes the default ship-to and bill-to), the
 * primary contact is recorded, `masterdata.customer.created` is audited. Credit limit, payment terms
 * and tax identifier are finance's (A-W3D-08): a row carrying them is refused unless the poster holds
 * `finance.credit_terms.approve`; otherwise finance sets them on the customer page after the import.
 * Only `PHP` is accepted as currency (the customer master has no other currency yet). Registered by
 * src/modules/wiring.ts (`registerImportKind`), replacing the placeholder of kinds/index.ts.
 */
type CustomerValues = {
  code: string | null;
  name: string;
  status: "active" | "prospect";
  shipToLine1: string | null;
  shipToCity: string | null;
  shipToProvince: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  minShelfLifeDays: number | null;
  paymentTermsDays: number | null;
  creditLimitAmount: string | null;
  taxIdentifier: string | null;
  legacyNumber: string | null;
};

const emailOk = (v: string) => z.email().safeParse(v).success;

export const customersKind: ImportKindHandler<CustomerValues> = {
  kind: "customers",
  label: "Customers",
  description: "Customer master with the default ship-to address and primary contact (docs/data-migration-plan.md §7.5). Credit terms only when the poster holds finance approval.",
  creates: "customer",
  entityPermissions: ["masterdata.customer.create"],
  availability: { available: true },
  columns: [
    { key: "code", label: "Code", hint: "Blank = the loader assigns CUS-nnnn.", aliases: ["customer_code"] },
    { key: "name", label: "Name", required: true, hint: "Registered name.", aliases: ["customer_name"] },
    { key: "status", label: "Status", hint: "active (default) or prospect. Credit holds are placed by finance on the customer page." },
    { key: "ship_to_line1", label: "Ship-to address", required: true, hint: "Street and number.", aliases: ["address", "ship_to_address"] },
    { key: "ship_to_city", label: "Ship-to city", required: true, hint: "City or municipality.", aliases: ["city"] },
    { key: "ship_to_province", label: "Ship-to province", hint: "Optional.", aliases: ["province"] },
    { key: "contact_name", label: "Contact", hint: "Optional; becomes the primary contact." },
    { key: "phone", label: "Phone", hint: "Optional." },
    { key: "email", label: "Email", hint: "Optional; an invalid address is not loaded (warning)." },
    { key: "min_shelf_life_days", label: "Minimum shelf life at dispatch (days)", hint: "Default 0; customer requirements override it." },
    { key: "payment_terms_days", label: "Payment terms (days)", hint: "From the Accountant (sensitive): only with finance approval." },
    { key: "credit_limit_amount", label: "Credit limit", hint: "From the Accountant (sensitive): only with finance approval." },
    { key: "currency", label: "Currency", hint: "PHP (the only currency for now)." },
    { key: "tax_identifier", label: "Tax identifier", hint: "As registered (sensitive): only with finance approval." },
    { key: "legacy_number", label: "Legacy number", hint: "Old code (crosswalk)." },
  ],
  exampleRows: [
    {
      code: "CUS-9001",
      name: "Sample Wellness Store (fictional)",
      status: "active",
      ship_to_line1: "12 Sampaguita St.",
      ship_to_city: "Santa Rosa",
      ship_to_province: "Laguna",
      contact_name: "Lorna Reyes",
      phone: "+63 900 000 0000",
      email: "orders@sample-wellness.test",
      min_shelf_life_days: "180",
      payment_terms_days: "",
      credit_limit_amount: "",
      currency: "PHP",
      tax_identifier: "",
      legacy_number: "C-017",
    },
  ],
  normalize(r) {
    const code = r.code("code", { pattern: /^[A-Z0-9][A-Z0-9._-]{1,31}$/, example: "CUS-0004" });
    const name = r.text("name", { required: true, max: 200 });
    let email = r.text("email", { max: 200 });
    if (email && !emailOk(email)) {
      r.warn(`Email "${email}" is not a valid address and was not loaded.`);
      email = null;
    }
    const currency = (r.text("currency", { max: 3 }) ?? "PHP").toUpperCase();
    if (currency !== "PHP") r.error("currency", `Currency ${currency} is not supported; customers are in PHP.`);
    const line1 = r.text("ship_to_line1", { max: 300 });
    const city = r.text("ship_to_city", { max: 120 });
    if (!line1 || !city) r.error("ship_to_line1", "The ship-to address (street and city) is required.");
    const v: CustomerValues = {
      code,
      name: name ?? "",
      status: r.oneOf("status", ["active", "prospect"] as const, { dflt: "active" }) ?? "active",
      shipToLine1: line1,
      shipToCity: city,
      shipToProvince: r.text("ship_to_province", { max: 120 }),
      contactName: r.text("contact_name", { max: 120 }),
      phone: r.text("phone", { max: 40 }),
      email: email ? email.toLowerCase() : null,
      minShelfLifeDays: r.int("min_shelf_life_days", { min: 0, max: 3650 }),
      paymentTermsDays: r.int("payment_terms_days", { min: 0, max: 365 }),
      creditLimitAmount: r.decimal("credit_limit_amount", { nonNegative: true, dp: 2 }),
      taxIdentifier: r.text("tax_identifier", { max: 40 }),
      legacyNumber: r.text("legacy_number", { max: 80 }),
    };
    if (!name || name.length < 2) {
      if (name) r.error("name", "Name is too short.");
      return null;
    }
    return { values: v, tier1Key: code ? `code:${code}` : null, matchName: name };
  },
  async findExisting(tx, ctx, _job, rows) {
    const existing = await tx.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.organizationId, ctx.organizationId));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const same = values.code ? existing.find((c) => c.code === values.code) : undefined;
      if (same) {
        out.set(rowNo, { tier: 1, entityType: "customer", entityId: same.id, label: `${same.code} ${same.name}`, message: `Customer ${same.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      const m = nameMatches(values.name, existing.map((c) => ({ id: c.id, label: `${c.code} ${c.name}`, names: [c.name] })), "customer", "customer");
      if (m) out.set(rowNo, m);
    }
    return out;
  },
  async create(k, v) {
    const credit = v.creditLimitAmount !== null || v.paymentTermsDays !== null || !!v.taxIdentifier;
    if (credit && !k.ctx.can("finance.credit_terms.approve")) {
      throw new DomainError("validation", "Credit limit, payment terms and tax identifier are set by finance (finance.credit_terms.approve); leave them empty and finance enters them on the customer page.", { field: "credit_limit_amount" });
    }
    if (!v.shipToLine1 || !v.shipToCity) throw new DomainError("validation", "The ship-to address (street and city) is required.", { field: "ship_to_line1" });
    const code = v.code ?? (await nextLoaderCode(k.tx, "customers", "code", k.ctx.organizationId, "CUS", k.state));
    const c = await createCustomer(
      k.ctx,
      {
        code,
        name: v.name,
        status: v.status,
        shipTo: { label: "Main", line1: v.shipToLine1, city: v.shipToCity, province: v.shipToProvince, contactName: v.contactName, phone: v.phone },
        contactName: v.contactName,
        phone: v.phone,
        email: v.email,
        minShelfLifeDays: v.minShelfLifeDays ?? 0,
        ...(credit ? { creditLimitAmount: v.creditLimitAmount, paymentTermsDays: v.paymentTermsDays, taxIdentifier: v.taxIdentifier } : {}),
      },
      { tx: k.tx },
    );
    return { entityType: "customer", entityId: c.id, label: c.code, warnings: v.code ? [] : [`Code ${c.code} assigned by the loader.`] };
  },
};
