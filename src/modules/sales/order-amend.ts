import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { customers, pickLines, picks, products, salesOrderLines, salesOrders, stockAllocations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { fmtQty } from "@/lib/qty";
import { notifyNextActors } from "@/modules/governance";
import { evaluateCredit } from "./credit";
import { idempotent, isUuid, salesTaxRatePct, totals } from "./crm-support";
import { advanceOrder } from "./fulfilment-state";
import { lockOrder } from "./orders";

/**
 * ADR-131 (C-office problem 1, "a confirmed order cannot be changed"): change how many of one line, or cancel one line,
 * on a confirmed customer order, with a reason. The order keeps its number, its state machine and its history.
 *
 * - Allowed while the order is confirmed, set aside (allocated) or partly sent, by `sales.sales_order.edit` at the
 *   order's site. A draft is changed with "Change the draft"; a fully sent, invoiced, closed or cancelled order not at all.
 * - Never below what is already sent or on an open list to get from the shelf ("taken off the shelf").
 * - Lowering frees the set-aside stock above the new amount (newest first; a loose set-aside is cut, a box is let go
 *   whole). Raising is allowed only while nothing of that line is set aside and re-runs the credit check: over the
 *   limit it is refused (make a new order for the extra, so it goes through approval).
 * - Cancelling a line = its amount becomes what was already sent (0 when nothing was sent). The last open line is not
 *   cancelled: cancel the whole order instead.
 * - Totals are worked out again; a confirmed order whose lines are now all set aside becomes "set aside"; a partly sent
 *   order whose lines are now all sent becomes "sent". One audit event `sales.sales_order.line_changed` per change
 *   (actor, time, reason, before/after, stock let go), shown in the order's history. Idempotent on the key.
 */
export const AMENDABLE_ORDER_STATUSES = ["confirmed", "allocated", "partially_shipped"] as const;

export type LineChangeResult = { orderNumber: string; lineNo: number; productName: string; before: string; after: string; released: string; status: string; replayed?: boolean };

export async function changeOrderLine(ctx: AuthContext, input: { lineId: string; qty: string | number; reason: string; idempotencyKey?: string | null }): Promise<LineChangeResult> {
  ctx.require("sales.sales_order.edit");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) throw new DomainError("validation", "Say why the customer changed the order (at least 3 characters).", { field: "reason" });
  const raw = String(input.qty ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new DomainError("validation", "Type how many pieces, as a whole number (0 or more).", { field: "qty" });
  const want = new Decimal(raw);
  if (!isUuid(input.lineId)) throw new DomainError("not_found", "Order line not found in your sites.");
  return db.transaction(async (tx) => {
    const [l0] = await tx.select({ orderId: salesOrderLines.salesOrderId }).from(salesOrderLines).where(eq(salesOrderLines.id, input.lineId)).limit(1);
    if (!l0) throw new DomainError("not_found", "Order line not found in your sites.");
    const o = await lockOrder(tx, ctx, l0.orderId);
    ctx.requireAt("sales.sales_order.edit", o.siteId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "sales.sales_order.line_change", async () => {
      if (o.status === "draft") throw new DomainError("state", `Order ${o.orderNumber} is a draft: use “Change the draft”.`);
      if (!(AMENDABLE_ORDER_STATUSES as readonly string[]).includes(o.status)) throw new DomainError("state", `Order ${o.orderNumber} can no longer be changed (${o.status.replace(/_/g, " ")}). For a change after delivery, use a customer return or a credit.`);
      const lines = await tx.select({ l: salesOrderLines, name: products.name }).from(salesOrderLines).innerJoin(products, eq(products.id, salesOrderLines.productId)).where(eq(salesOrderLines.salesOrderId, o.id)).for("update", { of: salesOrderLines });
      const me = lines.find((x) => x.l.id === input.lineId)!;
      const before = new Decimal(me.l.qtyUnits);
      if (want.eq(before)) throw new DomainError("validation", `${me.name} is already ${fmtQty(before, "pcs", 0)}.`, { field: "qty" });
      const allocs = await tx.select().from(stockAllocations).where(and(eq(stockAllocations.salesOrderLineId, me.l.id), inArray(stockAllocations.status, ["open", "fulfilled"]))).orderBy(desc(stockAllocations.createdAt)).for("update");
      const sent = allocs.filter((a) => a.status === "fulfilled").reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      const open = allocs.filter((a) => a.status === "open");
      const onPickIds = open.length
        ? new Set(
            (
              await tx
                .select({ id: pickLines.allocationId })
                .from(pickLines)
                .innerJoin(picks, eq(picks.id, pickLines.pickId))
                .where(and(inArray(pickLines.allocationId, open.map((a) => a.id)), isNull(pickLines.voidedAt), inArray(picks.status, ["draft", "in_progress"])))
            ).map((r) => r.id as string),
          )
        : new Set<string>();
      const onPick = open.filter((a) => onPickIds.has(a.id)).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      const floor = sent.plus(onPick);
      if (want.lt(floor)) {
        throw new DomainError("validation", `${fmtQty(sent, "pcs", 0)} already sent${onPick.gt(0) ? ` and ${fmtQty(onPick, "pcs", 0)} being taken off the shelf` : ""}: the amount cannot go below ${fmtQty(floor, "pcs", 0)}.`, { field: "qty" });
      }
      const openAfter = lines.filter((x) => x.l.id !== me.l.id && new Decimal(x.l.qtyUnits).gt(0)).length + (want.gt(0) ? 1 : 0);
      if (openAfter === 0) throw new DomainError("state", "This is the only product left on the order: cancel the whole order instead (⋯ More → Cancel order).");
      let released = new Decimal(0);
      const releasedRows: { id: string; qty: string; whole: boolean }[] = [];
      const setAside = open.reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      if (want.gt(before)) {
        // Raising: only before any stock of this line is set aside, and inside the customer's credit.
        if (setAside.gt(0) || sent.gt(0)) throw new DomainError("state", `Stock of ${me.name} is already set aside or sent. To add more, make a new order for the extra pieces.`);
        const [c] = await tx.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
        const rate = await salesTaxRatePct(tx, ctx.organizationId);
        const t = totals(lines.map((x) => ({ qty: x.l.id === me.l.id ? want : x.l.qtyUnits, price: x.l.unitPrice })), rate);
        const credit = await evaluateCredit(tx, ctx.organizationId, c, t.total, o.id);
        if (credit.failed) throw new DomainError("state", `The bigger amount needs an OK (${credit.reasons.map((r) => r.message.toLowerCase()).join("; ")}). Make a new order for the extra pieces so it is approved.`);
      } else {
        // Lowering: let go of the set-aside stock above the new amount (never what is on a pick list).
        let excess = sent.plus(setAside).minus(want);
        for (const a of open) {
          if (excess.lte(0)) break;
          if (onPickIds.has(a.id)) continue;
          const q = new Decimal(a.qtyUnits);
          if (q.lte(excess) || a.containerId) {
            await tx.update(stockAllocations).set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releaseReason: `Order changed: ${reason}` }).where(eq(stockAllocations.id, a.id));
            released = released.plus(q);
            excess = excess.minus(q);
            releasedRows.push({ id: a.id, qty: q.toString(), whole: true });
          } else {
            await tx.update(stockAllocations).set({ qtyUnits: q.minus(excess).toString() }).where(eq(stockAllocations.id, a.id));
            released = released.plus(excess);
            releasedRows.push({ id: a.id, qty: excess.toString(), whole: false });
            excess = new Decimal(0);
          }
        }
      }
      await tx.update(salesOrderLines).set({ qtyUnits: want.toString() }).where(eq(salesOrderLines.id, me.l.id));
      const rate = await salesTaxRatePct(tx, ctx.organizationId);
      const t = totals(lines.map((x) => ({ qty: x.l.id === me.l.id ? want : x.l.qtyUnits, price: x.l.unitPrice })), rate);
      await tx.update(salesOrders).set({ subtotalAmount: t.subtotal, taxAmount: t.tax, totalAmount: t.total, updatedAt: new Date() }).where(eq(salesOrders.id, o.id));
      // The order's step follows its lines.
      const after = await tx.select({ l: salesOrderLines }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
      const allocNow = await tx.select().from(stockAllocations).where(and(inArray(stockAllocations.salesOrderLineId, after.map((x) => x.l.id)), inArray(stockAllocations.status, ["open", "fulfilled"])));
      const sumFor = (id: string, st: string[]) => allocNow.filter((a) => a.salesOrderLineId === id && st.includes(a.status)).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
      const allSent = after.every((x) => sumFor(x.l.id, ["fulfilled"]).gte(x.l.qtyUnits));
      const allAside = after.every((x) => sumFor(x.l.id, ["open", "fulfilled"]).gte(x.l.qtyUnits));
      const statusBefore = o.status;
      if (o.status === "partially_shipped" && allSent) await advanceOrder(tx, ctx, o, "shipped", `Order changed: ${reason}`);
      else if (o.status === "confirmed" && allAside && allocNow.some((a) => a.status === "open")) await advanceOrder(tx, ctx, o, "allocated", `Order changed: ${reason}`);
      await audit(tx, ctx, {
        action: "sales.sales_order.line_changed",
        entityType: "sales_order",
        entityId: o.id,
        entityNumber: o.orderNumber,
        siteId: o.siteId,
        reason,
        before: { lineNo: me.l.lineNo, product: me.name, qty: before.toString(), status: statusBefore, total: o.totalAmount },
        after: { lineNo: me.l.lineNo, product: me.name, qty: want.toString(), cancelled: want.eq(sent) && want.lt(before), status: o.status, total: t.total, released: releasedRows },
      });
      if (released.gt(0)) {
        await notifyNextActors(tx, ctx, "set_aside", { siteId: o.siteId, excludeUserIds: [ctx.userId] }, {
          title: `Order ${o.orderNumber} changed: ${fmtQty(released, "pcs", 0)} ${me.name} no longer needed`,
          body: `The set-aside stock was let go (${reason}). Do not pick it for this order.`,
          link: `/sales/${o.id}`,
          entityType: "sales_order",
          entityId: o.id,
          dedupeKey: `order-line-changed:${me.l.id}:${want.toString()}`,
        }).catch(() => undefined);
      }
      return { orderNumber: o.orderNumber, lineNo: me.l.lineNo, productName: me.name, before: before.toString(), after: want.toString(), released: released.toString(), status: o.status };
    });
    return result;
  });
}

/** "Cancel this line": the line's amount becomes what was already sent (0 when nothing was sent). */
export async function cancelOrderLine(ctx: AuthContext, input: { lineId: string; reason: string; idempotencyKey?: string | null }): Promise<LineChangeResult> {
  ctx.require("sales.sales_order.edit");
  if (!isUuid(input.lineId)) throw new DomainError("not_found", "Order line not found in your sites.");
  const sent = await db
    .select({ q: stockAllocations.qtyUnits })
    .from(stockAllocations)
    .where(and(eq(stockAllocations.salesOrderLineId, input.lineId), eq(stockAllocations.status, "fulfilled")));
  const total = sent.reduce((s, r) => s.plus(r.q), new Decimal(0));
  return changeOrderLine(ctx, { lineId: input.lineId, qty: total.toString(), reason: input.reason, idempotencyKey: input.idempotencyKey });
}
