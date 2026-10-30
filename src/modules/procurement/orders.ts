import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { generatedDocuments } from "@/db/schema";
import {
  goodsReceiptLines,
  goodsReceipts,
  materials,
  organizations,
  purchaseOrderLines,
  purchaseOrderStateTransitions,
  purchaseOrders,
  purchaseRequestLines,
  purchaseRequests,
  sites,
  supplierMaterials,
  suppliers,
  users,
  warehouses,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { assertMayDeleteDraft, assertNeverSubmittedDraft, hardDeleteDraft } from "@/lib/draft-delete";
import { nextNumber } from "@/lib/numbering";
import { fmtDate } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { documentsForSourceRead, generateForSource, resolveTemplateVersion, type PurchaseOrderData } from "@/modules/documents";
import type { PoReceiptLine, ReceivingPoHooks } from "@/modules/inventory";
import { toCsv } from "@/modules/masterdata";
import { notifyRoles } from "@/modules/platform";
import { approvalProgress, canDecide, decisionsOf, recordDecision } from "./approvals";
import { assertAslApproved, moqShortfall, priceFor } from "./asl";
import { PO_STATUS_LABEL, type PoStatus, logCreation, transitionPo, transitionPr } from "./state";
import { addDaysIso, assertInScope, businessDate, canSeePrices, cleanText, idempotent, isUuid, money4, optDate, optDecimal, parseDecimal, requireReason, toBase } from "./shared";

/**
 * Purchase orders (US-6-02, US-6-03; docs/data-model.md §6.4, W04-04..09).
 *
 * - Lines only for approved supplier × material pairs (V-ASL); price defaults to the pair's price;
 *   expected date = order date + lead time (pair, else supplier default); MOQ shortfalls are warned.
 * - Approval per `approval_rules` `purchase_order` on the PO total (default: site_manager; plus
 *   owner_director above PHP 50,000, A-PM-15); creator and submitter never approve (SoD).
 * - Sending (`procurement.purchase_order.post`) records the PO document (documents module, ADR-026) and
 *   emails a text summary to the supplier through src/lib/email (after commit; never a fake "sent").
 * - Goods receipts move `qty_received_base` and the state sent → partially_received → received through
 *   the receiving hooks (src/modules/inventory/receiving-po.ts); procurement closes the PO.
 */

type PoRow = typeof purchaseOrders.$inferSelect;
type PoLineRow = typeof purchaseOrderLines.$inferSelect;

export type PoLineInput = {
  materialId: string;
  qty: string;
  uom?: string | null;
  unitAmount?: string | null;
  expectedDate?: string | null;
  purchaseRequestLineId?: string | null;
};

export type PoInput = {
  supplierId: string;
  shipToWarehouseId?: string | null;
  paymentTermsDays?: string | number | null;
  taxAmount?: string | null;
  notes?: string | null;
  isUrgent?: boolean;
  urgentReason?: string | null;
  lines: PoLineInput[];
};

export type PoWarning = { code: "moq" | "lead_time"; lineNo: number; message: string };

async function normalizePo(tx: Tx, ctx: AuthContext, siteId: string, input: PoInput, orderDate: string) {
  if (!isUuid(input.supplierId)) throw new DomainError("validation", "Choose a supplier.", { field: "supplierId" });
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DomainError("validation", "Add at least one line.", { field: "lines" });
  if (input.lines.length > 100) throw new DomainError("validation", "A purchase order can have at most 100 lines.", { field: "lines" });
  const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
  if (!supplier) throw new DomainError("validation", "Choose a supplier.", { field: "supplierId" });
  let warehouseId: string | null = null;
  if (input.shipToWarehouseId) {
    if (!isUuid(input.shipToWarehouseId)) throw new DomainError("validation", "Choose a warehouse of this site.", { field: "shipToWarehouseId" });
    const [w] = await tx.select().from(warehouses).where(and(eq(warehouses.id, input.shipToWarehouseId), eq(warehouses.siteId, siteId))).limit(1);
    if (!w || !w.isActive) throw new DomainError("validation", "Choose an active warehouse of this site.", { field: "shipToWarehouseId" });
    warehouseId = w.id;
  }
  let paymentTermsDays: number | null = supplier.paymentTermsDays ?? null;
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays !== null && String(input.paymentTermsDays).trim() !== "") {
    paymentTermsDays = Number(input.paymentTermsDays);
    if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 365) throw new DomainError("validation", "Payment terms must be 0 to 365 days.", { field: "paymentTermsDays" });
  }
  const isUrgent = !!input.isUrgent;
  const urgentReason = isUrgent ? requireReason(input.urgentReason, "urgentReason") : null;
  const notes = cleanText(input.notes, 1000, "notes", "Notes");
  const tax = optDecimal(input.taxAmount, "taxAmount", "Tax amount", { dp: 4, allowZero: true }) ?? new Decimal(0);
  const prices = canSeePrices(ctx);
  const warnings: PoWarning[] = [];
  const lines = [];
  const matIds = [...new Set(input.lines.map((l) => l.materialId).filter(isUuid))];
  const mats = matIds.length ? await tx.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), inArray(materials.id, matIds))) : [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    const f = (k: string) => `lines.${i}.${k}`;
    const mat = mats.find((m) => m.id === l.materialId);
    if (!mat) throw new DomainError("validation", `Line ${n}: choose a material.`, { field: f("materialId") });
    if (mat.status !== "active") throw new DomainError("validation", `Line ${n}: ${mat.code} is ${mat.status} and cannot be ordered.`, { field: f("materialId") });
    const { supplierMaterial: sm } = await assertAslApproved(tx, ctx.organizationId, supplier.id, mat.id, f("materialId"));
    const qty = parseDecimal(l.qty, f("qty"), `Line ${n} quantity`);
    const uom = (l.uom || sm.priceUom || mat.baseUom).trim();
    const qtyBase = await toBase(tx, ctx.organizationId, mat, qty, uom);
    if (!qtyBase) throw new DomainError("validation", `Line ${n}: ${uom} cannot be converted to ${mat.code}'s base unit ${mat.baseUom} (V-UOM).`, { field: f("uom") });
    if (mat.baseUom === "pcs" && !qtyBase.isInteger()) throw new DomainError("validation", `Line ${n}: ${mat.code} is counted in pieces; order a whole number.`, { field: f("qty") });
    // Price: entered (only by someone who may see prices) or the approved pair's price.
    let unit = prices ? optDecimal(l.unitAmount, f("unitAmount"), `Line ${n} unit price`, { dp: 4, allowZero: true }) : null;
    unit ??= await priceFor(tx, ctx.organizationId, mat, sm, uom);
    if (!unit) throw new DomainError("validation", `Line ${n}: enter the unit price (no supplier price is recorded for ${mat.code} per ${uom}).`, { field: f("unitAmount") });
    const lead = sm.leadTimeDays ?? supplier.defaultLeadTimeDays ?? 0;
    const minDate = addDaysIso(orderDate, lead);
    const expectedDate = optDate(l.expectedDate, f("expectedDate"), `Line ${n} expected date`) ?? minDate;
    if (expectedDate < orderDate) throw new DomainError("validation", `Line ${n}: the expected date cannot be before the order date.`, { field: f("expectedDate") });
    if (expectedDate < minDate) warnings.push({ code: "lead_time", lineNo: n, message: `Line ${n}: expected ${expectedDate} is earlier than the ${lead}-day lead time (${minDate}).` });
    const moq = await moqShortfall(tx, ctx.organizationId, mat, sm, qtyBase);
    if (moq?.short) warnings.push({ code: "moq", lineNo: n, message: `Line ${n}: ${qty.toString()} ${uom} is below the supplier's minimum order of ${sm.moqQty} ${sm.moqUom}.` });
    let prLineId: string | null = null;
    if (l.purchaseRequestLineId) {
      if (!isUuid(l.purchaseRequestLineId)) throw new DomainError("validation", `Line ${n}: the request line is not valid.`, { field: f("purchaseRequestLineId") });
      const [pl] = await tx
        .select({ l: purchaseRequestLines, status: purchaseRequests.status, siteId: purchaseRequests.siteId })
        .from(purchaseRequestLines)
        .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.purchaseRequestId))
        .where(and(eq(purchaseRequestLines.id, l.purchaseRequestLineId), eq(purchaseRequests.organizationId, ctx.organizationId)))
        .for("update")
        .limit(1);
      if (!pl || pl.siteId !== siteId) throw new DomainError("validation", `Line ${n}: the purchase request line was not found at this site.`, { field: f("purchaseRequestLineId") });
      if (pl.status !== "approved") throw new DomainError("state", `Line ${n}: the purchase request is not approved.`);
      if (pl.l.convertedPoLineId) throw new DomainError("conflict", `Line ${n}: that request line is already on a purchase order.`);
      if (pl.l.materialId !== mat.id) throw new DomainError("validation", `Line ${n}: the material differs from the request line.`, { field: f("materialId") });
      prLineId = pl.l.id;
    }
    lines.push({ mat, sm, qty, uom, qtyBase, unit, amount: new Decimal(money4(qty.mul(unit))), expectedDate, prLineId });
  }
  const subtotal = lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const total = subtotal.plus(tax);
  const expectedDate = lines.map((l) => l.expectedDate).sort().at(-1) ?? null;
  return { supplier, warehouseId, paymentTermsDays, isUrgent, urgentReason, notes, tax, subtotal, total, expectedDate, lines, warnings };
}

async function writeLines(tx: Tx, ctx: AuthContext, po: PoRow, lines: Awaited<ReturnType<typeof normalizePo>>["lines"]) {
  // Request lines released by a replaced draft line become convertible again.
  const old = await tx.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  if (old.length) {
    await tx.update(purchaseRequestLines).set({ convertedPoLineId: null }).where(inArray(purchaseRequestLines.convertedPoLineId, old.map((o) => o.id)));
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  }
  for (const [i, l] of lines.entries()) {
    const [row] = await tx
      .insert(purchaseOrderLines)
      .values({
        organizationId: ctx.organizationId,
        siteId: po.siteId,
        purchaseOrderId: po.id,
        lineNo: i + 1,
        materialId: l.mat.id,
        supplierMaterialId: l.sm.id,
        purchaseRequestLineId: l.prLineId,
        qtyEntered: l.qty.toString(),
        uomEntered: l.uom,
        qtyBase: l.qtyBase.toString(),
        baseUom: l.mat.baseUom,
        unitAmount: money4(l.unit),
        lineAmount: money4(l.amount),
        currency: po.currency,
        expectedDate: l.expectedDate,
      })
      .returning();
    if (l.prLineId) await tx.update(purchaseRequestLines).set({ convertedPoLineId: row.id }).where(eq(purchaseRequestLines.id, l.prLineId));
  }
  // Requests whose every line is now on a PO become `converted`.
  const prIds = [...new Set(lines.map((l) => l.prLineId).filter(Boolean) as string[])];
  if (prIds.length) {
    const prs = await tx
      .select({ pr: purchaseRequests })
      .from(purchaseRequests)
      .where(inArray(purchaseRequests.id, sql`(select purchase_request_id from purchase_request_lines where id in (${sql.join(prIds.map((x) => sql`${x}::uuid`), sql`, `)}))`))
      .for("update");
    for (const { pr } of prs) {
      const rest = await tx.select({ id: purchaseRequestLines.id }).from(purchaseRequestLines).where(and(eq(purchaseRequestLines.purchaseRequestId, pr.id), sql`${purchaseRequestLines.convertedPoLineId} is null`));
      if (rest.length === 0 && pr.status === "approved") {
        await transitionPr(tx, ctx, pr, "converted");
        await audit(tx, ctx, { action: "procurement.purchase_request.converted", entityType: "purchase_request", entityId: pr.id, entityNumber: pr.requestNumber, siteId: pr.siteId, after: { purchaseOrderId: po.id, poNumber: po.poNumber } });
      }
    }
  }
}

/** Creates a draft PO at the caller's current site (W04-04). Lines may convert approved request lines. */
export async function createPurchaseOrder(ctx: AuthContext, input: PoInput & { idempotencyKey?: string | null }) {
  const siteId = ctx.currentSiteId;
  ctx.requireAt("procurement.purchase_order.create", siteId);
  ctx.assertWritable();
  return db.transaction(async (tx) => {
    const r = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.purchase_order.create", async () => {
      const orderDate = businessDate();
      const v = await normalizePo(tx, ctx, siteId, input, orderDate);
      const poNumber = await nextNumber(tx, ctx.organizationId, "PO");
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          poNumber,
          status: "draft",
          supplierId: v.supplier.id,
          shipToWarehouseId: v.warehouseId,
          orderDate,
          expectedDate: v.expectedDate,
          paymentTermsDays: v.paymentTermsDays,
          subtotalAmount: money4(v.subtotal),
          taxAmount: money4(v.tax),
          totalAmount: money4(v.total),
          isUrgent: v.isUrgent,
          urgentReason: v.urgentReason,
          notes: v.notes,
          createdBy: ctx.userId,
          statusChangedBy: ctx.userId,
        })
        .returning();
      await writeLines(tx, ctx, po, v.lines);
      await logCreation(tx, ctx, "po", po);
      await audit(tx, ctx, {
        action: "procurement.purchase_order.created",
        entityType: "purchase_order",
        entityId: po.id,
        entityNumber: poNumber,
        siteId,
        after: { supplier: v.supplier.code, total: money4(v.total), urgent: v.isUrgent, lines: v.lines.map((l) => ({ material: l.mat.code, qty: l.qty.toString(), uom: l.uom, fromRequestLine: l.prLineId })), warnings: v.warnings },
      });
      if (v.isUrgent) {
        await notifyRoles(tx, { roleCodes: ["owner_director"], siteId }, { organizationId: ctx.organizationId, siteId, kind: "purchase_order_urgent", severity: "warning", title: `Urgent purchase order ${poNumber}`, body: v.urgentReason ?? "Urgent purchase without a request.", entityType: "purchase_order", entityId: po.id, link: `/procurement/orders/${po.id}` });
      }
      return { purchaseOrderId: po.id, poNumber, warnings: v.warnings };
    });
    return { ...r.result, replayed: r.replayed };
  });
}

export async function lockPo(tx: Tx, ctx: AuthContext, poId: string) {
  if (!isUuid(poId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!po) throw new DomainError("not_found", "Purchase order not found in your sites.");
  assertInScope(ctx, po.siteId, "Purchase order");
  return po;
}

/** Replaces a draft PO's header and lines (W04-04). */
export async function updatePurchaseOrder(ctx: AuthContext, poId: string, input: PoInput) {
  ctx.require("procurement.purchase_order.edit");
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, poId);
    ctx.requireAt("procurement.purchase_order.edit", po.siteId);
    if (po.status !== "draft") throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; only drafts can be changed.`);
    const v = await normalizePo(tx, ctx, po.siteId, input, po.orderDate);
    await writeLines(tx, ctx, po, v.lines);
    await tx
      .update(purchaseOrders)
      .set({ supplierId: v.supplier.id, shipToWarehouseId: v.warehouseId, expectedDate: v.expectedDate, paymentTermsDays: v.paymentTermsDays, subtotalAmount: money4(v.subtotal), taxAmount: money4(v.tax), totalAmount: money4(v.total), isUrgent: v.isUrgent, urgentReason: v.urgentReason, notes: v.notes, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, po.id));
    await audit(tx, ctx, { action: "procurement.purchase_order.updated", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, before: { total: po.totalAmount, supplierId: po.supplierId }, after: { total: money4(v.total), supplierId: v.supplier.id, lines: v.lines.length } });
    return { purchaseOrderId: po.id, warnings: v.warnings };
  });
}

const basisOf = (po: PoRow) => ({ amount: po.totalAmount });

/** Submits a draft for approval (W04-04 → W04-05); V-ASL is re-checked on every line. */
export async function submitPurchaseOrder(ctx: AuthContext, input: { purchaseOrderId: string }) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.submit", po.siteId);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    if (!lines.length) throw new DomainError("validation", "Add at least one line before submitting.", { field: "lines" });
    for (const [i, l] of lines.entries()) await assertAslApproved(tx, ctx.organizationId, po.supplierId, l.materialId, `lines.${i}.materialId`);
    await transitionPo(tx, ctx, po, "submitted", { set: { submittedBy: ctx.userId, submittedAt: new Date() } });
    await audit(tx, ctx, { action: "procurement.purchase_order.submitted", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, after: { status: "submitted", total: po.totalAmount } });
    const progress = await approvalProgress(tx, ctx.organizationId, { recordType: "purchase_order", recordId: po.id, siteId: po.siteId, basis: basisOf(po) });
    const roles = progress.next?.roleCodes.length ? progress.next.roleCodes : ["site_manager"];
    await notifyRoles(tx, { roleCodes: roles, siteId: po.siteId }, { organizationId: ctx.organizationId, siteId: po.siteId, kind: "purchase_order_submitted", severity: "info", title: `Purchase order ${po.poNumber} waits for approval`, body: `${progress.steps.length} approval step(s).`, entityType: "purchase_order", entityId: po.id, link: `/procurement/orders/${po.id}` });
    return { purchaseOrderId: po.id, status: "submitted" as const, steps: progress.steps.length };
  });
}

/** Approver decision (W04-05): approve the next step, or return to draft with a reason. */
export async function decidePurchaseOrder(ctx: AuthContext, input: { purchaseOrderId: string; decision: "approve" | "return"; note?: string | null }) {
  if (input.decision !== "approve" && input.decision !== "return") throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.approve", po.siteId);
    if (po.status !== "submitted") throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; only submitted orders are approved.`);
    const decision = input.decision === "approve" ? "approved" : "returned";
    const r = await recordDecision(tx, ctx, {
      recordType: "purchase_order",
      recordId: po.id,
      recordNumber: po.poNumber,
      siteId: po.siteId,
      basis: basisOf(po),
      pendingSince: po.submittedAt,
      excludedUserIds: [po.createdBy, po.submittedBy],
      decision,
      note: input.note,
    });
    if (decision === "approved" && r.final) {
      await transitionPo(tx, ctx, po, "approved", { set: { approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: input.note?.trim() || null } });
      await notifyRoles(tx, { roleCodes: ["procurement"], siteId: po.siteId }, { organizationId: ctx.organizationId, siteId: po.siteId, kind: "purchase_order_approved", severity: "info", title: `Purchase order ${po.poNumber} approved`, body: "Send it to the supplier.", entityType: "purchase_order", entityId: po.id, link: `/procurement/orders/${po.id}` });
    } else if (decision === "approved" && r.nextStep) {
      const roles = r.nextStep.roleCodes.length ? r.nextStep.roleCodes : ["owner_director"];
      await notifyRoles(tx, { roleCodes: roles, siteId: po.siteId }, { organizationId: ctx.organizationId, siteId: po.siteId, kind: "purchase_order_submitted", severity: "info", title: `Purchase order ${po.poNumber} waits for step ${r.nextStep.step}`, body: r.nextStep.label, entityType: "purchase_order", entityId: po.id, link: `/procurement/orders/${po.id}` });
    } else if (decision === "returned") {
      await transitionPo(tx, ctx, po, "draft", { reason: input.note });
    }
    await audit(tx, ctx, {
      action: decision === "approved" ? (r.final ? "procurement.purchase_order.approved" : "procurement.purchase_order.step_approved") : "procurement.purchase_order.returned",
      entityType: "purchase_order",
      entityId: po.id,
      entityNumber: po.poNumber,
      siteId: po.siteId,
      reason: input.note?.trim() || null,
      after: { status: po.status, step: r.step?.step ?? 1, final: r.final },
    });
    return { purchaseOrderId: po.id, status: po.status as PoStatus, final: r.final };
  });
}

const ROLE_TITLE = (code: string) => ROLE_BUNDLES[code]?.name ?? code.replace(/_/g, " ");

/** The frozen dataset of the PO document (role titles only; prices are part of the supplier copy). */
async function poDocumentData(q: DbOrTx, ctx: AuthContext, po: PoRow): Promise<PurchaseOrderData> {
  const [org] = await q.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, po.organizationId));
  const [s] = await q.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
  const [site] = await q.select({ name: sites.name, code: sites.code }).from(sites).where(eq(sites.id, po.siteId));
  const [wh] = po.shipToWarehouseId ? await q.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, po.shipToWarehouseId)) : [];
  const lines = await q
    .select({ l: purchaseOrderLines, code: materials.code, name: materials.name, part: supplierMaterials.supplierPartNumber })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
    .leftJoin(supplierMaterials, eq(supplierMaterials.id, purchaseOrderLines.supplierMaterialId))
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const progress = await approvalProgress(q, ctx.organizationId, { recordType: "purchase_order", recordId: po.id, siteId: po.siteId, basis: basisOf(po) });
  const m = (v: Decimal.Value) => new Decimal(v).toFixed(2);
  return {
    company: { name: org?.name ?? "", address: null },
    po: {
      poNumber: po.poNumber,
      orderDateText: fmtDate(po.orderDate),
      expectedDateText: po.expectedDate ? fmtDate(po.expectedDate) : null,
      promisedDateText: po.promisedDate ? fmtDate(po.promisedDate) : null,
      paymentTermsText: po.paymentTermsDays !== null ? `${po.paymentTermsDays} days` : null,
      currency: po.currency,
      supplierReference: po.supplierReference,
      urgentText: po.isUrgent ? po.urgentReason : null,
      revisionText: null,
    },
    supplier: { code: s.code, name: s.name, contact: s.contactName, address: [s.addressLine1, s.city, s.country].filter(Boolean).join(", ") || null, email: s.email, phone: s.phone },
    shipTo: { siteName: site ? `${site.name} (${site.code})` : "", warehouse: wh ? `${wh.code} ${wh.name}` : null },
    lines: lines.map((r) => ({
      lineNo: r.l.lineNo,
      materialCode: r.code,
      materialName: r.name,
      supplierPartNumber: r.part ?? null,
      qtyText: `${new Decimal(r.l.qtyEntered).toString()} ${r.l.uomEntered}`,
      unitPriceText: `${m(r.l.unitAmount)} / ${r.l.uomEntered}`,
      amountText: m(r.l.lineAmount),
      expectedText: r.l.expectedDate ? fmtDate(r.l.expectedDate) : null,
    })),
    totals: { subtotalText: m(po.subtotalAmount), taxText: m(po.taxAmount), totalText: m(po.totalAmount) },
    approvals: progress.steps.map((st) => ({
      title: st.roleCodes.length ? st.roleCodes.map(ROLE_TITLE).join(" or ") : st.label,
      whenText: st.approvals[0] ? fmtDate(st.approvals[0].at) : "pending",
    })),
    preparedByTitle: ROLE_TITLE("procurement"),
    notes: po.notes,
    termsText: null,
  };
}

async function renderPoDocument(tx: Tx, ctx: AuthContext, po: PoRow, watermark: string | null) {
  const code = await getSetting(tx, ctx.organizationId, "documents.purchase_order.template_code", po.siteId);
  const resolved = await resolveTemplateVersion(tx, ctx.organizationId, { templateCode: code, siteId: po.siteId });
  if (!resolved) throw new DomainError("setup_required", `No approved purchase order template (${code}) exists. Ask an administrator to approve one under Admin → Templates.`);
  const data = await poDocumentData(tx, ctx, po);
  return generateForSource(tx, ctx, {
    resolved,
    documentKind: "purchase_order",
    source: { type: "purchase_order", id: po.id, revisionAt: new Date(), state: po.status },
    siteId: po.siteId,
    data,
    watermark,
    parameters: { dataset: "purchase_order/v1" },
    supersedePrevious: true,
  });
}

/**
 * Sends an approved PO (W04-06, `procurement.purchase_order.post`): records the PO document and moves
 * approved → sent in one transaction; then, if enabled and the supplier has an email address, emails a
 * text summary through the email adapter. A repeat with the same key returns the first result.
 */
export async function sendPurchaseOrder(ctx: AuthContext, input: { purchaseOrderId: string; email?: boolean; idempotencyKey?: string | null }) {
  ctx.assertWritable();
  const out = await db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.post", po.siteId);
    const r = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.purchase_order.send", async () => {
      if (po.status !== "approved") throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; only approved orders are sent.`);
      for (const [i, l] of (await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id))).entries()) await assertAslApproved(tx, ctx.organizationId, po.supplierId, l.materialId, `lines.${i}.materialId`);
      const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
      const wantEmail = input.email !== false && (await getSetting(tx, ctx.organizationId, "procurement.purchase_order.email_supplier"));
      const to = wantEmail && s.email ? s.email : null;
      await transitionPo(tx, ctx, po, "sent", { set: { sentAt: new Date(), sentBy: ctx.userId, sentTo: to, sendResult: to ? "pending" : "download" } });
      const doc = await renderPoDocument(tx, ctx, po, null);
      await tx.update(purchaseOrders).set({ generatedDocumentId: doc.id }).where(eq(purchaseOrders.id, po.id));
      await audit(tx, ctx, { action: "procurement.purchase_order.sent", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, after: { documentNumber: doc.documentNumber, sentTo: to, total: po.totalAmount } });
      const lines = await tx.select({ l: purchaseOrderLines, code: materials.code, name: materials.name }).from(purchaseOrderLines).innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId)).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).orderBy(asc(purchaseOrderLines.lineNo));
      const text = [
        `Purchase order ${po.poNumber}`,
        `Supplier: ${s.name} (${s.code})`,
        `Order date: ${po.orderDate}${po.expectedDate ? ` · expected delivery ${po.expectedDate}` : ""}`,
        "",
        ...lines.map((x) => `${x.l.lineNo}. ${x.code} ${x.name}: ${new Decimal(x.l.qtyEntered).toString()} ${x.l.uomEntered} at ${new Decimal(x.l.unitAmount).toFixed(2)} ${po.currency}/${x.l.uomEntered}${x.l.expectedDate ? `, by ${x.l.expectedDate}` : ""}`),
        "",
        `Total ${new Decimal(po.totalAmount).toFixed(2)} ${po.currency}. Please quote ${po.poNumber} on your delivery receipt and invoice.`,
        `Issued by the Procurement team (document ${doc.documentNumber}).`,
      ].join("\n");
      return { purchaseOrderId: po.id, poNumber: po.poNumber, documentId: doc.id, documentNumber: doc.documentNumber, to, text };
    });
    return { ...r.result, replayed: r.replayed, organizationId: ctx.organizationId };
  });
  let sendResult: string = out.to ? "pending" : "download";
  if (out.to && !out.replayed) {
    const res = await sendEmail({ to: out.to, subject: `Purchase order ${out.poNumber}`, text: out.text, template: "procurement.purchase_order", organizationId: out.organizationId });
    sendResult = res.status;
    await db.update(purchaseOrders).set({ sendResult }).where(eq(purchaseOrders.id, out.purchaseOrderId));
    await audit(db, ctx, { action: "procurement.purchase_order.emailed", entityType: "purchase_order", entityId: out.purchaseOrderId, entityNumber: out.poNumber, after: { to: out.to, status: res.status, provider: res.provider } });
  }
  return { purchaseOrderId: out.purchaseOrderId, documentId: out.documentId, documentNumber: out.documentNumber, emailedTo: out.to, sendResult, replayed: out.replayed };
}

/** Supplier confirmation reference and promised date (W04-06). */
export async function recordSupplierConfirmation(ctx: AuthContext, input: { purchaseOrderId: string; supplierReference?: string | null; promisedDate?: string | null }) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.edit", po.siteId);
    if (!["sent", "partially_received"].includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; confirmations are recorded after sending.`);
    const supplierReference = cleanText(input.supplierReference, 80, "supplierReference", "Supplier reference");
    const promisedDate = optDate(input.promisedDate, "promisedDate", "Promised date");
    if (!supplierReference && !promisedDate) throw new DomainError("validation", "Enter the supplier's reference or promised date.", { field: "supplierReference" });
    await tx.update(purchaseOrders).set({ supplierReference: supplierReference ?? po.supplierReference, promisedDate: promisedDate ?? po.promisedDate, updatedAt: new Date() }).where(eq(purchaseOrders.id, po.id));
    await audit(tx, ctx, { action: "procurement.purchase_order.confirmed", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, before: { supplierReference: po.supplierReference, promisedDate: po.promisedDate }, after: { supplierReference, promisedDate } });
    return { purchaseOrderId: po.id };
  });
}

/** Cancels a PO with a reason (`.void`): draft, submitted, approved, or sent with nothing received. */
export async function cancelPurchaseOrder(ctx: AuthContext, input: { purchaseOrderId: string; reason: string }) {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.void", po.siteId);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).for("update");
    if (lines.some((l) => new Decimal(l.qtyReceivedBase).gt(0))) throw new DomainError("state", `Goods were already received against ${po.poNumber}; short-close the remaining lines and close the order instead.`);
    const drafts = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId, po.id), eq(goodsReceipts.status, "draft")));
    if (drafts.length) throw new DomainError("state", `A draft goods receipt exists for ${po.poNumber}; cancel it first.`);
    await transitionPo(tx, ctx, po, "cancelled", { reason, set: { cancelReason: reason } });
    await tx.update(purchaseOrderLines).set({ lineStatus: "cancelled", updatedAt: new Date() }).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    // The approved request lines become convertible again (their requests stay approved / converted as history).
    if (lines.length) await tx.update(purchaseRequestLines).set({ convertedPoLineId: null }).where(inArray(purchaseRequestLines.convertedPoLineId, lines.map((l) => l.id)));
    await audit(tx, ctx, { action: "procurement.purchase_order.cancelled", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, reason });
    return { purchaseOrderId: po.id };
  });
}

/** Short-closes an open line with a reason (the rest will not be delivered); the PO may then be closed. */
export async function shortClosePoLine(ctx: AuthContext, input: { lineId: string; reason: string }) {
  const reason = requireReason(input.reason);
  if (!isUuid(input.lineId)) throw new DomainError("not_found", "PO line not found.");
  return db.transaction(async (tx) => {
    const [l0] = await tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.id, input.lineId), eq(purchaseOrderLines.organizationId, ctx.organizationId))).limit(1);
    if (!l0) throw new DomainError("not_found", "PO line not found.");
    const po = await lockPo(tx, ctx, l0.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.edit", po.siteId);
    if (!["sent", "partially_received"].includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; lines are short-closed while deliveries are expected.`);
    const [l] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, l0.id)).for("update");
    if (l.lineStatus !== "open") throw new DomainError("state", `Line ${l.lineNo} is ${l.lineStatus.replace("_", " ")}.`);
    await tx.update(purchaseOrderLines).set({ lineStatus: "short_closed", shortClosedAt: new Date(), shortClosedBy: ctx.userId, shortCloseReason: reason, updatedAt: new Date() }).where(eq(purchaseOrderLines.id, l.id));
    await audit(tx, ctx, { action: "procurement.purchase_order.line_short_closed", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, reason, after: { lineNo: l.lineNo, ordered: l.qtyBase, received: l.qtyReceivedBase } });
    await syncPoReceiptState(tx, ctx, po, reason);
    return { purchaseOrderId: po.id };
  });
}

/** Closes a PO (W04-09 → closed): every line received or short-closed; open lines are short-closed with the reason. */
export async function closePurchaseOrder(ctx: AuthContext, input: { purchaseOrderId: string; reason?: string | null }) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.edit", po.siteId);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).for("update");
    const open = lines.filter((l) => l.lineStatus === "open");
    const reason = open.length || po.status !== "received" ? requireReason(input.reason) : (input.reason?.trim() || null);
    const drafts = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts).where(and(eq(goodsReceipts.purchaseOrderId, po.id), eq(goodsReceipts.status, "draft")));
    if (drafts.length) throw new DomainError("state", `A draft goods receipt exists for ${po.poNumber}; post or cancel it first.`);
    for (const l of open) {
      await tx.update(purchaseOrderLines).set({ lineStatus: "short_closed", shortClosedAt: new Date(), shortClosedBy: ctx.userId, shortCloseReason: reason!, updatedAt: new Date() }).where(eq(purchaseOrderLines.id, l.id));
    }
    await transitionPo(tx, ctx, po, "closed", { reason, set: { closedAt: new Date(), closedBy: ctx.userId, closeReason: reason } });
    await audit(tx, ctx, { action: "procurement.purchase_order.closed", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, reason, after: { shortClosedLines: open.map((l) => l.lineNo) } });
    return { purchaseOrderId: po.id };
  });
}

/** After a short-close: when nothing remains open and something was received, the PO is `received`. */
async function syncPoReceiptState(tx: Tx, ctx: AuthContext, po: PoRow, reason: string | null) {
  const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const live = lines.filter((l) => l.lineStatus !== "cancelled");
  const anyReceived = live.some((l) => new Decimal(l.qtyReceivedBase).gt(0));
  const anyOpen = live.some((l) => l.lineStatus === "open");
  const target: PoStatus = !anyOpen && anyReceived ? "received" : anyReceived ? "partially_received" : "sent";
  if (target !== po.status) await transitionPo(tx, ctx, po, target, { reason });
}

/* ------------------------------------------------------------------ receiving hooks (US-6-03) */

const RECEIVABLE: readonly string[] = ["sent", "partially_received"];

async function poForReceipt(tx: Tx, ctx: AuthContext, purchaseOrderId: string, siteId: string, lock: boolean) {
  const base = tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
  const [po] = lock ? await base.for("update") : await base;
  if (!po || !ctx.allowedSiteIds.includes(po.siteId)) throw new DomainError("validation", "Purchase order not found in your sites.", { field: "purchaseOrderId" });
  if (po.siteId !== siteId) throw new DomainError("validation", `Purchase order ${po.poNumber} is for another site; ask procurement to re-route it (V-SCOPE).`, { field: "purchaseOrderId", rule: "V-SCOPE" });
  return po;
}

export const purchaseOrderReceivingHooks: ReceivingPoHooks = {
  async validateDraft(tx, ctx, args) {
    const po = await poForReceipt(tx, ctx, args.purchaseOrderId, args.siteId, false);
    if (!RECEIVABLE.includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; goods are received against sent orders only.`);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    for (const l of args.lines) {
      if (!l.purchaseOrderLineId) continue;
      const pl = lines.find((x) => x.id === l.purchaseOrderLineId);
      if (!pl) throw new DomainError("validation", `Line ${l.index + 1}: that line is not on ${po.poNumber}.`, { field: `lines.${l.index}.purchaseOrderLineId` });
      if (pl.materialId !== l.materialId) throw new DomainError("validation", `Line ${l.index + 1}: the material differs from PO line ${pl.lineNo} (V-MAT). Receive it as an unplanned line instead.`, { field: `lines.${l.index}.materialId`, rule: "V-MAT" });
      if (pl.lineStatus === "short_closed" || pl.lineStatus === "cancelled") throw new DomainError("state", `PO line ${pl.lineNo} is ${pl.lineStatus.replace("_", " ")}; nothing more is expected on it.`);
    }
    const [s] = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, po.supplierId));
    return { supplierId: s.id, supplierName: s.name };
  },

  async onPost(tx, ctx, args) {
    const po = await poForReceipt(tx, ctx, args.purchaseOrderId, args.siteId, true);
    if (!RECEIVABLE.includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; this receipt cannot post against it.`);
    const tol = new Decimal(await getSetting(tx, ctx.organizationId, "procurement.receipt.over_delivery_tolerance_pct", po.siteId));
    const poLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).orderBy(asc(purchaseOrderLines.id)).for("update");
    const byLine = new Map<string, PoReceiptLine[]>();
    for (const l of args.lines) {
      if (!l.purchaseOrderLineId) {
        // A material not on the PO (W01-02 V-MAT): only as an approved discrepancy line (CX-QTY).
        if (!l.discrepancyKind || !l.discrepancyApproved) {
          throw new DomainError("conflict", `Line ${l.lineNo} is not on ${po.poNumber}: record it as a wrong-item or over-delivery discrepancy and have procurement approve it before posting (CX-QTY).`, { rule: "CX-QTY", lineId: l.lineId });
        }
        continue;
      }
      byLine.set(l.purchaseOrderLineId, [...(byLine.get(l.purchaseOrderLineId) ?? []), l]);
    }
    const progress: { lineNo: number; before: string; after: string; ordered: string }[] = [];
    for (const [poLineId, recLines] of byLine) {
      const pl = poLines.find((x) => x.id === poLineId);
      if (!pl) throw new DomainError("validation", `A receipt line names a line that is not on ${po.poNumber}.`);
      if (pl.lineStatus === "short_closed" || pl.lineStatus === "cancelled") throw new DomainError("state", `PO line ${pl.lineNo} is ${pl.lineStatus.replace("_", " ")}; nothing more is expected on it.`);
      const add = recLines.reduce((s, l) => s.plus(l.qtyBase), new Decimal(0));
      const before = new Decimal(pl.qtyReceivedBase);
      const after = before.plus(add);
      const allowance = new Decimal(pl.qtyBase).mul(tol.div(100).plus(1));
      if (after.gt(allowance) && !recLines.every((l) => l.discrepancyKind === "over" && l.discrepancyApproved)) {
        throw new DomainError(
          "conflict",
          `PO line ${pl.lineNo}: ${after.toString()} ${pl.baseUom} would be received against ${pl.qtyBase} ${pl.baseUom} ordered (tolerance ${tol.toString()} %). Record an over-delivery discrepancy and have procurement approve it before posting (V-OVER, CX-QTY).`,
          { rule: "V-OVER", lineNo: pl.lineNo, ordered: pl.qtyBase, wouldReceive: after.toString() },
        );
      }
      await tx
        .update(purchaseOrderLines)
        .set({ qtyReceivedBase: after.toString(), lineStatus: after.gte(pl.qtyBase) ? "received" : "open", updatedAt: new Date() })
        .where(eq(purchaseOrderLines.id, pl.id));
      progress.push({ lineNo: pl.lineNo, before: before.toString(), after: after.toString(), ordered: pl.qtyBase });
    }
    const refreshed = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const live = refreshed.filter((l) => l.lineStatus !== "cancelled");
    const allDone = live.every((l) => l.lineStatus === "received" || l.lineStatus === "short_closed");
    await transitionPo(tx, ctx, po, allDone ? "received" : "partially_received");
    await audit(tx, ctx, { action: "procurement.purchase_order.receipt_posted", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, after: { receipt: args.receiptLabel, receiptId: args.receiptId, status: po.status, lines: progress } });
  },

  async onReverse(tx, ctx, args) {
    const po = await poForReceipt(tx, ctx, args.purchaseOrderId, args.siteId, true);
    if (!["partially_received", "received"].includes(po.status)) {
      throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; its receipts can no longer be reversed. Correct the stock with a supplier return or adjustment.`);
    }
    const poLines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).orderBy(asc(purchaseOrderLines.id)).for("update");
    const changes: { lineNo: number; before: string; after: string }[] = [];
    for (const pl of poLines) {
      const sub = args.lines.filter((l) => l.purchaseOrderLineId === pl.id).reduce((s, l) => s.plus(l.qtyBase), new Decimal(0));
      if (sub.isZero()) continue;
      const before = new Decimal(pl.qtyReceivedBase);
      const after = Decimal.max(before.minus(sub), 0);
      await tx
        .update(purchaseOrderLines)
        .set({ qtyReceivedBase: after.toString(), lineStatus: pl.lineStatus === "received" && after.lt(pl.qtyBase) ? "open" : pl.lineStatus, updatedAt: new Date() })
        .where(eq(purchaseOrderLines.id, pl.id));
      changes.push({ lineNo: pl.lineNo, before: before.toString(), after: after.toString() });
    }
    await syncPoReceiptState(tx, ctx, po, args.reason);
    await audit(tx, ctx, { action: "procurement.purchase_order.receipt_reversed", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, reason: args.reason, after: { receiptId: args.receiptId, receiptNumber: args.receiptNumber, status: po.status, lines: changes } });
  },
};

/* ------------------------------------------------------------------ queries */

export type PoFilter = { status?: string; q?: string; supplierId?: string };

const OPEN_STATES = ["draft", "submitted", "approved", "sent", "partially_received", "received"];

export async function listPurchaseOrders(ctx: AuthContext, f: PoFilter = {}) {
  ctx.require("procurement.purchase_order.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.purchase_order.view", s));
  if (!siteIds.length) return [];
  const conds = [eq(purchaseOrders.organizationId, ctx.organizationId), inArray(purchaseOrders.siteId, siteIds)];
  if (f.status === "open") conds.push(inArray(purchaseOrders.status, OPEN_STATES));
  else if (f.status && f.status !== "all") conds.push(eq(purchaseOrders.status, f.status));
  if (f.supplierId && isUuid(f.supplierId)) conds.push(eq(purchaseOrders.supplierId, f.supplierId));
  const rows = await db
    .select({ po: purchaseOrders, siteCode: sites.code, supplierName: suppliers.name, supplierCode: suppliers.code, lines: sql<number>`(select count(*)::int from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id})` })
    .from(purchaseOrders)
    .innerJoin(sites, eq(sites.id, purchaseOrders.siteId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(300);
  const q = f.q?.trim().toLowerCase();
  const prices = canSeePrices(ctx);
  const today = businessDate();
  return rows
    .filter((r) => !q || r.po.poNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q) || (r.po.supplierReference ?? "").toLowerCase().includes(q))
    .map((r) => {
      const due = r.po.promisedDate ?? r.po.expectedDate;
      return {
        id: r.po.id,
        number: r.po.poNumber,
        status: r.po.status as PoStatus,
        siteCode: r.siteCode,
        supplierName: r.supplierName,
        supplierCode: r.supplierCode,
        orderDate: r.po.orderDate,
        expectedDate: due,
        late: !!due && RECEIVABLE.includes(r.po.status) && due < today,
        urgent: r.po.isUrgent,
        lines: Number(r.lines),
        totalAmount: prices ? r.po.totalAmount : undefined,
        currency: r.po.currency,
      };
    });
}

export async function getPurchaseOrder(ctx: AuthContext, poId: string) {
  ctx.require("procurement.purchase_order.view");
  if (!isUuid(poId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
  if (!po || !ctx.allowedSiteIds.includes(po.siteId) || !ctx.canAt("procurement.purchase_order.view", po.siteId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  const prices = canSeePrices(ctx);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
  const [site] = await db.select({ code: sites.code, name: sites.name }).from(sites).where(eq(sites.id, po.siteId));
  const [wh] = po.shipToWarehouseId ? await db.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, po.shipToWarehouseId)) : [];
  const lines = await db
    .select({ l: purchaseOrderLines, code: materials.code, name: materials.name, prNumber: purchaseRequests.requestNumber })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
    .leftJoin(purchaseRequestLines, eq(purchaseRequestLines.id, purchaseOrderLines.purchaseRequestLineId))
    .leftJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.purchaseRequestId))
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id))
    .orderBy(asc(purchaseOrderLines.lineNo));
  const transitions = await db
    .select({ t: purchaseOrderStateTransitions, actorName: users.displayName })
    .from(purchaseOrderStateTransitions)
    .innerJoin(users, eq(users.id, purchaseOrderStateTransitions.actorId))
    .where(eq(purchaseOrderStateTransitions.purchaseOrderId, po.id))
    .orderBy(asc(purchaseOrderStateTransitions.occurredAt));
  const receipts = ctx.can("procurement.goods_receipt.view")
    ? await db
        .select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber, status: goodsReceipts.status, receivedAt: goodsReceipts.receivedAt, supplierDocumentNumber: goodsReceipts.supplierDocumentNumber })
        .from(goodsReceipts)
        .where(eq(goodsReceipts.purchaseOrderId, po.id))
        .orderBy(desc(goodsReceipts.receivedAt))
    : [];
  const progress = await approvalProgress(db, ctx.organizationId, { recordType: "purchase_order", recordId: po.id, siteId: po.siteId, basis: basisOf(po) });
  const decisions = await decisionsOf(db, ctx.organizationId, "purchase_order", po.id);
  const documents = ctx.can("documents.generated_document.view") ? (await documentsForSourceRead(ctx.organizationId, "purchase_order", po.id, ["purchase_order"])).map((d) => ({ id: d.d.id, documentNumber: d.d.documentNumber, status: d.d.status, generatedAt: d.d.generatedAt, generatedByName: d.generatedByName })) : [];
  const excluded = [po.createdBy, po.submittedBy];
  const live = lines.filter((l) => l.l.lineStatus !== "cancelled");
  return {
    po: { ...po, status: po.status as PoStatus, subtotalAmount: prices ? po.subtotalAmount : null, taxAmount: prices ? po.taxAmount : null, totalAmount: prices ? po.totalAmount : null },
    supplier: { id: supplier.id, code: supplier.code, name: supplier.name, email: supplier.email, qualityStatus: supplier.qualityStatus },
    site,
    warehouse: wh ?? null,
    lines: lines.map((r) => ({
      ...r.l,
      unitAmount: prices ? r.l.unitAmount : null,
      lineAmount: prices ? r.l.lineAmount : null,
      materialCode: r.code,
      materialName: r.name,
      prNumber: r.prNumber,
      remainingBase: Decimal.max(new Decimal(r.l.qtyBase).minus(r.l.qtyReceivedBase), 0).toString(),
    })),
    transitions: transitions.map((t) => ({ ...t.t, actorName: t.actorName })),
    receipts,
    documents,
    progress,
    decisions,
    can: {
      edit: po.status === "draft" && ctx.canAt("procurement.purchase_order.edit", po.siteId),
      submit: po.status === "draft" && ctx.canAt("procurement.purchase_order.submit", po.siteId),
      decide: po.status === "submitted" && canDecide(ctx, "purchase_order", progress, po.siteId, po.submittedAt, excluded),
      send: po.status === "approved" && ctx.canAt("procurement.purchase_order.post", po.siteId) && ctx.can("documents.generated_document.create"),
      confirm: RECEIVABLE.includes(po.status) && ctx.canAt("procurement.purchase_order.edit", po.siteId),
      receive: RECEIVABLE.includes(po.status) && ctx.canAt("procurement.goods_receipt.create", po.siteId) && ctx.currentSiteId === po.siteId,
      cancel: ["draft", "submitted", "approved", "sent"].includes(po.status) && live.every((l) => new Decimal(l.l.qtyReceivedBase).isZero()) && ctx.canAt("procurement.purchase_order.void", po.siteId),
      close: ["sent", "partially_received", "received"].includes(po.status) && ctx.canAt("procurement.purchase_order.edit", po.siteId),
      shortClose: RECEIVABLE.includes(po.status) && ctx.canAt("procurement.purchase_order.edit", po.siteId),
      print: !!po.generatedDocumentId && ctx.can("documents.generated_document.view") && prices,
      seePrices: prices,
    },
  };
}

/** Expected receipts (W04-07): open lines of sent / partially received POs at the caller's sites. No prices. */
export async function expectedReceipts(ctx: AuthContext, f: { siteId?: string } = {}) {
  ctx.require("procurement.purchase_order.view");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("procurement.purchase_order.view", s) && (!f.siteId || f.siteId === s));
  if (!siteIds.length) return [];
  const rows = await db
    .select({ l: purchaseOrderLines, po: purchaseOrders, siteCode: sites.code, supplierName: suppliers.name, code: materials.code, name: materials.name })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(sites, eq(sites.id, purchaseOrders.siteId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
    .where(and(eq(purchaseOrders.organizationId, ctx.organizationId), inArray(purchaseOrders.siteId, siteIds), inArray(purchaseOrders.status, [...RECEIVABLE]), eq(purchaseOrderLines.lineStatus, "open")))
    .orderBy(asc(sql`coalesce(${purchaseOrderLines.expectedDate}, ${purchaseOrders.expectedDate})`), asc(purchaseOrders.poNumber), asc(purchaseOrderLines.lineNo));
  const today = businessDate();
  return rows.map((r) => {
    const due = r.po.promisedDate ?? r.l.expectedDate ?? r.po.expectedDate;
    return {
      purchaseOrderId: r.po.id,
      poNumber: r.po.poNumber,
      poStatus: r.po.status as PoStatus,
      siteId: r.po.siteId,
      siteCode: r.siteCode,
      supplierName: r.supplierName,
      lineId: r.l.id,
      lineNo: r.l.lineNo,
      materialId: r.l.materialId,
      materialCode: r.code,
      materialName: r.name,
      orderedBase: r.l.qtyBase,
      receivedBase: r.l.qtyReceivedBase,
      remainingBase: Decimal.max(new Decimal(r.l.qtyBase).minus(r.l.qtyReceivedBase), 0).toString(),
      baseUom: r.l.baseUom,
      orderedText: `${new Decimal(r.l.qtyEntered).toString()} ${r.l.uomEntered}`,
      expectedDate: due,
      late: !!due && due < today,
    };
  });
}

/** CSV export of purchase orders with prices (`procurement.purchase_order.export`, S); writes platform.export.created. */
export async function exportPurchaseOrdersCsv(ctx: AuthContext, f: PoFilter = {}) {
  ctx.require("procurement.purchase_order.export");
  const rows = await listPurchaseOrders(ctx, f);
  const csv = toCsv(
    ["PO", "Status", "Site", "Supplier code", "Supplier", "Order date", "Expected", "Late", "Urgent", "Lines", "Total", "Currency"],
    rows.map((r) => [r.number, r.status, r.siteCode, r.supplierCode, r.supplierName, r.orderDate, r.expectedDate, r.late ? "yes" : "no", r.urgent ? "yes" : "no", r.lines, canSeePrices(ctx) ? (r.totalAmount ?? "") : "", r.currency]),
  );
  await audit(db, ctx, { action: "platform.export.created", entityType: "export", siteId: null, after: { kind: "purchase_orders", rows: rows.length, filter: f } });
  return { csv, fileName: `purchase-orders-${businessDate()}.csv`, rows: rows.length };
}

export type PoLine = PoLineRow;

/** Pickers of the PO form at the caller's current site: suppliers (active, not suspended) and warehouses. */
export async function poFormOptions(ctx: AuthContext) {
  ctx.require("procurement.purchase_order.create");
  const sups = await db
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, qualityStatus: suppliers.qualityStatus, paymentTermsDays: suppliers.paymentTermsDays })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true)))
    .orderBy(asc(suppliers.name));
  const whs = await db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.siteId, ctx.currentSiteId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code));
  return { suppliers: sups.filter((s) => s.qualityStatus !== "suspended"), warehouses: whs };
}

/**
 * The current recorded PO document (printable supplier copy). It carries prices, so viewing needs the PO
 * view permission, supplier prices and generated-document view.
 */
export async function currentPurchaseOrderDocument(ctx: AuthContext, poId: string) {
  ctx.require("procurement.purchase_order.view");
  ctx.require("masterdata.supplier_price.view");
  ctx.require("documents.generated_document.view");
  if (!isUuid(poId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, ctx.organizationId))).limit(1);
  if (!po || !ctx.allowedSiteIds.includes(po.siteId)) throw new DomainError("not_found", "Purchase order not found in your sites.");
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.sourceEntityType, "purchase_order"), eq(generatedDocuments.sourceEntityId, po.id), eq(generatedDocuments.documentKind, "purchase_order"), eq(generatedDocuments.status, "ready")))
    .orderBy(desc(generatedDocuments.generatedAt))
    .limit(1);
  return { po: { id: po.id, poNumber: po.poNumber, status: po.status as PoStatus }, document: doc ?? null };
}

/**
 * Re-records the PO document of a sent order (e.g. after the supplier confirmed a promised date, or for
 * an order sent before documents were recorded); the previous one is superseded (§1.6).
 */
export async function regeneratePoDocument(ctx: AuthContext, input: { purchaseOrderId: string }) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.post", po.siteId);
    if (!["sent", "partially_received", "received"].includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}; the document is recorded when it is sent.`);
    const doc = await renderPoDocument(tx, ctx, po, null);
    await tx.update(purchaseOrders).set({ generatedDocumentId: doc.id }).where(eq(purchaseOrders.id, po.id));
    await audit(tx, ctx, { action: "procurement.purchase_order.document_regenerated", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, after: { documentNumber: doc.documentNumber } });
    return { documentId: doc.id, documentNumber: doc.documentNumber };
  });
}

/**
 * Deletes a purchase order that is a never-submitted draft (ADR-075), with its lines and state
 * history. Refused when a line came from a purchase request (cancel it instead, so the request's
 * history stays whole). Creator (procurement.purchase_order.create) or
 * procurement.purchase_order.edit at the site. Audit procurement.purchase_order.deleted.
 */
export async function deletePurchaseOrderDraft(ctx: AuthContext, input: { purchaseOrderId: string }) {
  return db.transaction(async (tx) => {
    const po = await lockPo(tx, ctx, input.purchaseOrderId);
    const what = `Purchase order ${po.poNumber}`;
    assertMayDeleteDraft(ctx, { create: "procurement.purchase_order.create", manage: ["procurement.purchase_order.edit"] }, po.createdBy, po.siteId);
    assertNeverSubmittedDraft(what, po.status === "draft", po.submittedAt);
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    if (lines.some((l) => l.purchaseRequestLineId)) throw new DomainError("state", `${what} was made from a purchase request, so it is kept. Cancel it instead.`, { code: "FROM_REQUEST" });
    await hardDeleteDraft(tx, ctx, {
      table: "purchase_orders",
      id: po.id,
      what,
      children: [
        { table: "purchase_order_lines", column: "purchase_order_id" },
        { table: "purchase_order_state_transitions", column: "purchase_order_id" },
      ],
      audit: { action: "procurement.purchase_order.deleted", entityType: "purchase_order", entityNumber: po.poNumber, siteId: po.siteId, before: { ...po, lines } },
    });
    return { deleted: po.poNumber };
  });
}
