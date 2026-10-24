import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { suppliers } from "@/db/schema";
import { SUPPLIER_QUALITY_STATUSES, createSupplier, type SupplierQualityStatus } from "@/modules/masterdata";
import { nameMatches, nextLoaderCode } from "./common";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * `suppliers` (docs/data-migration-plan.md §7.4): created through the supplier service (US-2-06).
 * quality_status defaults to `new` unless Procurement marks it in the file; an invalid email is a
 * warning and is not loaded (the plan's "warn (invalid contact)"). The approved-material list (sheet 2
 * of §9.2) is not part of this kind yet (no supplier-material service exists).
 */
type SupplierValues = {
  code: string | null;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  paymentTermsDays: number | null;
  defaultLeadTimeDays: number | null;
  qualityStatus: SupplierQualityStatus;
  qualityStatusReason: string | null;
  legacyNumber: string | null;
};

const emailOk = (v: string) => z.email().safeParse(v).success;

export const suppliersKind: ImportKindHandler<SupplierValues> = {
  kind: "suppliers",
  label: "Suppliers",
  description: "Supplier master records (approved-supplier list rows are maintained on the supplier screen).",
  creates: "supplier",
  entityPermissions: ["masterdata.supplier.create"],
  availability: { available: true },
  columns: [
    { key: "code", label: "Code", hint: "Blank = the loader assigns SUP-nnnn.", aliases: ["supplier_code"] },
    { key: "name", label: "Name", required: true, hint: "Registered name.", aliases: ["supplier_name"] },
    { key: "contact_name", label: "Contact", hint: "Optional." },
    { key: "email", label: "Email", hint: "Optional; an invalid address is not loaded (warning)." },
    { key: "phone", label: "Phone", hint: "Optional." },
    { key: "address_line1", label: "Address", hint: "Optional.", aliases: ["address"] },
    { key: "city", label: "City", hint: "Optional." },
    { key: "country", label: "Country", hint: "Optional." },
    { key: "payment_terms_days", label: "Payment terms (days)", hint: "From the Accountant." },
    { key: "lead_time_days", label: "Lead time (days)", hint: "Optional." },
    { key: "quality_status", label: "Quality status", hint: "new (default), approved, conditional or suspended (needs a reason)." },
    { key: "quality_status_reason", label: "Quality status reason", hint: "Required when suspended." },
    { key: "legacy_number", label: "Legacy number", hint: "Old code (crosswalk)." },
  ],
  exampleRows: [
    {
      code: "SUP-9001",
      name: "Laguna Oleo Supply (fictional)",
      contact_name: "Rosa Dimaculangan",
      email: "orders@laguna-oleo.test",
      phone: "+63 49 555 0101",
      address_line1: "Km 5 National Road",
      city: "Calamba",
      country: "PH",
      payment_terms_days: "30",
      lead_time_days: "7",
      quality_status: "new",
      quality_status_reason: "",
      legacy_number: "V-0042",
    },
  ],
  normalize(r) {
    const code = r.code("code", { pattern: /^[A-Z0-9][A-Z0-9._-]{1,31}$/, example: "SUP-0004" });
    const name = r.text("name", { required: true, max: 200 });
    let email = r.text("email", { max: 200 });
    if (email && !emailOk(email)) {
      r.warn(`Email "${email}" is not a valid address and was not loaded.`);
      email = null;
    }
    const v: SupplierValues = {
      code,
      name: name ?? "",
      contactName: r.text("contact_name", { max: 120 }),
      email: email ? email.toLowerCase() : null,
      phone: r.text("phone", { max: 40 }),
      addressLine1: r.text("address_line1", { max: 300 }),
      city: r.text("city", { max: 120 }),
      country: r.text("country", { max: 80 }),
      paymentTermsDays: r.int("payment_terms_days", { min: 0, max: 365 }),
      defaultLeadTimeDays: r.int("lead_time_days", { min: 0, max: 365 }),
      qualityStatus: r.oneOf("quality_status", SUPPLIER_QUALITY_STATUSES, { dflt: "new" }) ?? "new",
      qualityStatusReason: r.text("quality_status_reason", { max: 500 }),
      legacyNumber: r.text("legacy_number", { max: 80 }),
    };
    if (!name || name.length < 2) {
      if (name) r.error("name", "Name is too short.");
      return null;
    }
    return { values: v, tier1Key: code ? `code:${code}` : null, matchName: name };
  },
  async findExisting(tx, ctx, _job, rows) {
    const existing = await tx.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, city: suppliers.city }).from(suppliers).where(eq(suppliers.organizationId, ctx.organizationId));
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const same = values.code ? existing.find((s) => s.code === values.code) : undefined;
      if (same) {
        out.set(rowNo, { tier: 1, entityType: "supplier", entityId: same.id, label: `${same.code} ${same.name}`, message: `Supplier ${same.code} already exists; the row is skipped (imports are create-only).` });
        continue;
      }
      const m = nameMatches(values.name, existing.map((s) => ({ id: s.id, label: `${s.code} ${s.name}${s.city ? ` (${s.city})` : ""}`, names: [s.name] })), "supplier", "supplier");
      if (m) out.set(rowNo, m);
    }
    return out;
  },
  async create(k, v) {
    const code = v.code ?? (await nextLoaderCode(k.tx, "suppliers", "code", k.ctx.organizationId, "SUP", k.state));
    const { legacyNumber: _legacy, code: _c, ...rest } = v;
    void _legacy;
    void _c;
    const s = await createSupplier(k.ctx, { ...rest, code, isActive: true, notes: null }, { tx: k.tx });
    return { entityType: "supplier", entityId: s.id, label: s.code, warnings: v.code ? [] : [`Code ${s.code} assigned by the loader.`] };
  },
};
