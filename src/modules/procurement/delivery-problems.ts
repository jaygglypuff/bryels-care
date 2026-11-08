import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { DELIVERY_PROBLEM_DECISIONS, deliveryProblemDecisions, goodsReceiptLines, goodsReceipts, materials, purchaseOrderLines, purchaseOrders, suppliers } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { notifyRoles } from "@/modules/platform";
import { PO_STATUS_LABEL, type PoStatus, transitionPo } from "./state";
import { cleanText, idempotent, isUuid } from "./shared";
import { lockPo } from "./orders";

/**
 * ADR-131 (C-office problem 11): delivery problems reach purchasing. A posted goods receipt line against a purchase order
 * with a discrepancy (less than ordered, damaged, wrong item) is a "Delivery problem" until purchasing decides:
 *
 * - `send_more`  the supplier sends the rest: the PO line stays open (the warehouse receives it later);
 * - `money_back` ask the supplier for money back (or to take it back): finance is told to expect a supplier credit;
 * - `close_rest` not needed: the open rest of the PO line is short-closed with the reason.
 *
 * One decision per receipt line (unique), audited, idempotent on the key. The receipt itself is never changed.
 */
export type DeliveryProblem = {
  goodsReceiptLineId: string;
  receiptNumber: string | null;
  receivedAt: Date | null;
  purchaseOrderId: string;
  poNumber: string;
  purchaseOrderLineId: string;
  supplierName: string;
  materialName: string;
  kind: string;
  note: string | null;
  receivedBase: string;
  orderedBase: string;
  stillToComeBase: string;
  baseUom: string;
  lineStatus: string;
  decision: { decision: string; note: string; decidedAt: Date } | null;
};

const KIND_WORDS: Record<string, string> = { short: "Less than ordered", damaged: "Damaged", wrong_item: "Wrong item" };
export const deliveryProblemKindWords = (k: string) => KIND_WORDS[k] ?? k.replace(/_/g, " ");

/** Delivery problems at the caller's sites (open first), optionally of one purchase order. */
export async function listDeliveryProblems(ctx: AuthContext, f: { purchaseOrderId?: string; openOnly?: boolean } = {}): Promise<DeliveryProblem[]> {
  ctx.require("procurement.purchase_order.view");
  if (!ctx.allowedSiteIds.length) return [];
  const where = [eq(goodsReceipts.organizationId, ctx.organizationId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds), eq(goodsReceipts.status, "posted"), inArray(goodsReceiptLines.discrepancyKind, ["short", "damaged", "wrong_item"])];
  if (f.purchaseOrderId && isUuid(f.purchaseOrderId)) where.push(eq(purchaseOrders.id, f.purchaseOrderId));
  if (f.openOnly) where.push(isNull(deliveryProblemDecisions.id));
  const rows = await db
    .select({ gl: goodsReceiptLines, gr: goodsReceipts, po: purchaseOrders, pl: purchaseOrderLines, supplierName: suppliers.name, materialName: materials.name, d: deliveryProblemDecisions })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.purchaseOrderLineId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .leftJoin(deliveryProblemDecisions, eq(deliveryProblemDecisions.goodsReceiptLineId, goodsReceiptLines.id))
    .where(and(...where))
    .orderBy(sql`${deliveryProblemDecisions.id} is not null`, desc(goodsReceipts.postedAt))
    .limit(100);
  return rows.map((r) => ({
    goodsReceiptLineId: r.gl.id,
    receiptNumber: r.gr.receiptNumber,
    receivedAt: r.gr.receivedAt,
    purchaseOrderId: r.po.id,
    poNumber: r.po.poNumber,
    purchaseOrderLineId: r.pl.id,
    supplierName: r.supplierName,
    materialName: r.materialName,
    kind: r.gl.discrepancyKind!,
    note: r.gl.discrepancyNote,
    receivedBase: new Decimal(r.gl.qtyBase).toString(),
    orderedBase: new Decimal(r.pl.qtyBase).toString(),
    stillToComeBase: Decimal.max(new Decimal(r.pl.qtyBase).minus(r.pl.qtyReceivedBase), 0).toString(),
    baseUom: r.pl.baseUom,
    lineStatus: r.pl.lineStatus,
    decision: r.d ? { decision: r.d.decision, note: r.d.note, decidedAt: r.d.decidedAt } : null,
  }));
}

export async function decideDeliveryProblem(ctx: AuthContext, input: { goodsReceiptLineId: string; decision: string; note: string; idempotencyKey?: string | null }) {
  ctx.require("procurement.purchase_order.edit");
  if (!(DELIVERY_PROBLEM_DECISIONS as readonly string[]).includes(input.decision)) throw new DomainError("validation", "Choose what happens next.", { field: "decision" });
  const note = cleanText(input.note, 500, "note", "Note");
  if (!note || note.length < 3) throw new DomainError("validation", "Say what was agreed (at least 3 characters).", { field: "note" });
  if (!isUuid(input.goodsReceiptLineId)) throw new DomainError("not_found", "Delivery line not found in your sites.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ gl: goodsReceiptLines, gr: goodsReceipts, pl: purchaseOrderLines })
      .from(goodsReceiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.purchaseOrderLineId))
      .where(and(eq(goodsReceiptLines.id, input.goodsReceiptLineId), eq(goodsReceipts.organizationId, ctx.organizationId)))
      .limit(1);
    if (!row || !ctx.allowedSiteIds.includes(row.gr.siteId)) throw new DomainError("not_found", "Delivery line not found in your sites.");
    const po = await lockPo(tx, ctx, row.pl.purchaseOrderId);
    ctx.requireAt("procurement.purchase_order.edit", po.siteId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey ?? null, "procurement.delivery_problem.decide", async () => {
      if (row.gr.status !== "posted" || !row.gl.discrepancyKind || !["short", "damaged", "wrong_item"].includes(row.gl.discrepancyKind)) throw new DomainError("state", "This delivery line has no problem to decide.");
      const [done] = await tx.select({ id: deliveryProblemDecisions.id }).from(deliveryProblemDecisions).where(eq(deliveryProblemDecisions.goodsReceiptLineId, row.gl.id)).limit(1);
      if (done) throw new DomainError("conflict", "This delivery problem is already decided.");
      const [pl] = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, row.pl.id)).for("update");
      if (input.decision === "send_more" && pl.lineStatus !== "open") throw new DomainError("state", `Nothing more is expected on this order line (${pl.lineStatus.replace("_", " ")}). Choose “Ask for money back” or “Not needed”.`);
      if (input.decision === "close_rest") {
        if (!["sent", "partially_received"].includes(po.status)) throw new DomainError("state", `Purchase order ${po.poNumber} is ${PO_STATUS_LABEL[po.status as PoStatus].toLowerCase()}.`);
        if (pl.lineStatus === "open") {
          await tx.update(purchaseOrderLines).set({ lineStatus: "short_closed", shortClosedAt: new Date(), shortClosedBy: ctx.userId, shortCloseReason: note, updatedAt: new Date() }).where(eq(purchaseOrderLines.id, pl.id));
        }
      }
      await tx.insert(deliveryProblemDecisions).values({ organizationId: ctx.organizationId, siteId: po.siteId, goodsReceiptLineId: row.gl.id, purchaseOrderLineId: pl.id, decision: input.decision, note, decidedBy: ctx.userId, idempotencyKey: input.idempotencyKey ?? null });
      await audit(tx, ctx, { action: "procurement.delivery_problem.decided", entityType: "purchase_order", entityId: po.id, entityNumber: po.poNumber, siteId: po.siteId, reason: note, after: { goodsReceiptLineId: row.gl.id, kind: row.gl.discrepancyKind, decision: input.decision, lineNo: pl.lineNo } });
      if (input.decision === "money_back") {
        await notifyRoles(tx, { roleCodes: ["finance"], siteId: po.siteId }, {
          organizationId: ctx.organizationId,
          siteId: po.siteId,
          kind: "finance.supplier_credit_expected",
          severity: "info",
          title: `Expect money back from the supplier (${po.poNumber})`,
          body: `Purchasing asked the supplier for money back: ${note}. When their credit arrives, enter it as money back from the supplier.`,
          entityType: "purchase_order",
          entityId: po.id,
          link: `/procurement/orders/${po.id}`,
        });
      }
      return { purchaseOrderId: po.id, decision: input.decision };
    });
    // A short-closed line may complete the order (received or nothing more expected).
    if (input.decision === "close_rest") await syncAfterClose(tx, ctx, po);
    return result;
  });
}

async function syncAfterClose(tx: Tx, ctx: AuthContext, po: Awaited<ReturnType<typeof lockPo>>) {
  const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const live = lines.filter((l) => l.lineStatus !== "cancelled");
  const anyReceived = live.some((l) => new Decimal(l.qtyReceivedBase).gt(0));
  const anyOpen = live.some((l) => l.lineStatus === "open");
  const target: PoStatus = !anyOpen && anyReceived ? "received" : anyReceived ? "partially_received" : "sent";
  if (target !== po.status) await transitionPo(tx, ctx, po, target, { reason: "Delivery problem: the rest is not needed" });
}
