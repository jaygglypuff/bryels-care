import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { type NextActors, nextActors } from "@/modules/governance";

/**
 * Who checks next on the floor (docs/NEXT_APPROVER.md): the weighing check, a step's second-person check, the start
 * check, or the out-of-range approver, at the batch's site, never `doerId` (the weigher / the person who did the step;
 * independent second person, ADR-080 §8, also for an owner). Requires the batch at one of the viewer's sites.
 */
export async function floorCheckNext(ctx: AuthContext, kind: "weighing_check" | "step_check" | "start_check" | "out_of_range_weighing" | "material_substitution", batchId: string, doerId: string | null): Promise<NextActors | null> {
  const [b] = await db.select({ siteId: batches.siteId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b || !ctx.allowedSiteIds.includes(b.siteId)) return null;
  return nextActors(ctx, kind, { siteId: b.siteId, excludeUserIds: [doerId] });
}

/**
 * Who approves a production order that waits for approval (draft or planned; ADR-091: the site manager or owner may
 * approve their own). Null for any other status.
 */
export async function productionOrderNext(ctx: AuthContext, workOrderId: string): Promise<NextActors | null> {
  const [wo] = await db.select({ siteId: workOrders.siteId, status: workOrders.status, createdBy: workOrders.createdBy, submittedBy: workOrders.submittedBy }).from(workOrders).where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, ctx.organizationId))).limit(1);
  if (!wo || !ctx.allowedSiteIds.includes(wo.siteId) || !["draft", "planned"].includes(wo.status)) return null;
  // `approvals.sod.work_order_release` off (A-PM-14): the maker may approve too.
  const sod = !!(await getSetting(db, ctx.organizationId, "approvals.sod.work_order_release", wo.siteId));
  return nextActors(ctx, "production_order", { siteId: wo.siteId, excludeUserIds: sod ? [wo.status === "planned" ? (wo.submittedBy ?? wo.createdBy) : wo.createdBy] : [] });
}

/** Who decides the batch on Check quality: holders of quality.disposition.approve at the batch site (QA). */
export async function batchQaNext(ctx: AuthContext, batchId: string): Promise<NextActors | null> {
  const [b] = await db.select({ siteId: batches.siteId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b || !ctx.allowedSiteIds.includes(b.siteId)) return null;
  return nextActors(ctx, "batch_qa", { siteId: b.siteId, excludeUserIds: [] });
}
