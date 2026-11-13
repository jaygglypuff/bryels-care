import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { customers, importJobRows } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { createCustomer, similarBecause } from "@/modules/sales";
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
/** Run scratch key: the customers loaded by earlier rows of this chunk (ADR-133 item 7). */
const LOADED_CUSTOMERS = "customers.loaded";

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
    const existing = await tx.select({ id: customers.id, code: customers.code, name: customers.name, phone: customers.phone, email: customers.email }).from(customers).where(eq(customers.organizationId, ctx.organizationId));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const same = values.code ? existing.find((c) => c.code === values.code) : undefined;
      if (same) {
        out.set(rowNo, { tier: 1, entityType: "customer", entityId: same.id, label: `${same.code} ${same.name}`, message: `Customer ${same.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      // ADR-133 item 7: the New customer screen's "Already a customer?" rule (same phone, same email, nearly the same
      // name) also holds here; the custodian decides "same as existing", "new record" or "reject".
      const twin = existing.map((c) => ({ c, why: similarBecause({ name: values.name, phone: values.phone, email: values.email }, c) })).find((x) => x.why.length);
      if (twin) {
        out.set(rowNo, { tier: 2, entityType: "customer", entityId: twin.c.id, label: `${twin.c.code} ${twin.c.name}`, message: `Possible duplicate: the same ${twin.why.join(" and ")} as existing customer ${twin.c.code} ${twin.c.name}. Decide "same as existing", "new record" or "reject".` });
        continue;
      }
      const m = nameMatches(values.name, existing.map((c) => ({ id: c.id, label: `${c.code} ${c.name}`, names: [c.name] })), "customer", "customer");
      if (m) out.set(rowNo, m);
    }
    return out;
  },
  /** ADR-133 item 7: two rows of the file with the same phone or email (the second one is checked again when it posts). */
  fileChecks(rows) {
    const out = new Map<number, string[]>();
    const seen: { rowNo: number; values: CustomerValues }[] = [];
    for (const r of rows) {
      const first = seen.find((x) => similarBecause(r.values, { name: x.values.name, phone: x.values.phone, email: x.values.email }).some((w) => w !== "name"));
      if (first) {
        const why = similarBecause(r.values, { name: first.values.name, phone: first.values.phone, email: first.values.email }).filter((w) => w !== "name");
        out.set(r.rowNo, [`Same ${why.join(" and ")} as row ${first.rowNo} of this file: if it is the same customer, leave this row out.`]);
      } else seen.push(r);
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
    // ADR-133 item 7: createCustomer runs the "Already a customer?" check on every row. The custodian's "new record"
    // decision on a possible duplicate is the screen's "This is a different customer" tick. A match with a row loaded
    // earlier in this run fails the row with the reason in the import report. In the dry run (validation), a match
    // with a customer that existed before is already the row's "possible duplicate" question (findExisting), so the
    // dry run goes on and the custodian decides.
    const [decided] = await k.tx.select({ decision: importJobRows.decision }).from(importJobRows).where(eq(importJobRows.id, k.row.id)).limit(1);
    const loaded = (k.state.get(LOADED_CUSTOMERS) as Set<string> | undefined) ?? new Set<string>();
    k.state.set(LOADED_CUSTOMERS, loaded);
    const input = {
      code,
      name: v.name,
      status: v.status,
      shipTo: { label: "Main", line1: v.shipToLine1, city: v.shipToCity, province: v.shipToProvince, contactName: v.contactName, phone: v.phone },
      contactName: v.contactName,
      phone: v.phone,
      email: v.email,
      minShelfLifeDays: v.minShelfLifeDays ?? 0,
      ...(credit ? { creditLimitAmount: v.creditLimitAmount, paymentTermsDays: v.paymentTermsDays, taxIdentifier: v.taxIdentifier } : {}),
    };
    const c = await createCustomer(k.ctx, { ...input, duplicateCheck: true, confirmedDifferent: decided?.decision === "new_record" }, { tx: k.tx }).catch((e) => {
      if (!(e instanceof DomainError && e.details?.code === "POSSIBLE_DUPLICATE")) throw e;
      const similar = (e.details.similar as { id: string; code: string; name: string; why: string[] }[] | undefined) ?? [];
      const inThisRun = similar.find((x) => loaded.has(x.id));
      if (k.dryRun && similar.length > 0 && !inThisRun) return createCustomer(k.ctx, { ...input, duplicateCheck: true, confirmedDifferent: true }, { tx: k.tx });
      const s = inThisRun ?? similar[0];
      throw new DomainError("conflict", s ? `Not loaded: the same ${s.why.join(" and ")} as customer ${s.code} ${s.name}${inThisRun ? " (an earlier row of this file)" : ""}. If it is a different customer, choose "new record" for this row.` : "Not loaded: it looks like a customer we already have.", { field: "name", code: "POSSIBLE_DUPLICATE" });
    });
    loaded.add(c.id);
    return { entityType: "customer", entityId: c.id, label: c.code, warnings: v.code ? [] : [`Code ${c.code} assigned by the loader.`] };
  },
};
