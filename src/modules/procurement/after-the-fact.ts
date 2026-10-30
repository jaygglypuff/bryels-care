import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq, ne } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { goodsReceiptLines, goodsReceipts, materials, purchaseOrderLines, purchaseOrders, suppliers } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { notifyRoles } from "@/modules/platform";
import { normalizePo } from "./orders";
import { logCreation } from "./state";
import { businessDate, cleanText, idempotent, isUuid, money4, requireReason } from "./shared";

/**
 * After-the-fact purchase orders (S6, ADR-077). The owner buys urgently without a PO: the warehouse
 * receives the delivery as an unplanned receipt (existing W01 flow). Later the buyer opens the receipt
 * and chooses "Create PO from this receipt": a draft PO pre-filled from the received lines (supplier,
 * items, quantities; the buyer enters the unit prices), marked after-the-fact with a reason and linked to
 * the receipt.
 *
 * - The lines are already received (`qty_received_base` = the receipt line quantity, line status
 *   `received`), so nothing is expected: no expected receipt, no reorder "on order" quantity, and the PO can
 *   never be received again (it is never `sent`).
 * - Normal approval rules apply (submit → approval steps by total; creator and submitter never approve). On
 *   the final approval the PO goes approved → received in the same transaction (no sending: the goods are
 *   here). Supplier bills match the receipt lines to these PO lines (finance-match.ts).
 * - One live PO per receipt (unique index; the receipt row is locked). A cancelled draft frees the receipt.
 * - The posted receipt itself is never edited; the link is on the PO side (`source_goods_receipt_id`,
 *   `purchase_order_lines.source_goods_receipt_line_id`).
 */

export type PoFromReceiptInput = {
  goodsReceiptId: string;
  /** Defaults to the receipt's linked supplier. */
  supplierId?: string | null;
  reason: string;
  lines: { receiptLineId: string; unitAmount?: string | null }[];
  taxAmount?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

async function loadReceipt(tx: DbOrTx, ctx: AuthContext, receiptId: string, lock: boolean) {
  if (!isUuid(receiptId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  const base = tx
    .select()
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.organizationId, ctx.organizationId)))
    .limit(1);
  const [gr] = lock ? await base.for("update") : await base;
  if (!gr || !ctx.allowedSiteIds.includes(gr.siteId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  return gr;
}

/** The live (not cancelled) after-the-fact PO of a receipt, if any. */
export async function poOfReceipt(q: DbOrTx, organizationId: string, receiptId: string) {
  const [po] = await q
    .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.sourceGoodsReceiptId, receiptId), ne(purchaseOrders.status, "cancelled")))
    .limit(1);
  return po ?? null;
}

/** Why a receipt cannot get an after-the-fact PO (null = it can). */
function blockedReason(gr: typeof goodsReceipts.$inferSelect): string | null {
  if (gr.receiptKind === "purchase_order") return "This delivery was already received against a purchase order.";
  if (gr.receiptKind !== "unplanned") return "Opening stock has no supplier purchase order.";
  if (gr.status !== "posted") return gr.status === "draft" ? "Post the receipt first; a purchase order is made from received goods." : `The receipt is ${gr.status}.`;
  return null;
}

/** Creates the after-the-fact PO (draft) from a posted unplanned receipt. Idempotent per key. */
export async function createPoFromReceipt(ctx: AuthContext, input: PoFromReceiptInput) {
  ctx.require("procurement.purchase_order.create");
  ctx.assertWritable();
  const reason = requireReason(input.reason, "reason");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DomainError("validation", "Choose at least one received line.", { field: "lines" });
  const notes = cleanText(input.notes, 1000, "notes", "Notes");
  return db.transaction(async (tx) => {
    const gr = await loadReceipt(tx, ctx, input.goodsReceiptId, true);
    ctx.requireAt("procurement.purchase_order.create", gr.siteId);
    const r = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.purchase_order.create_from_receipt", async () => {
      const blocked = blockedReason(gr);
      if (blocked) throw new DomainError("state", blocked);
      const existing = await poOfReceipt(tx, ctx.organizationId, gr.id);
      if (existing) throw new DomainError("conflict", `Receipt ${gr.receiptNumber} already has purchase order ${existing.poNumber}.`, { purchaseOrderId: existing.id });
      const supplierId = input.supplierId || gr.supplierId;
      if (!supplierId) throw new DomainError("validation", "Choose the supplier (this receipt is not linked to a supplier record).", { field: "supplierId" });

      const grLines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, gr.id)).orderBy(asc(goodsReceiptLines.lineNo));
      const seen = new Set<string>();
      const picked = input.lines.map((l, i) => {
        const gl = grLines.find((x) => x.id === l.receiptLineId);
        if (!gl || !gl.lotId) throw new DomainError("validation", `Line ${i + 1}: that line is not on receipt ${gr.receiptNumber}.`, { field: `lines.${i}.receiptLineId` });
        if (seen.has(gl.id)) throw new DomainError("validation", `Line ${i + 1}: receipt line ${gl.lineNo} is listed twice.`, { field: `lines.${i}.receiptLineId` });
        seen.add(gl.id);
        return { gl, unitAmount: l.unitAmount };
      });
      const mats = await tx.select({ id: materials.id, baseUom: materials.baseUom }).from(materials).where(eq(materials.organizationId, ctx.organizationId));
      const orderDate = businessDate();
      // Same validation as a normal PO: approved supplier × material (V-ASL), units, price (entered or the supplier price).
      const v = await normalizePo(
        tx,
        ctx,
        gr.siteId,
        {
          supplierId,
          notes,
          taxAmount: input.taxAmount,
          lines: picked.map(({ gl, unitAmount }) => ({
            materialId: gl.materialId,
            qty: gl.qtyEntered ?? gl.qtyBase,
            uom: gl.uomEntered ?? mats.find((m) => m.id === gl.materialId)?.baseUom ?? null,
            unitAmount: unitAmount ?? null,
            expectedDate: orderDate,
          })),
        },
        orderDate,
      );
      const poNumber = await nextNumber(tx, ctx.organizationId, "PO");
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: ctx.organizationId,
          siteId: gr.siteId,
          poNumber,
          status: "draft",
          supplierId: v.supplier.id,
          orderDate,
          expectedDate: null,
          paymentTermsDays: v.paymentTermsDays,
          subtotalAmount: money4(v.subtotal),
          taxAmount: money4(v.tax),
          totalAmount: money4(v.total),
          notes: v.notes,
          afterTheFact: true,
          afterTheFactReason: reason,
          sourceGoodsReceiptId: gr.id,
          createdBy: ctx.userId,
          statusChangedBy: ctx.userId,
        })
        .returning();
      for (const [i, l] of v.lines.entries()) {
        const gl = picked[i].gl;
        // The receipt's base quantity is the truth: the line is fully received and nothing stays open.
        await tx.insert(purchaseOrderLines).values({
          organizationId: ctx.organizationId,
          siteId: po.siteId,
          purchaseOrderId: po.id,
          lineNo: i + 1,
          materialId: l.mat.id,
          supplierMaterialId: l.sm.id,
          qtyEntered: l.qty.toString(),
          uomEntered: l.uom,
          qtyBase: new Decimal(gl.qtyBase).toString(),
          baseUom: l.mat.baseUom,
          unitAmount: money4(l.unit),
          lineAmount: money4(l.amount),
          currency: po.currency,
          expectedDate: null,
          qtyReceivedBase: new Decimal(gl.qtyBase).toString(),
          lineStatus: "received",
          sourceGoodsReceiptLineId: gl.id,
        });
      }
      await logCreation(tx, ctx, "po", po);
      const lineAudit = v.lines.map((l, i) => ({ material: l.mat.code, qty: l.qty.toString(), uom: l.uom, unit: money4(l.unit), receiptLine: picked[i].gl.lineNo }));
      await audit(tx, ctx, {
        action: "procurement.purchase_order.created_after_receipt",
        entityType: "purchase_order",
        entityId: po.id,
        entityNumber: poNumber,
        siteId: po.siteId,
        reason,
        after: { afterTheFact: true, receipt: gr.receiptNumber, receiptId: gr.id, supplier: v.supplier.code, total: money4(v.total), lines: lineAudit, warnings: v.warnings.filter((w) => w.code !== "lead_time") },
      });
      await audit(tx, ctx, { action: "procurement.goods_receipt.po_created_after", entityType: "goods_receipt", entityId: gr.id, entityNumber: gr.receiptNumber, siteId: gr.siteId, reason, after: { purchaseOrderId: po.id, poNumber } });
      await notifyRoles(tx, { roleCodes: ["owner_director"], siteId: po.siteId }, { organizationId: ctx.organizationId, siteId: po.siteId, kind: "purchase_order_urgent", severity: "warning", title: `Purchase order ${poNumber} made after the goods arrived`, body: `${reason} (receipt ${gr.receiptNumber}).`, entityType: "purchase_order", entityId: po.id, link: `/procurement/orders/${po.id}` });
      return { purchaseOrderId: po.id, poNumber, warnings: v.warnings.filter((w) => w.code !== "lead_time") };
    });
    return { ...r.result, replayed: r.replayed };
  });
}

/** What the "Create PO from this receipt" form needs: the receipt lines, the supplier and whether it is allowed. */
export async function poFromReceiptOptions(ctx: AuthContext, receiptId: string) {
  ctx.require("procurement.goods_receipt.view");
  const gr = await loadReceipt(db, ctx, receiptId, false);
  const po = await poOfReceipt(db, ctx.organizationId, gr.id);
  const lines = await db
    .select({ id: goodsReceiptLines.id, lineNo: goodsReceiptLines.lineNo, lotId: goodsReceiptLines.lotId, materialId: goodsReceiptLines.materialId, code: materials.code, name: materials.name, qtyEntered: goodsReceiptLines.qtyEntered, uomEntered: goodsReceiptLines.uomEntered, qtyBase: goodsReceiptLines.qtyBase, baseUom: materials.baseUom })
    .from(goodsReceiptLines)
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .where(eq(goodsReceiptLines.goodsReceiptId, gr.id))
    .orderBy(asc(goodsReceiptLines.lineNo));
  const sups = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true))).orderBy(asc(suppliers.name));
  const blocked = blockedReason(gr);
  return {
    purchaseOrder: po,
    canCreate: !po && !blocked && ctx.canAt("procurement.purchase_order.create", gr.siteId),
    blockedReason: po ? null : blocked,
    supplierId: gr.supplierId,
    suppliers: sups,
    lines: lines.filter((l) => !!l.lotId),
  };
}
