import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { CUSTOMER_SEGMENTS, CUSTOMER_STATUSES, customerAddresses, customerContacts, customers, salesOrders, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { runInTx, type InTx } from "@/lib/tx";
import { DomainError } from "@/lib/errors";
import type { ExportDefinition } from "@/lib/export";
import { CREDIT_FIELDS, formatAddress, idempotent, isUuid, maskFields } from "./crm-support";

/**
 * Customer master (US-4-01, docs/data-model.md §3.2, docs/permissions-matrix.md §3.2, §6).
 * Customers are organization-wide (matrix §4.1); order counts and shipments only include the user's
 * sites. Credit limit, payment terms and tax identifier are visible with `finance.credit_terms.view`
 * only and changed with `finance.credit_terms.approve` (audit `sales.customer.credit_terms_changed`).
 * Addresses and contacts are soft-deleted; every customer keeps exactly one default ship-to and one
 * default bill-to address, and `customers.ship_to_address` / `contact_*` mirror the default ship-to
 * and the primary contact so documents built before Wave 3 keep printing the right text.
 */

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** Customer status machine. Placing or lifting a credit hold is a finance decision. */
export const CUSTOMER_TRANSITIONS: Record<CustomerStatus, readonly CustomerStatus[]> = {
  prospect: ["active", "inactive"],
  active: ["on_hold", "inactive"],
  on_hold: ["active", "inactive"],
  inactive: ["active"],
};
const CREDIT_HOLD_MOVES: readonly string[] = ["active>on_hold", "on_hold>active"];

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = { prospect: "Prospect", active: "Active", on_hold: "Credit hold", inactive: "Inactive" };
export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  pharmacy_chain: "Pharmacy chain",
  salon_spa: "Salon / spa",
  distributor: "Distributor",
  online_reseller: "Online reseller",
  retail_store: "Retail store",
  other: "Other",
};

export type AddressInput = {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  contactName?: string | null;
  phone?: string | null;
};

export type CustomerInput = {
  code: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Legacy single-line ship-to (MVP form); a structured `shipTo` wins when given. */
  shipToAddress?: string | null;
  shipTo?: AddressInput | null;
  /** Separate bill-to; when absent the ship-to address is also the default bill-to. */
  billTo?: AddressInput | null;
  minShelfLifeDays: number;
  status?: "prospect" | "active";
  segment?: CustomerSegment | null;
  defaultLeadTimeDays?: number | null;
  notesInternal?: string | null;
  /** Only with finance.credit_terms.approve. */
  creditLimitAmount?: string | null;
  paymentTermsDays?: number | null;
  taxIdentifier?: string | null;
  idempotencyKey?: string | null;
};

type CustomerRow = typeof customers.$inferSelect;

/** The customer DTO with credit terms masked by permission. */
export function customerView(ctx: AuthContext, c: CustomerRow) {
  return maskFields(ctx, "finance.credit_terms.view", c, CREDIT_FIELDS);
}
export type CustomerView = ReturnType<typeof customerView>;

async function loadCustomer(q: DbOrTx, ctx: AuthContext, id: string, lock = false): Promise<CustomerRow> {
  if (!isUuid(id)) throw new DomainError("not_found", "Customer not found.");
  const base = q
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  const [c] = lock ? await base.for("update") : await base;
  if (!c) throw new DomainError("not_found", "Customer not found.");
  return c;
}

/** Customers are organization-level; order counts only include orders in the user's sites. */
export async function listCustomers(ctx: AuthContext, filters: { q?: string; status?: string; segment?: string } = {}) {
  ctx.require("masterdata.customer.view");
  const stats = db
    .select({
      customerId: salesOrders.customerId,
      orders: sql<number>`count(*)::int`.as("orders"),
      openOrders: sql<number>`count(*) filter (where ${salesOrders.status} not in ('shipped', 'invoiced', 'closed', 'cancelled'))::int`.as("open_orders"),
      lastOrderAt: sql<Date | null>`max(${salesOrders.createdAt})`.as("last_order_at"),
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .groupBy(salesOrders.customerId)
    .as("stats");
  const where = [eq(customers.organizationId, ctx.organizationId)];
  const q = filters.q?.trim();
  if (q) where.push(or(ilike(customers.name, `%${q}%`), ilike(customers.code, `%${q}%`))!);
  if (filters.status && (CUSTOMER_STATUSES as readonly string[]).includes(filters.status)) where.push(eq(customers.status, filters.status));
  if (filters.segment && (CUSTOMER_SEGMENTS as readonly string[]).includes(filters.segment)) where.push(eq(customers.segment, filters.segment));
  const rows = await db
    .select({ c: customers, orders: sql<number>`coalesce(${stats.orders}, 0)`, openOrders: sql<number>`coalesce(${stats.openOrders}, 0)`, lastOrderAt: stats.lastOrderAt })
    .from(customers)
    .leftJoin(stats, eq(stats.customerId, customers.id))
    .where(and(...where))
    .orderBy(customers.code);
  return rows.map((r) => ({ ...customerView(ctx, r.c), orders: Number(r.orders), openOrders: Number(r.openOrders), lastOrderAt: r.lastOrderAt }));
}

/** Minimal customer list for order and quote entry (requires order-create, not customer-view). Inactive customers are not offered. */
export async function customerOptions(ctx: AuthContext) {
  if (!ctx.can("sales.quote.create")) ctx.require("sales.sales_order.create");
  const rows = await db
    .select({ id: customers.id, code: customers.code, name: customers.name, status: customers.status, shipToAddress: customers.shipToAddress, minShelfLifeDays: customers.minShelfLifeDays, defaultLeadTimeDays: customers.defaultLeadTimeDays })
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.organizationId), sql`${customers.status} <> 'inactive'`))
    .orderBy(customers.name);
  const addresses = rows.length
    ? await db
        .select()
        .from(customerAddresses)
        .where(and(inArray(customerAddresses.customerId, rows.map((r) => r.id)), isNull(customerAddresses.deletedAt)))
        .orderBy(desc(customerAddresses.isDefaultShipTo), asc(customerAddresses.label))
    : [];
  return rows.map((r) => ({
    ...r,
    addresses: addresses.filter((a) => a.customerId === r.id).map((a) => ({ id: a.id, label: a.label, text: formatAddress(a), isDefaultShipTo: a.isDefaultShipTo, isDefaultBillTo: a.isDefaultBillTo })),
  }));
}

export async function listAddresses(q: DbOrTx, customerId: string) {
  return q
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId), isNull(customerAddresses.deletedAt)))
    .orderBy(desc(customerAddresses.isDefaultShipTo), desc(customerAddresses.isDefaultBillTo), asc(customerAddresses.label));
}

export async function listContacts(q: DbOrTx, customerId: string) {
  return q
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), isNull(customerContacts.deletedAt)))
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.name));
}

export async function getCustomer(ctx: AuthContext, id: string) {
  ctx.require("masterdata.customer.view");
  const c = await loadCustomer(db, ctx, id);
  const shipmentRows = ctx.can("sales.shipment.view")
    ? await db
        .select({
          id: shipments.id,
          deliveryReceiptNumber: shipments.deliveryReceiptNumber,
          orderId: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          carrier: shipments.carrier,
          dispatchedAt: shipments.dispatchedAt,
          deliveredAt: shipments.deliveredAt,
          receivedByName: shipments.receivedByName,
        })
        .from(shipments)
        .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
        .where(and(eq(salesOrders.customerId, c.id), inArray(shipments.siteId, ctx.allowedSiteIds)))
        .orderBy(desc(shipments.dispatchedAt))
    : [];
  const [addresses, contacts] = await Promise.all([listAddresses(db, c.id), listContacts(db, c.id)]);
  return { customer: customerView(ctx, c), shipments: shipmentRows, addresses, contacts };
}

/** Suggests the next free CUS-nnn code (the user may change it). */
export async function suggestCustomerCode(ctx: AuthContext): Promise<string> {
  const rows = await db.select({ code: customers.code }).from(customers).where(eq(customers.organizationId, ctx.organizationId));
  let max = 0;
  for (const r of rows) {
    const m = /^CUS-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CUS-${String(max + 1).padStart(3, "0")}`;
}

const legacyAddress = (text: string): AddressInput => ({ label: "Main", line1: text, city: "" });

function addressValues(ctx: AuthContext, customerId: string, a: AddressInput) {
  return {
    organizationId: ctx.organizationId,
    customerId,
    label: a.label.trim(),
    line1: a.line1.trim(),
    line2: a.line2?.trim() || null,
    city: a.city.trim(),
    province: a.province?.trim() || null,
    postalCode: a.postalCode?.trim() || null,
    country: (a.country?.trim() || "PH").toUpperCase(),
    contactName: a.contactName?.trim() || null,
    phone: a.phone?.trim() || null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };
}

function assertCreditInput(ctx: AuthContext, input: { creditLimitAmount?: string | null; paymentTermsDays?: number | null; taxIdentifier?: string | null }) {
  const given = [input.creditLimitAmount, input.paymentTermsDays, input.taxIdentifier].some((v) => v !== undefined && v !== null && v !== "");
  if (given && !ctx.can("finance.credit_terms.approve")) {
    throw new DomainError("forbidden", "Credit limit, payment terms and tax id are set by finance (finance.credit_terms.approve).");
  }
}

/** Creates a customer; with `{ tx }` (W3C imports) it runs in a savepoint of the caller's transaction. */
export async function createCustomer(ctx: AuthContext, input: CustomerInput, opts: InTx = {}) {
  ctx.require("masterdata.customer.create");
  assertCreditInput(ctx, input);
  const shipTo = input.shipTo ?? (input.shipToAddress ? legacyAddress(input.shipToAddress) : null);
  if (!shipTo) throw new DomainError("validation", "Enter the ship-to address.", { field: "shipTo.line1" });
  return runInTx(opts, async (tx) => {
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "masterdata.customer.create", async () => {
      const [dup] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.code, input.code)))
        .limit(1);
      if (dup) throw new DomainError("conflict", `Customer code ${input.code} is already used.`, { field: "code" });
      const [row] = await tx
        .insert(customers)
        .values({
          organizationId: ctx.organizationId,
          code: input.code,
          name: input.name,
          contactName: input.contactName || null,
          phone: input.phone || null,
          email: input.email || null,
          shipToAddress: formatAddress(shipTo),
          minShelfLifeDays: input.minShelfLifeDays,
          status: input.status ?? "active",
          segment: input.segment ?? null,
          defaultLeadTimeDays: input.defaultLeadTimeDays ?? null,
          notesInternal: input.notesInternal || null,
          creditLimitAmount: input.creditLimitAmount || null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          taxIdentifier: input.taxIdentifier || null,
          updatedBy: ctx.userId,
        })
        .returning();
      const [ship] = await tx
        .insert(customerAddresses)
        .values({ ...addressValues(ctx, row.id, shipTo), isDefaultShipTo: true, isDefaultBillTo: !input.billTo })
        .returning();
      const bill = input.billTo ? (await tx.insert(customerAddresses).values({ ...addressValues(ctx, row.id, input.billTo), isDefaultBillTo: true }).returning())[0] : ship;
      if (input.contactName) {
        await tx.insert(customerContacts).values({
          organizationId: ctx.organizationId,
          customerId: row.id,
          name: input.contactName,
          phone: input.phone || null,
          email: input.email || null,
          isPrimary: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }
      await audit(tx, ctx, { action: "masterdata.customer.created", entityType: "customer", entityId: row.id, entityNumber: row.code, siteId: null, after: { ...row, shipToAddressId: ship.id, billToAddressId: bill.id } });
      return { id: row.id, code: row.code };
    });
    const [row] = await tx.select().from(customers).where(eq(customers.id, result.id));
    return row;
  });
}

export type CustomerProfileInput = {
  name: string;
  segment?: CustomerSegment | null;
  minShelfLifeDays: number;
  defaultLeadTimeDays?: number | null;
  notesInternal?: string | null;
};

/** Edits the non-sensitive profile fields (masterdata.customer.edit). */
export async function updateCustomer(ctx: AuthContext, id: string, input: CustomerProfileInput) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const before = await loadCustomer(tx, ctx, id, true);
    const patch = {
      name: input.name.trim(),
      segment: input.segment ?? null,
      minShelfLifeDays: input.minShelfLifeDays,
      defaultLeadTimeDays: input.defaultLeadTimeDays ?? null,
      notesInternal: input.notesInternal?.trim() || null,
    };
    const [after] = await tx.update(customers).set({ ...patch, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(customers.id, id)).returning();
    await audit(tx, ctx, {
      action: "masterdata.customer.updated",
      entityType: "customer",
      entityId: id,
      entityNumber: before.code,
      siteId: null,
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof CustomerRow]])),
      after: patch,
    });
    return after;
  });
}

/**
 * Sets the credit terms (US-4-01 AC1): only `finance.credit_terms.approve`; reason required; audit
 * `sales.customer.credit_terms_changed` with before/after. The tax identifier format is not validated
 * beyond length: its rules are configuration for the company's accountant (A-W3D-01).
 */
export async function setCreditTerms(ctx: AuthContext, id: string, input: { creditLimitAmount: string | null; paymentTermsDays: number | null; taxIdentifier?: string | null; reason: string }) {
  ctx.require("finance.credit_terms.approve");
  if (!input.reason?.trim() || input.reason.trim().length < 3) throw new DomainError("validation", "Give a reason for the change.", { field: "reason" });
  if (input.creditLimitAmount !== null && !/^\d{1,14}(\.\d{1,2})?$/.test(input.creditLimitAmount)) throw new DomainError("validation", "Credit limit in pesos, up to 2 decimals.", { field: "creditLimitAmount" });
  if (input.paymentTermsDays !== null && (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365)) {
    throw new DomainError("validation", "Payment terms: 0 to 365 days.", { field: "paymentTermsDays" });
  }
  return db.transaction(async (tx) => {
    const before = await loadCustomer(tx, ctx, id, true);
    const patch = {
      creditLimitAmount: input.creditLimitAmount,
      paymentTermsDays: input.paymentTermsDays,
      taxIdentifier: input.taxIdentifier === undefined ? before.taxIdentifier : input.taxIdentifier?.trim() || null,
    };
    await tx.update(customers).set({ ...patch, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(customers.id, id));
    await audit(tx, ctx, {
      action: "sales.customer.credit_terms_changed",
      entityType: "customer",
      entityId: id,
      entityNumber: before.code,
      siteId: null,
      reason: input.reason.trim(),
      before: { creditLimitAmount: before.creditLimitAmount, paymentTermsDays: before.paymentTermsDays, taxIdentifier: before.taxIdentifier },
      after: patch,
    });
  });
}

/**
 * Customer status change (prospect → active, credit hold on/off, deactivate). A credit hold stops
 * every new order of the customer at credit approval (credit check failed); placing or lifting it
 * needs `finance.credit_terms.approve`.
 */
export async function setCustomerStatus(ctx: AuthContext, id: string, to: CustomerStatus, reason: string) {
  if (!ctx.can("finance.credit_terms.approve")) ctx.require("masterdata.customer.edit");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason for the status change.", { field: "reason" });
  return db.transaction(async (tx) => {
    const c = await loadCustomer(tx, ctx, id, true);
    const from = c.status as CustomerStatus;
    if (!(CUSTOMER_TRANSITIONS[from] ?? []).includes(to)) {
      throw new DomainError("state", `${c.name} is ${CUSTOMER_STATUS_LABEL[from] ?? from} and cannot become ${CUSTOMER_STATUS_LABEL[to] ?? to}.`, { machine: "customer", from, to });
    }
    // Credit hold on/off is a finance decision; every other move is customer master maintenance.
    if (CREDIT_HOLD_MOVES.includes(`${from}>${to}`)) ctx.require("finance.credit_terms.approve");
    else ctx.require("masterdata.customer.edit");
    await tx.update(customers).set({ status: to, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(customers.id, id));
    await audit(tx, ctx, {
      action: to === "on_hold" ? "sales.customer.credit_hold_placed" : from === "on_hold" ? "sales.customer.credit_hold_lifted" : "masterdata.customer.status_changed",
      entityType: "customer",
      entityId: id,
      entityNumber: c.code,
      siteId: null,
      reason: reason.trim(),
      before: { status: from },
      after: { status: to },
    });
  });
}

/* ------------------------------------------------------------------ addresses */

async function syncDefaultShipTo(tx: Tx, ctx: AuthContext, customerId: string) {
  const [def] = await tx
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.isDefaultShipTo, true), isNull(customerAddresses.deletedAt)))
    .limit(1);
  if (def) await tx.update(customers).set({ shipToAddress: formatAddress(def), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(customers.id, customerId));
}

async function loadAddress(tx: Tx, ctx: AuthContext, addressId: string) {
  if (!isUuid(addressId)) throw new DomainError("not_found", "Address not found.");
  const [a] = await tx
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.id, addressId), eq(customerAddresses.organizationId, ctx.organizationId), isNull(customerAddresses.deletedAt)))
    .limit(1);
  if (!a) throw new DomainError("not_found", "Address not found.");
  return a;
}

export async function addAddress(ctx: AuthContext, customerId: string, input: AddressInput & { makeDefaultShipTo?: boolean; makeDefaultBillTo?: boolean }) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const c = await loadCustomer(tx, ctx, customerId, true);
    if (input.makeDefaultShipTo) await tx.update(customerAddresses).set({ isDefaultShipTo: false }).where(and(eq(customerAddresses.customerId, c.id), eq(customerAddresses.isDefaultShipTo, true)));
    if (input.makeDefaultBillTo) await tx.update(customerAddresses).set({ isDefaultBillTo: false }).where(and(eq(customerAddresses.customerId, c.id), eq(customerAddresses.isDefaultBillTo, true)));
    const [a] = await tx
      .insert(customerAddresses)
      .values({ ...addressValues(ctx, c.id, input), isDefaultShipTo: !!input.makeDefaultShipTo, isDefaultBillTo: !!input.makeDefaultBillTo })
      .returning();
    await syncDefaultShipTo(tx, ctx, c.id);
    await audit(tx, ctx, { action: "masterdata.customer_address.created", entityType: "customer_address", entityId: a.id, entityNumber: c.code, siteId: null, after: a });
    return a;
  });
}

export async function updateAddress(ctx: AuthContext, addressId: string, input: AddressInput) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const before = await loadAddress(tx, ctx, addressId);
    await loadCustomer(tx, ctx, before.customerId, true);
    const v = addressValues(ctx, before.customerId, input);
    const [after] = await tx
      .update(customerAddresses)
      .set({ label: v.label, line1: v.line1, line2: v.line2, city: v.city, province: v.province, postalCode: v.postalCode, country: v.country, contactName: v.contactName, phone: v.phone, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(customerAddresses.id, addressId))
      .returning();
    await syncDefaultShipTo(tx, ctx, before.customerId);
    await audit(tx, ctx, { action: "masterdata.customer_address.updated", entityType: "customer_address", entityId: addressId, siteId: null, before, after });
    return after;
  });
}

/** Makes an address the default ship-to or bill-to (the previous default stays as a normal address). */
export async function setDefaultAddress(ctx: AuthContext, addressId: string, kind: "ship_to" | "bill_to") {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const a = await loadAddress(tx, ctx, addressId);
    await loadCustomer(tx, ctx, a.customerId, true);
    const col = kind === "ship_to" ? customerAddresses.isDefaultShipTo : customerAddresses.isDefaultBillTo;
    await tx.update(customerAddresses).set(kind === "ship_to" ? { isDefaultShipTo: false } : { isDefaultBillTo: false }).where(and(eq(customerAddresses.customerId, a.customerId), eq(col, true)));
    await tx.update(customerAddresses).set(kind === "ship_to" ? { isDefaultShipTo: true, updatedBy: ctx.userId } : { isDefaultBillTo: true, updatedBy: ctx.userId }).where(eq(customerAddresses.id, a.id));
    await syncDefaultShipTo(tx, ctx, a.customerId);
    await audit(tx, ctx, { action: "masterdata.customer_address.default_changed", entityType: "customer_address", entityId: a.id, siteId: null, after: { kind } });
  });
}

/** Removes an address; the default ship-to or bill-to cannot be removed (choose another default first). */
export async function removeAddress(ctx: AuthContext, addressId: string) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const a = await loadAddress(tx, ctx, addressId);
    if (a.isDefaultShipTo || a.isDefaultBillTo) {
      throw new DomainError("state", "This is the default ship-to or bill-to address. Make another address the default first; a customer always keeps one of each.");
    }
    await tx.update(customerAddresses).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(eq(customerAddresses.id, a.id));
    await audit(tx, ctx, { action: "masterdata.customer_address.removed", entityType: "customer_address", entityId: a.id, siteId: null, before: a });
  });
}

/* ------------------------------------------------------------------ contacts */

export type ContactInput = { name: string; email?: string | null; phone?: string | null; roleLabel?: string | null; isPrimary?: boolean };

async function syncPrimaryContact(tx: Tx, ctx: AuthContext, customerId: string) {
  const [p] = await tx
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true), isNull(customerContacts.deletedAt)))
    .limit(1);
  await tx
    .update(customers)
    .set({ contactName: p?.name ?? null, phone: p?.phone ?? null, email: p?.email ?? null, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(customers.id, customerId));
}

export async function addContact(ctx: AuthContext, customerId: string, input: ContactInput) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const c = await loadCustomer(tx, ctx, customerId, true);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(customerContacts).where(and(eq(customerContacts.customerId, c.id), isNull(customerContacts.deletedAt), eq(customerContacts.isPrimary, true)));
    const primary = input.isPrimary || Number(n) === 0;
    if (primary) await tx.update(customerContacts).set({ isPrimary: false }).where(and(eq(customerContacts.customerId, c.id), eq(customerContacts.isPrimary, true)));
    const [row] = await tx
      .insert(customerContacts)
      .values({ organizationId: ctx.organizationId, customerId: c.id, name: input.name.trim(), email: input.email?.trim() || null, phone: input.phone?.trim() || null, roleLabel: input.roleLabel?.trim() || null, isPrimary: primary, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await syncPrimaryContact(tx, ctx, c.id);
    await audit(tx, ctx, { action: "masterdata.customer_contact.created", entityType: "customer_contact", entityId: row.id, entityNumber: c.code, siteId: null, after: { id: row.id, name: row.name, roleLabel: row.roleLabel, isPrimary: row.isPrimary } });
    return row;
  });
}

async function loadContact(tx: Tx, ctx: AuthContext, contactId: string) {
  if (!isUuid(contactId)) throw new DomainError("not_found", "Contact not found.");
  const [k] = await tx
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.id, contactId), eq(customerContacts.organizationId, ctx.organizationId), isNull(customerContacts.deletedAt)))
    .limit(1);
  if (!k) throw new DomainError("not_found", "Contact not found.");
  return k;
}

export async function makePrimaryContact(ctx: AuthContext, contactId: string) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const k = await loadContact(tx, ctx, contactId);
    await loadCustomer(tx, ctx, k.customerId, true);
    await tx.update(customerContacts).set({ isPrimary: false }).where(and(eq(customerContacts.customerId, k.customerId), eq(customerContacts.isPrimary, true)));
    await tx.update(customerContacts).set({ isPrimary: true, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(customerContacts.id, k.id));
    await syncPrimaryContact(tx, ctx, k.customerId);
    await audit(tx, ctx, { action: "masterdata.customer_contact.updated", entityType: "customer_contact", entityId: k.id, siteId: null, after: { isPrimary: true } });
  });
}

export async function removeContact(ctx: AuthContext, contactId: string) {
  ctx.require("masterdata.customer.edit");
  return db.transaction(async (tx) => {
    const k = await loadContact(tx, ctx, contactId);
    await loadCustomer(tx, ctx, k.customerId, true);
    await tx.update(customerContacts).set({ deletedAt: new Date(), deletedBy: ctx.userId, isPrimary: false }).where(eq(customerContacts.id, k.id));
    if (k.isPrimary) {
      const [next] = await tx.select().from(customerContacts).where(and(eq(customerContacts.customerId, k.customerId), isNull(customerContacts.deletedAt))).orderBy(asc(customerContacts.createdAt)).limit(1);
      if (next) await tx.update(customerContacts).set({ isPrimary: true }).where(eq(customerContacts.id, next.id));
    }
    await syncPrimaryContact(tx, ctx, k.customerId);
    await audit(tx, ctx, { action: "masterdata.customer_contact.removed", entityType: "customer_contact", entityId: k.id, siteId: null, before: { name: k.name, roleLabel: k.roleLabel } });
  });
}

/* ------------------------------------------------------------------ export */

type CustomerExportRow = Awaited<ReturnType<typeof listCustomers>>[number] & { creditLimitAmount?: string | null; paymentTermsDays?: number | null; taxIdentifier?: string | null };

/** Customer list export (masterdata.customer.export, S): credit columns are dropped without finance.credit_terms.view. */
export const customersExport: ExportDefinition<{ q?: string; status?: string }, CustomerExportRow> = {
  code: "masterdata.customers",
  title: "Customers",
  permission: "masterdata.customer.export",
  sensitivity: "S",
  columns: [
    { header: "Code", value: (r) => r.code },
    { header: "Name", value: (r) => r.name },
    { header: "Status", value: (r) => r.status },
    { header: "Segment", value: (r) => r.segment },
    { header: "Contact", value: (r) => r.contactName, personalData: true },
    { header: "Phone", value: (r) => r.phone, personalData: true },
    { header: "Email", value: (r) => r.email, personalData: true },
    { header: "Ship to", value: (r) => r.shipToAddress },
    { header: "Min shelf life (days)", value: (r) => r.minShelfLifeDays, numeric: true },
    { header: "Default lead time (days)", value: (r) => r.defaultLeadTimeDays, numeric: true },
    { header: "Credit limit", value: (r) => r.creditLimitAmount, numeric: true, requires: "finance.credit_terms.view" },
    { header: "Payment terms (days)", value: (r) => r.paymentTermsDays, numeric: true, requires: "finance.credit_terms.view" },
    { header: "Tax identifier", value: (r) => r.taxIdentifier, requires: "finance.credit_terms.view" },
    { header: "Orders (your sites)", value: (r) => r.orders, numeric: true },
  ],
  fetch: async (ctx, f, limit) => (await listCustomers(ctx, f)).slice(0, limit) as CustomerExportRow[],
  siteScope: () => [],
  fileName: () => "customers",
};
