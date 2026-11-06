import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { customerRequirements, packs, pickLines, picks, priceLists, quotes, salesOrders, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type NextActors, approvalStepRecord, nextActors, sodRequired } from "@/modules/governance";
import { approvalProgress } from "./crm-approvals";

export type SalesHandoff = "quote" | "sales_order" | "price_list" | "customer_requirement";

/**
 * Who approves a price offer, customer order, price list or customer requirement next (ADR-109, docs/NEXT_APPROVER.md):
 * the same steps, roles and same-person rules as the "To approve" verdicts (approval-gates.ts): the open step's roles,
 * never the creator or submitter (ADR-091 top roles excepted; none when separation is switched off for the type),
 * never an earlier step's approver. Null unless the record waits for approval and is visible to the viewer.
 */
export async function salesNextActors(ctx: AuthContext, type: SalesHandoff, id: string, q: DbOrTx = db): Promise<NextActors | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (type === "customer_requirement") {
    const [r] = await q.select().from(customerRequirements).where(and(eq(customerRequirements.id, id), eq(customerRequirements.organizationId, ctx.organizationId))).limit(1);
    if (!r || r.status !== "pending_approval") return null;
    return nextActors(ctx, "customer_requirement", { siteId: null, excludeUserIds: [r.submittedBy, r.createdBy] }, q);
  }
  if (type === "price_list") {
    const [p] = await q.select().from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.organizationId, ctx.organizationId))).limit(1);
    if (!p || p.status !== "pending_approval") return null;
    const progress = await approvalProgress(q, ctx.organizationId, { recordType: "price_list", recordId: p.id, siteId: null, basis: {} });
    return nextActors(ctx, "price_list", approvalStepRecord({ siteId: null, excludeUserIds: [p.submittedBy, p.updatedBy, p.createdBy] }, progress, p.submittedAt), q);
  }
  if (type === "quote") {
    const [x] = await q.select().from(quotes).where(and(eq(quotes.id, id), eq(quotes.organizationId, ctx.organizationId))).limit(1);
    if (!x || x.status !== "pending_approval" || !ctx.allowedSiteIds.includes(x.siteId)) return null;
    const sod = await sodRequired(q, ctx.organizationId, "quote");
    const progress = await approvalProgress(q, ctx.organizationId, { recordType: "quote", recordId: x.id, siteId: x.siteId, basis: { discount_pct: x.maxDiscountPct } });
    return nextActors(ctx, "quotation", approvalStepRecord({ siteId: x.siteId, excludeUserIds: sod ? [x.createdBy, x.submittedBy] : [] }, progress, x.submittedAt), q);
  }
  const [o] = await q.select().from(salesOrders).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, ctx.organizationId))).limit(1);
  if (!o || o.status !== "pending_approval" || !ctx.allowedSiteIds.includes(o.siteId)) return null;
  const sod = await sodRequired(q, ctx.organizationId, "sales_order");
  const progress = await approvalProgress(q, ctx.organizationId, { recordType: "sales_order", recordId: o.id, siteId: o.siteId, basis: (o.approvalBasis ?? {}) as Record<string, string | boolean> });
  return nextActors(ctx, "sales_order", approvalStepRecord({ siteId: o.siteId, excludeUserIds: sod ? [o.createdBy, o.submittedBy] : [] }, progress, o.submittedAt), q);
}

/**
 * Who does the second check of the boxes (ADR-109): `inventory.pack.approve` at the site, never the person who took the
 * items off the shelf or scanned them (sod.pack.checker_not_packer), nor the packer of a warehouse pack. Independent:
 * no ADR-091 exception. Null unless the delivery or pack waits for its check.
 */
export async function packCheckNext(ctx: AuthContext, ref: { shipmentId: string } | { packId: string }, q: DbOrTx = db): Promise<NextActors | null> {
  if ("packId" in ref) {
    if (!/^[0-9a-f-]{36}$/i.test(ref.packId)) return null;
    const [p] = await q.select().from(packs).where(and(eq(packs.id, ref.packId), eq(packs.organizationId, ctx.organizationId))).limit(1);
    if (!p || p.status !== "open" || !p.submittedAt || !ctx.allowedSiteIds.includes(p.siteId)) return null;
    return nextActors(ctx, "pack_check", { siteId: p.siteId, excludeUserIds: [p.packedBy] }, q);
  }
  if (!/^[0-9a-f-]{36}$/i.test(ref.shipmentId)) return null;
  const [s] = await q.select().from(shipments).where(and(eq(shipments.id, ref.shipmentId), eq(shipments.organizationId, ctx.organizationId))).limit(1);
  if (!s || s.status !== "picked" || !ctx.allowedSiteIds.includes(s.siteId)) return null;
  return nextActors(ctx, "pack_check", { siteId: s.siteId, excludeUserIds: await pickPeople(q, s.id) }, q);
}

/** The person who completed the pick of a delivery and everyone who scanned it (never the box checker). */
export async function pickPeople(q: DbOrTx, shipmentId: string): Promise<string[]> {
  const ps = await q.select({ id: picks.id, completedBy: picks.completedBy, createdBy: picks.createdBy }).from(picks).where(eq(picks.shipmentId, shipmentId));
  const out = new Set<string>();
  for (const p of ps) {
    if (p.completedBy) out.add(p.completedBy);
    const scanners = await q.selectDistinct({ by: pickLines.pickedBy }).from(pickLines).where(and(eq(pickLines.pickId, p.id), isNull(pickLines.voidedAt)));
    for (const x of scanners) if (x.by) out.add(x.by);
  }
  return [...out];
}
