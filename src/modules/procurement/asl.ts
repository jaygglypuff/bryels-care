import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { fileAttachments, materials, supplierMaterialChanges, supplierMaterials, suppliers, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type InTx, runInTx } from "@/lib/tx";
import { canSeePrices, cleanText, isUuid, money4, optDate, optDecimal, requireReason, toBase } from "./shared";

/**
 * Approved-supplier list, supplier prices, lead times and MOQ (US-6-01, W04-11, V-ASL).
 *
 * - Procurement proposes a supplier × material pair or a suspension (`masterdata.supplier.edit`).
 * - QA decides (`masterdata.supplier.approve`); the decider is never the proposer (SoD, ruling 87).
 *   The decided state lands on `supplier_materials` (`is_approved`, `requested_by`, `approved_by`);
 *   every proposal and decision is kept in `supplier_material_changes` and audited as
 *   `masterdata.supplier.asl_changed`.
 * - Prices, MOQ and lead times are cost terms (`masterdata.supplier_price.edit`); prices are shown only
 *   with `masterdata.supplier_price.view` (§6 of the permissions matrix).
 * - `assertAslApproved` is the V-ASL check used by purchase order lines.
 */

const ACTION_LABEL = { approve: "Add to the approved list", suspend: "Suspend" } as const;

type Sm = typeof supplierMaterials.$inferSelect;

async function lockPair(tx: Tx, ctx: AuthContext, supplierMaterialId: string) {
  if (!isUuid(supplierMaterialId)) throw new DomainError("not_found", "Approved-list entry not found.");
  const [sm] = await tx
    .select()
    .from(supplierMaterials)
    .where(and(eq(supplierMaterials.id, supplierMaterialId), eq(supplierMaterials.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!sm) throw new DomainError("not_found", "Approved-list entry not found.");
  return sm;
}

async function pairLabel(q: DbOrTx, sm: Pick<Sm, "supplierId" | "materialId">) {
  const [s] = await q.select({ code: suppliers.code, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, sm.supplierId));
  const [m] = await q.select({ code: materials.code, name: materials.name }).from(materials).where(eq(materials.id, sm.materialId));
  return { supplier: s, material: m, label: `${s?.code ?? "?"} × ${m?.code ?? "?"}` };
}

async function assertEvidence(q: DbOrTx, ctx: AuthContext, id: string | null | undefined) {
  if (!id) return null;
  if (!isUuid(id)) throw new DomainError("validation", "Choose an uploaded evidence file.", { field: "evidenceAttachmentId" });
  const [f] = await q.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.id, id), eq(fileAttachments.organizationId, ctx.organizationId))).limit(1);
  if (!f) throw new DomainError("validation", "The evidence file was not found.", { field: "evidenceAttachmentId" });
  return f.id;
}

/** Rows of a supplier's approved-material list with the pending proposal (prices masked without supplier_price.view). */
export async function listSupplierMaterials(ctx: AuthContext, supplierId: string) {
  ctx.require("masterdata.supplier.view");
  if (!isUuid(supplierId)) throw new DomainError("not_found", "Supplier not found.");
  const rows = await db
    .select({ sm: supplierMaterials, materialCode: materials.code, materialName: materials.name, baseUom: materials.baseUom, materialStatus: materials.status })
    .from(supplierMaterials)
    .innerJoin(materials, eq(materials.id, supplierMaterials.materialId))
    .where(and(eq(supplierMaterials.supplierId, supplierId), eq(supplierMaterials.organizationId, ctx.organizationId)))
    .orderBy(asc(materials.code));
  const ids = rows.map((r) => r.sm.id);
  const changes = ids.length
    ? await db
        .select({ c: supplierMaterialChanges, proposedByName: users.displayName })
        .from(supplierMaterialChanges)
        .innerJoin(users, eq(users.id, supplierMaterialChanges.proposedBy))
        .where(inArray(supplierMaterialChanges.supplierMaterialId, ids))
        .orderBy(desc(supplierMaterialChanges.proposedAt))
    : [];
  const prices = canSeePrices(ctx);
  return rows.map((r) => {
    const pending = changes.find((c) => c.c.supplierMaterialId === r.sm.id && c.c.status === "pending");
    return {
      id: r.sm.id,
      materialId: r.sm.materialId,
      materialCode: r.materialCode,
      materialName: r.materialName,
      baseUom: r.baseUom,
      supplierPartNumber: r.sm.supplierPartNumber,
      isApproved: r.sm.isApproved,
      approvedAt: r.sm.approvedAt,
      auditDate: r.sm.auditDate,
      suspendedReason: r.sm.suspendedReason,
      leadTimeDays: r.sm.leadTimeDays,
      moqQty: r.sm.moqQty,
      moqUom: r.sm.moqUom,
      unitPrice: prices ? r.sm.unitPrice : undefined,
      priceUom: r.sm.priceUom,
      currency: prices ? r.sm.currency : undefined,
      priceEffectiveFrom: prices ? r.sm.priceEffectiveFrom : undefined,
      pending: pending ? { id: pending.c.id, action: pending.c.action as keyof typeof ACTION_LABEL, note: pending.c.note, proposedBy: pending.c.proposedBy, proposedByName: pending.proposedByName, proposedAt: pending.c.proposedAt } : null,
      history: changes
        .filter((c) => c.c.supplierMaterialId === r.sm.id && c.c.status !== "pending")
        .slice(0, 5)
        .map((c) => ({ id: c.c.id, action: c.c.action, status: c.c.status, note: c.c.note, decisionNote: c.c.decisionNote, proposedByName: c.proposedByName, decidedAt: c.c.decidedAt })),
    };
  });
}

/** Pending ASL proposals across suppliers (QA queue). */
export async function listAslQueue(ctx: AuthContext) {
  ctx.require("masterdata.supplier.view");
  const rows = await db
    .select({ c: supplierMaterialChanges, supplierId: suppliers.id, supplierCode: suppliers.code, supplierName: suppliers.name, supplierStatus: suppliers.qualityStatus, materialCode: materials.code, materialName: materials.name, proposedByName: users.displayName })
    .from(supplierMaterialChanges)
    .innerJoin(supplierMaterials, eq(supplierMaterials.id, supplierMaterialChanges.supplierMaterialId))
    .innerJoin(suppliers, eq(suppliers.id, supplierMaterials.supplierId))
    .innerJoin(materials, eq(materials.id, supplierMaterials.materialId))
    .innerJoin(users, eq(users.id, supplierMaterialChanges.proposedBy))
    .where(and(eq(supplierMaterialChanges.organizationId, ctx.organizationId), eq(supplierMaterialChanges.status, "pending")))
    .orderBy(asc(supplierMaterialChanges.proposedAt));
  return rows.map((r) => ({ ...r.c, supplierId: r.supplierId, supplierCode: r.supplierCode, supplierName: r.supplierName, supplierStatus: r.supplierStatus, materialCode: r.materialCode, materialName: r.materialName, proposedByName: r.proposedByName, actionLabel: ACTION_LABEL[r.c.action as keyof typeof ACTION_LABEL] }));
}

export type ProposeInput = { supplierId: string; materialId: string; supplierPartNumber?: string | null; note: string; auditDate?: string | null; evidenceAttachmentId?: string | null };

/**
 * Procurement proposes a supplier × material pair for the approved list (creates the row, not approved)
 * or re-proposes a suspended pair. `opts.tx`: inside an import chunk (savepoint).
 */
export async function proposeSupplierMaterial(ctx: AuthContext, input: ProposeInput, opts?: InTx) {
  ctx.require("masterdata.supplier.edit");
  ctx.assertWritable();
  const note = requireReason(input.note, "note");
  const auditDate = optDate(input.auditDate, "auditDate", "Audit date");
  const partNo = cleanText(input.supplierPartNumber, 80, "supplierPartNumber", "Supplier part number");
  if (!isUuid(input.supplierId)) throw new DomainError("validation", "Choose a supplier.", { field: "supplierId" });
  if (!isUuid(input.materialId)) throw new DomainError("validation", "Choose a material.", { field: "materialId" });
  return runInTx(opts, async (tx) => {
    const [s] = await tx.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
    if (!s) throw new DomainError("validation", "Choose a supplier.", { field: "supplierId" });
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.organizationId))).limit(1);
    if (!m) throw new DomainError("validation", "Choose a material.", { field: "materialId" });
    const evidence = await assertEvidence(tx, ctx, input.evidenceAttachmentId);
    let [sm] = await tx.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, s.id), eq(supplierMaterials.materialId, m.id))).for("update").limit(1);
    if (sm?.isApproved) throw new DomainError("conflict", `${m.code} is already on the approved list of ${s.name}.`, { field: "materialId" });
    if (!sm) {
      [sm] = await tx.insert(supplierMaterials).values({ organizationId: ctx.organizationId, supplierId: s.id, materialId: m.id, supplierPartNumber: partNo, isApproved: false, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    } else if (partNo && partNo !== sm.supplierPartNumber) {
      await tx.update(supplierMaterials).set({ supplierPartNumber: partNo, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(supplierMaterials.id, sm.id));
    }
    const [pending] = await tx.select({ id: supplierMaterialChanges.id }).from(supplierMaterialChanges).where(and(eq(supplierMaterialChanges.supplierMaterialId, sm.id), eq(supplierMaterialChanges.status, "pending"))).limit(1);
    if (pending) throw new DomainError("conflict", `A proposal for ${s.code} × ${m.code} is already waiting for QA.`);
    const [c] = await tx
      .insert(supplierMaterialChanges)
      .values({ organizationId: ctx.organizationId, supplierMaterialId: sm.id, action: "approve", proposedBy: ctx.userId, note, auditDate, evidenceAttachmentId: evidence })
      .returning();
    await audit(tx, ctx, {
      action: "masterdata.supplier.asl_proposed",
      entityType: "supplier",
      entityId: s.id,
      entityNumber: s.code,
      siteId: null,
      reason: note,
      after: { supplierMaterialId: sm.id, material: m.code, action: "approve", changeId: c.id },
    });
    return { supplierMaterialId: sm.id, changeId: c.id };
  });
}

/** Procurement proposes suspending an approved pair (or re-approving a suspended one). */
export async function proposeAslChange(ctx: AuthContext, input: { supplierMaterialId: string; action: "approve" | "suspend"; note: string; auditDate?: string | null; evidenceAttachmentId?: string | null }) {
  ctx.require("masterdata.supplier.edit");
  ctx.assertWritable();
  if (input.action !== "approve" && input.action !== "suspend") throw new DomainError("validation", "Choose approve or suspend.", { field: "action" });
  const note = requireReason(input.note, "note");
  const auditDate = optDate(input.auditDate, "auditDate", "Audit date");
  return db.transaction(async (tx) => {
    const sm = await lockPair(tx, ctx, input.supplierMaterialId);
    const { label, supplier } = await pairLabel(tx, sm);
    if (input.action === "approve" && sm.isApproved) throw new DomainError("state", `${label} is already approved.`);
    if (input.action === "suspend" && !sm.isApproved) throw new DomainError("state", `${label} is not on the approved list.`);
    const [pending] = await tx.select({ id: supplierMaterialChanges.id }).from(supplierMaterialChanges).where(and(eq(supplierMaterialChanges.supplierMaterialId, sm.id), eq(supplierMaterialChanges.status, "pending"))).limit(1);
    if (pending) throw new DomainError("conflict", `A proposal for ${label} is already waiting for QA.`);
    const evidence = await assertEvidence(tx, ctx, input.evidenceAttachmentId);
    const [c] = await tx.insert(supplierMaterialChanges).values({ organizationId: ctx.organizationId, supplierMaterialId: sm.id, action: input.action, proposedBy: ctx.userId, note, auditDate, evidenceAttachmentId: evidence }).returning();
    await audit(tx, ctx, { action: "masterdata.supplier.asl_proposed", entityType: "supplier", entityId: sm.supplierId, entityNumber: supplier?.code, siteId: null, reason: note, after: { supplierMaterialId: sm.id, action: input.action, changeId: c.id } });
    return { changeId: c.id };
  });
}

/**
 * QA decides a pending proposal (G-W04-C). Approving an `approve` proposal puts the pair on the list;
 * approving a `suspend` proposal takes it off (PO lines for it are refused from then on, V-ASL).
 */
export async function decideAslChange(ctx: AuthContext, input: { changeId: string; decision: "approved" | "rejected"; note?: string | null }) {
  ctx.require("masterdata.supplier.approve");
  ctx.assertWritable();
  if (input.decision !== "approved" && input.decision !== "rejected") throw new DomainError("validation", "Choose approve or reject.", { field: "decision" });
  if (!isUuid(input.changeId)) throw new DomainError("not_found", "Proposal not found.");
  const note = input.decision === "rejected" ? requireReason(input.note, "note") : cleanText(input.note, 1000, "note", "Note");
  return db.transaction(async (tx) => {
    const [c0] = await tx.select().from(supplierMaterialChanges).where(and(eq(supplierMaterialChanges.id, input.changeId), eq(supplierMaterialChanges.organizationId, ctx.organizationId))).limit(1);
    if (!c0) throw new DomainError("not_found", "Proposal not found.");
    const sm = await lockPair(tx, ctx, c0.supplierMaterialId);
    const [c] = await tx.select().from(supplierMaterialChanges).where(eq(supplierMaterialChanges.id, c0.id)).for("update").limit(1);
    if (c.status !== "pending") throw new DomainError("state", "This proposal was already decided or withdrawn.");
    if (c.proposedBy === ctx.userId) {
      throw new DomainError("separation_of_duties", "You proposed this approved-list change, so another QA person must decide it (separation of duties).", { code: "SEPARATION_OF_DUTIES" });
    }
    const now = new Date();
    await tx.update(supplierMaterialChanges).set({ status: input.decision, decidedBy: ctx.userId, decidedAt: now, decisionNote: note }).where(eq(supplierMaterialChanges.id, c.id));
    const before = { isApproved: sm.isApproved, suspendedReason: sm.suspendedReason };
    if (input.decision === "approved") {
      const approve = c.action === "approve";
      await tx
        .update(supplierMaterials)
        .set({
          isApproved: approve,
          requestedBy: c.proposedBy,
          requestedAt: c.proposedAt,
          approvedBy: ctx.userId,
          approvedAt: now,
          auditDate: c.auditDate ?? sm.auditDate,
          evidenceAttachmentId: c.evidenceAttachmentId ?? sm.evidenceAttachmentId,
          suspendedReason: approve ? null : c.note,
          updatedAt: now,
          updatedBy: ctx.userId,
        })
        .where(eq(supplierMaterials.id, sm.id));
    }
    const { label, supplier, material } = await pairLabel(tx, sm);
    await audit(tx, ctx, {
      action: "masterdata.supplier.asl_changed",
      entityType: "supplier",
      entityId: sm.supplierId,
      entityNumber: supplier?.code,
      siteId: null,
      reason: note ?? c.note,
      before,
      after: { supplierMaterialId: sm.id, material: material?.code, proposal: c.action, decision: input.decision, isApproved: input.decision === "approved" ? c.action === "approve" : sm.isApproved, proposedBy: c.proposedBy },
    });
    return { supplierMaterialId: sm.id, label, isApproved: input.decision === "approved" ? c.action === "approve" : sm.isApproved };
  });
}

/** The proposer withdraws a pending proposal. */
export async function withdrawAslChange(ctx: AuthContext, input: { changeId: string }) {
  ctx.require("masterdata.supplier.edit");
  if (!isUuid(input.changeId)) throw new DomainError("not_found", "Proposal not found.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(supplierMaterialChanges).where(and(eq(supplierMaterialChanges.id, input.changeId), eq(supplierMaterialChanges.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!c) throw new DomainError("not_found", "Proposal not found.");
    if (c.status !== "pending") throw new DomainError("state", "This proposal was already decided or withdrawn.");
    if (c.proposedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who proposed the change can withdraw it.");
    await tx.update(supplierMaterialChanges).set({ status: "withdrawn" }).where(eq(supplierMaterialChanges.id, c.id));
    const [sm] = await tx.select().from(supplierMaterials).where(eq(supplierMaterials.id, c.supplierMaterialId));
    await audit(tx, ctx, { action: "masterdata.supplier.asl_withdrawn", entityType: "supplier", entityId: sm.supplierId, siteId: null, after: { changeId: c.id, supplierMaterialId: sm.id } });
    return { changeId: c.id };
  });
}

export type TermsInput = {
  supplierMaterialId: string;
  supplierPartNumber?: string | null;
  leadTimeDays?: string | number | null;
  moqQty?: string | null;
  moqUom?: string | null;
  unitPrice?: string | null;
  priceUom?: string | null;
  currency?: string | null;
  priceEffectiveFrom?: string | null;
};

/**
 * Cost terms of a pair: price per unit, MOQ, lead time (masterdata.supplier_price.edit). Units must convert
 * to the material's base unit (V-UOM). Old values are kept in the audit event (before/after).
 */
export async function updateSupplierTerms(ctx: AuthContext, input: TermsInput, opts?: InTx) {
  ctx.require("masterdata.supplier_price.edit");
  ctx.assertWritable();
  return runInTx(opts, async (tx) => {
    const sm = await lockPair(tx, ctx, input.supplierMaterialId);
    const [mat] = await tx.select().from(materials).where(eq(materials.id, sm.materialId));
    let leadTimeDays: number | null = null;
    if (input.leadTimeDays !== null && input.leadTimeDays !== undefined && String(input.leadTimeDays).trim() !== "") {
      leadTimeDays = Number(input.leadTimeDays);
      if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 365) throw new DomainError("validation", "Lead time must be a whole number of days from 0 to 365.", { field: "leadTimeDays" });
    }
    const moqQty = optDecimal(input.moqQty, "moqQty", "MOQ");
    const moqUom = moqQty ? (input.moqUom || mat.baseUom).trim() : null;
    if (moqQty && moqUom && !(await toBase(tx, ctx.organizationId, mat, moqQty, moqUom))) throw new DomainError("validation", `${moqUom} cannot be converted to ${mat.code}'s base unit ${mat.baseUom}.`, { field: "moqUom" });
    const unitPrice = optDecimal(input.unitPrice, "unitPrice", "Unit price", { dp: 4, allowZero: true });
    const priceUom = unitPrice ? (input.priceUom || mat.baseUom).trim() : null;
    if (unitPrice && priceUom && !(await toBase(tx, ctx.organizationId, mat, new Decimal(1), priceUom))) throw new DomainError("validation", `${priceUom} cannot be converted to ${mat.code}'s base unit ${mat.baseUom}.`, { field: "priceUom" });
    const currency = unitPrice ? (input.currency || "PHP").trim().toUpperCase() : null;
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new DomainError("validation", "Use a three-letter currency code, e.g. PHP.", { field: "currency" });
    const priceEffectiveFrom = unitPrice ? optDate(input.priceEffectiveFrom, "priceEffectiveFrom", "Price effective from") : null;
    const partNo = cleanText(input.supplierPartNumber, 80, "supplierPartNumber", "Supplier part number");
    const next = {
      supplierPartNumber: partNo,
      leadTimeDays,
      moqQty: moqQty?.toString() ?? null,
      moqUom,
      unitPrice: unitPrice ? money4(unitPrice) : null,
      priceUom,
      currency,
      priceEffectiveFrom,
    };
    await tx.update(supplierMaterials).set({ ...next, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(supplierMaterials.id, sm.id));
    const { supplier, material } = await pairLabel(tx, sm);
    await audit(tx, ctx, {
      action: "masterdata.supplier_price.updated",
      entityType: "supplier",
      entityId: sm.supplierId,
      entityNumber: supplier?.code,
      siteId: null,
      before: { supplierMaterialId: sm.id, material: material?.code, supplierPartNumber: sm.supplierPartNumber, leadTimeDays: sm.leadTimeDays, moqQty: sm.moqQty, moqUom: sm.moqUom, unitPrice: sm.unitPrice, priceUom: sm.priceUom, currency: sm.currency, priceEffectiveFrom: sm.priceEffectiveFrom },
      after: { supplierMaterialId: sm.id, material: material?.code, ...next },
    });
    return { supplierMaterialId: sm.id };
  });
}

/**
 * V-ASL (docs/process-maps.md §1.5): the supplier must be active and not suspended, and the pair must
 * be on the approved list. Returns the pair row (price, MOQ, lead time) for PO lines.
 */
export async function assertAslApproved(q: DbOrTx, organizationId: string, supplierId: string, materialId: string, field = "materialId") {
  const [s] = await q.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId))).limit(1);
  if (!s) throw new DomainError("validation", "Choose a supplier.", { field: "supplierId" });
  if (!s.isActive) throw new DomainError("validation", `Supplier ${s.name} is inactive (V-ASL).`, { field: "supplierId", rule: "V-ASL" });
  if (s.qualityStatus === "suspended") {
    throw new DomainError("validation", `Supplier ${s.name} is suspended${s.qualityStatusReason ? ` (${s.qualityStatusReason})` : ""}; no purchase order lines can be added (V-ASL).`, { field: "supplierId", rule: "V-ASL" });
  }
  const [sm] = await q.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, supplierId), eq(supplierMaterials.materialId, materialId))).limit(1);
  if (!sm || !sm.isApproved) {
    const [m] = await q.select({ code: materials.code }).from(materials).where(eq(materials.id, materialId));
    throw new DomainError("validation", `${m?.code ?? "This material"} is not on the approved-supplier list of ${s.name}${sm?.suspendedReason ? ` (suspended: ${sm.suspendedReason})` : ""}. Ask QA to approve the pair first (V-ASL).`, { field, rule: "V-ASL" });
  }
  return { supplier: s, supplierMaterial: sm };
}

/** Approved materials of a supplier for PO line pickers (prices masked without supplier_price.view). */
export async function approvedMaterialsFor(ctx: AuthContext, supplierId: string) {
  ctx.require("masterdata.supplier.view");
  if (!isUuid(supplierId)) return [];
  const rows = await db
    .select({ sm: supplierMaterials, code: materials.code, name: materials.name, baseUom: materials.baseUom })
    .from(supplierMaterials)
    .innerJoin(materials, eq(materials.id, supplierMaterials.materialId))
    .where(and(eq(supplierMaterials.supplierId, supplierId), eq(supplierMaterials.organizationId, ctx.organizationId), eq(supplierMaterials.isApproved, true), eq(materials.status, "active")))
    .orderBy(asc(materials.code));
  const prices = canSeePrices(ctx);
  return rows.map((r) => ({
    supplierMaterialId: r.sm.id,
    materialId: r.sm.materialId,
    code: r.code,
    name: r.name,
    baseUom: r.baseUom,
    leadTimeDays: r.sm.leadTimeDays,
    moqQty: r.sm.moqQty,
    moqUom: r.sm.moqUom,
    priceUom: r.sm.priceUom,
    unitPrice: prices ? r.sm.unitPrice : undefined,
    currency: prices ? r.sm.currency : undefined,
  }));
}

/** Price of `qty uom` from the pair's price per `price_uom` (both converted through the base unit). */
export async function priceFor(q: DbOrTx, organizationId: string, mat: typeof materials.$inferSelect, sm: Sm, uom: string): Promise<Decimal | null> {
  if (!sm.unitPrice || !sm.priceUom) return null;
  const perPriceUnit = await toBase(q, organizationId, mat, new Decimal(1), sm.priceUom);
  const perEntered = await toBase(q, organizationId, mat, new Decimal(1), uom);
  if (!perPriceUnit || !perEntered || perPriceUnit.isZero()) return null;
  return new Decimal(sm.unitPrice).mul(perEntered).div(perPriceUnit).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Whether an MOQ is met by `qtyBase` (null when the pair has no MOQ). */
export async function moqShortfall(q: DbOrTx, organizationId: string, mat: typeof materials.$inferSelect, sm: Sm, qtyBase: Decimal): Promise<{ moqBase: Decimal; short: boolean } | null> {
  if (!sm.moqQty || !sm.moqUom) return null;
  const moqBase = await toBase(q, organizationId, mat, new Decimal(sm.moqQty), sm.moqUom);
  if (!moqBase) return null;
  return { moqBase, short: qtyBase.lt(moqBase) };
}

/** Active materials for the "propose a pair" picker (masterdata.supplier.edit). */
export async function aslMaterialOptions(ctx: AuthContext) {
  ctx.require("masterdata.supplier.edit");
  return db.select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom }).from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.status, "active"))).orderBy(asc(materials.code));
}
