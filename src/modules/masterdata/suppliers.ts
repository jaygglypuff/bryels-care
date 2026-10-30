import "server-only";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { goodsReceipts, supplierMaterials, suppliers, materials } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { toCsv } from "./csv";
import { SUPPLIER_QUALITY_STATUSES, SupplierCreateSchema, SupplierInputSchema, parseOrThrow, type SupplierCreateInput, type SupplierInput } from "./supplier-schemas";
import { assignMasterCode } from "@/lib/numbering";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { runInTx, type InTx } from "@/lib/tx";
import { assertLookupValue } from "./lookups";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupplierFilter = { q?: string; status?: string; includeInactive?: boolean };

/** Suppliers are organization-wide master data (permissions-matrix §4.1); receipts shown are site-scoped. */
export async function listSuppliers(ctx: AuthContext, f: SupplierFilter = {}) {
  ctx.require("masterdata.supplier.view");
  const conds: SQL[] = [eq(suppliers.organizationId, ctx.organizationId)];
  if (!f.includeInactive) conds.push(eq(suppliers.isActive, true));
  if (f.status && (SUPPLIER_QUALITY_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(suppliers.qualityStatus, f.status));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(or(ilike(suppliers.code, like), ilike(suppliers.name, like), ilike(suppliers.contactName, like), ilike(suppliers.city, like))!);
  }
  const rows = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      city: suppliers.city,
      paymentTermsDays: suppliers.paymentTermsDays,
      defaultLeadTimeDays: suppliers.defaultLeadTimeDays,
      qualityStatus: suppliers.qualityStatus,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(and(...conds))
    .orderBy(asc(suppliers.name))
    .limit(500);
  // Receipt counts only from the caller's sites (never leak activity of other sites).
  const counts =
    rows.length && ctx.allowedSiteIds.length
      ? await db
          .select({ supplierId: goodsReceipts.supplierId, n: sql<number>`count(*)::int`, last: sql<string | null>`max(${goodsReceipts.receivedAt})::text` })
          .from(goodsReceipts)
          .where(and(inArray(goodsReceipts.siteId, ctx.allowedSiteIds), inArray(goodsReceipts.status, ["posted", "reversed"]), inArray(goodsReceipts.supplierId, rows.map((r) => r.id))))
          .groupBy(goodsReceipts.supplierId)
      : [];
  return rows.map((r) => {
    const c = counts.find((x) => x.supplierId === r.id);
    return { ...r, receipts: Number(c?.n ?? 0), lastReceiptAt: c?.last ?? null };
  });
}

/** Active suppliers for pickers (receipt form). */
export async function supplierOptions(ctx: AuthContext) {
  ctx.require("masterdata.supplier.view");
  return db
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, qualityStatus: suppliers.qualityStatus })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name));
}

export async function getSupplier(ctx: AuthContext, supplierId: string) {
  ctx.require("masterdata.supplier.view");
  if (!UUID_RE.test(supplierId)) throw new DomainError("not_found", "Supplier not found.");
  const [s] = await db.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
  if (!s) throw new DomainError("not_found", "Supplier not found.");
  const mats = await db
    .select({ id: supplierMaterials.id, materialCode: materials.code, materialName: materials.name, supplierPartNumber: supplierMaterials.supplierPartNumber, isApproved: supplierMaterials.isApproved, leadTimeDays: supplierMaterials.leadTimeDays, brand: supplierMaterials.brand, packQty: supplierMaterials.packQty, packUom: supplierMaterials.packUom })
    .from(supplierMaterials)
    .innerJoin(materials, eq(materials.id, supplierMaterials.materialId))
    .where(eq(supplierMaterials.supplierId, s.id))
    .orderBy(asc(materials.code));
  const receipts =
    ctx.can("procurement.goods_receipt.view") && ctx.allowedSiteIds.length
      ? await db
          .select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber, status: goodsReceipts.status, receivedAt: goodsReceipts.receivedAt, supplierDocumentNumber: goodsReceipts.supplierDocumentNumber })
          .from(goodsReceipts)
          .where(and(eq(goodsReceipts.supplierId, s.id), inArray(goodsReceipts.siteId, ctx.allowedSiteIds), ne(goodsReceipts.status, "cancelled")))
          .orderBy(desc(goodsReceipts.receivedAt))
          .limit(20)
      : [];
  return { ...s, materials: mats, receipts };
}

async function assertUnique(ctx: AuthContext, v: { code: string; name: string }, exceptId?: string, q: DbOrTx = db) {
  const rows = await q
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), or(eq(suppliers.code, v.code), sql`lower(${suppliers.name}) = lower(${v.name})`)));
  const clash = rows.find((r) => r.id !== exceptId);
  if (clash) {
    const field = clash.code === v.code ? "code" : "name";
    throw new DomainError("conflict", field === "code" ? `Supplier code ${v.code} is already in use.` : `A supplier named ${clash.name} already exists (${clash.code}).`, { field });
  }
}

/** `opts.tx`: run inside a caller's transaction (savepoint), e.g. an import chunk (W3C, src/lib/tx.ts). */
export async function createSupplier(ctx: AuthContext, input: SupplierCreateInput, opts?: InTx) {
  ctx.require("masterdata.supplier.create");
  const parsed = parseOrThrow(SupplierCreateSchema, input);
  if (parsed.code) await assertUnique(ctx, { code: parsed.code, name: parsed.name }, undefined, opts?.tx);
  return runInTx(opts, async (tx) => {
    // ADR-075: a blank code gets the next SUP-nnnn.
    const code =
      parsed.code ??
      (await assignMasterCode(tx, ctx.organizationId, "SUP", async (c) => (await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.code, c))).limit(1)).length > 0));
    const v = { ...parsed, code };
    if (!parsed.code) await assertUnique(ctx, v, undefined, tx);
    const category = await assertLookupValue(tx, ctx.organizationId, "supplier_category", parsed.category, { field: "category" });
    const [s] = await tx
      .insert(suppliers)
      .values({ organizationId: ctx.organizationId, ...v, category, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "masterdata.supplier.created", entityType: "supplier", entityId: s.id, entityNumber: s.code, siteId: null, after: { ...v, category, codeAssigned: !parsed.code } });
    return s;
  });
}

/**
 * Deletes a supplier that is still new (never evaluated) and used nowhere: no approved-supplier
 * list entry, purchase order, receipt, bill or payment (ADR-075). Creator or masterdata.supplier.edit.
 */
export async function deleteSupplier(ctx: AuthContext, supplierId: string) {
  if (!UUID_RE.test(supplierId)) throw new DomainError("not_found", "Supplier not found.");
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!s) throw new DomainError("not_found", "Supplier not found.");
    assertMayDeleteDraft(ctx, { create: "masterdata.supplier.create", manage: ["masterdata.supplier.edit"] }, s.createdBy, null);
    assertNeverSubmittedDraft(`Supplier ${s.code}`, s.qualityStatus === "new");
    await hardDeleteDraft(tx, ctx, { table: "suppliers", id: s.id, what: `Supplier ${s.code}`, audit: { action: "masterdata.supplier.deleted", entityType: "supplier", entityNumber: s.code, siteId: null, before: s } });
    return { deleted: s.code };
  });
}

/**
 * Updates a supplier. Changing the quality status (e.g. suspending, which blocks receipt lines under V-ASL,
 * or lifting a suspension) is recorded with before and after values.
 */
export async function updateSupplier(ctx: AuthContext, supplierId: string, input: SupplierInput) {
  ctx.require("masterdata.supplier.edit");
  const v = parseOrThrow(SupplierInputSchema, input);
  if (!UUID_RE.test(supplierId)) throw new DomainError("not_found", "Supplier not found.");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!before) throw new DomainError("not_found", "Supplier not found.");
    await assertUnique(ctx, v, before.id);
    const category = v.category === undefined ? before.category : await assertLookupValue(tx, ctx.organizationId, "supplier_category", v.category, { field: "category", keep: before.category });
    const [after] = await tx
      .update(suppliers)
      .set({ ...v, category, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(suppliers.id, before.id))
      .returning();
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of [...Object.keys(v), "category"] as (keyof typeof v)[]) {
      if (before[k] !== after[k]) changed[k] = { from: before[k], to: after[k] };
    }
    await audit(tx, ctx, {
      action: "masterdata.supplier.updated",
      entityType: "supplier",
      entityId: after.id,
      entityNumber: after.code,
      siteId: null,
      reason: changed.qualityStatus ? v.qualityStatusReason : null,
      before: Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, c.from])),
      after: Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, c.to])),
    });
    return after;
  });
}

/** CSV of the supplier list (masterdata.supplier.export); writes platform.export.created. */
export async function exportSuppliersCsv(ctx: AuthContext, f: SupplierFilter = {}) {
  ctx.require("masterdata.supplier.export");
  const rows = await listSuppliers(ctx, f);
  const csv = toCsv(
    ["Code", "Name", "Contact", "Phone", "Email", "City", "Payment terms (days)", "Lead time (days)", "Quality status", "Active"],
    rows.map((r) => [r.code, r.name, r.contactName, r.phone, r.email, r.city, r.paymentTermsDays, r.defaultLeadTimeDays, r.qualityStatus, r.isActive ? "yes" : "no"]),
  );
  await audit(db, ctx, {
    action: "platform.export.created",
    entityType: "export",
    siteId: null,
    after: { kind: "suppliers", rows: rows.length, filter: f },
  });
  return { csv, fileName: `suppliers-${new Date().toISOString().slice(0, 10)}.csv`, rows: rows.length };
}
