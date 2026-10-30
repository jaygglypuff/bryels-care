import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { formulaRevisions, products, users, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { type ApprovalVerdict, OWN_REQUEST_REASON } from "@/modules/governance";
import { getEffectiveFormulaRevision } from "@/modules/masterdata";
import { notifyUsers, usersHoldingPermissionAt } from "@/modules/platform/notifications";
import { pieceWord, shortDay } from "./production-order-status";
import { manilaToday } from "./shared";

/**
 * Production orders in "To approve" (consultant review 2026-10-30, flow B: no silent hand-off).
 *
 * A production order waiting for a decision is a work order in `draft` or `planned` (the Approve command
 * `approveProductionOrder` plans, releases, reserves and creates the batches in one transaction). This file
 * holds the read-only "who may decide it now" verdict registered for the action-centre kind
 * `approval.production_order` (src/modules/wiring.ts) and the notification sent to the approvers when an
 * order is created. Both use the rules `approveProductionOrder` enforces:
 *
 * - permission `production.work_order.approve` at the order's site;
 * - separation of duties `approvals.sod.work_order_release` (per site): the person who created the order
 *   (or planned it on the old screen) does not approve it; the owner override applies (ADR-073).
 *
 * The verdict is a screen hint; the Approve command re-checks everything.
 */

export const PRODUCTION_ORDER_APPROVAL_KIND = "approval.production_order";
const DECIDABLE = ["draft", "planned"] as const;
const APPROVE = "production.work_order.approve" as const;
const SOD_REASON = "You created this production order; another person who can approve must approve it.";

type WoRow = typeof workOrders.$inferSelect;

/** "Fri", "today", "Fri 28 Nov" (more than six days away) or "Mon 26 Oct (late)". */
export function neededByWord(neededBy: string | null, now: Date = new Date()): string | null {
  if (!neededBy) return null;
  const today = manilaToday(now);
  const days = Math.round((Date.parse(`${neededBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const at = new Date(`${neededBy}T04:00:00Z`); // noon in Manila, so the weekday is the Manila one
  if (days === 0) return "today";
  if (days < 0) return `${shortDay(at)} (late)`;
  if (days <= 6) return shortDay(at).split(" ")[0];
  return shortDay(at);
}

/** Expected pieces of an order not yet approved: the typed target, else batch mass × yield ÷ piece mass. */
async function expectedPieces(q: DbOrTx, ctx: AuthContext, wo: WoRow, product: { unitNetMassG: string; family: string }): Promise<string | null> {
  let units: Decimal | null = wo.targetUnits ? new Decimal(wo.targetUnits) : null;
  if (!units) {
    let yieldPct: string | null = null;
    if (wo.formulaRevisionId) {
      const [r] = await q.select({ y: formulaRevisions.theoreticalYieldPct }).from(formulaRevisions).where(eq(formulaRevisions.id, wo.formulaRevisionId)).limit(1);
      yieldPct = r?.y ?? null;
    } else {
      yieldPct = (await getEffectiveFormulaRevision(ctx, wo.productId, wo.plannedStart, { tx: q }).catch(() => null))?.rev.theoreticalYieldPct ?? null;
    }
    const mass = new Decimal(product.unitNetMassG);
    if (mass.lte(0)) return null;
    units = new Decimal(wo.qtyPlannedBase).mul(yieldPct ?? 100).div(100).div(mass).floor();
  }
  const n = units.toNumber();
  const fmt = Number.isFinite(n) ? n.toLocaleString("en-PH", { maximumFractionDigits: 0 }) : units.toString();
  return `${fmt} ${pieceWord(product.family, fmt)}`;
}

/** "Acapulco Soap 135 g · 247 bars · needed by Fri" (the number is put in front by the caller). */
export async function productionOrderSummary(q: DbOrTx, ctx: AuthContext, wo: WoRow, product: { name: string; unitNetMassG: string; family: string }, now: Date = new Date()) {
  const pieces = await expectedPieces(q, ctx, wo, product);
  const needed = neededByWord(wo.neededBy, now);
  return [product.name, pieces, needed ? `needed by ${needed}` : null].filter(Boolean).join(" · ");
}

/**
 * Verdicts for "To approve" (registered as the gate of `approval.production_order`). Only draft/planned
 * orders at the caller's sites are returned; anything else is absent (decided since the last sweep, or
 * another site's).
 */
export async function productionOrderApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ wo: workOrders, product: { name: products.name, unitNetMassG: products.unitNetMassG, family: products.family } })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .where(and(eq(workOrders.organizationId, ctx.organizationId), inArray(workOrders.id, ids), inArray(workOrders.siteId, ctx.allowedSiteIds), inArray(workOrders.status, [...DECIDABLE])));
  const makers = [...new Set(rows.map(({ wo }) => makerOf(wo)).filter((x): x is string => !!x))];
  const names = new Map(makers.length ? (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, makers))).map((u) => [u.id, u.name]) : []);
  const sodBySite = new Map<string, boolean>();
  for (const { wo, product } of rows) {
    if (!sodBySite.has(wo.siteId)) sodBySite.set(wo.siteId, !!(await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId)));
    const maker = makerOf(wo);
    const holds = ctx.canAt(APPROVE, wo.siteId);
    const sodBlocks = sodBySite.get(wo.siteId)! && ctx.sodConflict(maker);
    out.set(wo.id, {
      canDecide: holds && !sodBlocks,
      waitingForRoles: [],
      stepLabel: null,
      blockedReason: holds && sodBlocks ? (maker === ctx.userId ? SOD_REASON : OWN_REQUEST_REASON) : null,
      requestedById: maker,
      requestedByName: maker ? (names.get(maker) ?? null) : null,
      title: `Production order ${wo.workOrderNumber} · ${await productionOrderSummary(db, ctx, wo, product)}`,
    });
  }
  return out;
}

/** The person the same-person rule compares with: the creator, or the planner for an order planned on the old screen. */
function makerOf(wo: Pick<WoRow, "status" | "submittedBy" | "createdBy">): string | null {
  return wo.status === "planned" ? (wo.submittedBy ?? wo.createdBy) : wo.createdBy;
}

/**
 * Tells the people who can approve at the order's site that a new production order waits for them
 * (in-app, link to the order, once per order and person). The creator is never notified about their own order.
 * Runs inside the create transaction: no notification for an order that was not saved.
 */
export async function notifyProductionOrderApprovers(tx: DbOrTx, ctx: AuthContext, wo: WoRow) {
  const product = (await tx.select({ name: products.name, unitNetMassG: products.unitNetMassG, family: products.family }).from(products).where(eq(products.id, wo.productId)).limit(1))[0];
  if (!product) return [];
  const to = (await usersHoldingPermissionAt(tx, ctx.organizationId, APPROVE, wo.siteId)).filter((u) => u !== ctx.userId);
  if (!to.length) return [];
  const summary = await productionOrderSummary(tx, ctx, wo, product);
  return notifyUsers(tx, to, {
    organizationId: ctx.organizationId,
    siteId: wo.siteId,
    kind: "production.order.to_approve",
    severity: "info",
    title: `Production order ${wo.workOrderNumber} waits for your approval`,
    body: `${summary}. Created by ${ctx.displayName}. Approve it from To approve or open the order.`,
    entityType: "work_order",
    entityId: wo.id,
    link: `/production/orders/${wo.id}`,
    dedupeKey: `production_order.to_approve:${wo.id}`,
  });
}
