import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx } from "@/db/client";
import { equipmentUses, maintenancePlans } from "@/db/schema";
import type { AvailabilityReason } from "@/modules/masterdata";

type PlanRow = typeof maintenancePlans.$inferSelect;

/**
 * Usage of one piece of equipment since an instant, from production's equipment uses (W2B):
 * `batches` = distinct batches that used it, `hours` = hours of use (an open use counts until now).
 */
export async function usageSince(q: DbOrTx, equipmentId: string, metric: string, since: Date): Promise<Decimal> {
  if (metric === "batches") {
    const [r] = await q
      .select({ n: sql<string>`count(distinct ${equipmentUses.batchId})::text` })
      .from(equipmentUses)
      .where(and(eq(equipmentUses.equipmentId, equipmentId), gte(equipmentUses.startedAt, since)));
    return new Decimal(r?.n ?? 0);
  }
  const [r] = await q
    .select({ h: sql<string>`coalesce(sum(extract(epoch from (coalesce(${equipmentUses.endedAt}, now()) - ${equipmentUses.startedAt}))) / 3600, 0)::numeric(18,6)::text` })
    .from(equipmentUses)
    .where(and(eq(equipmentUses.equipmentId, equipmentId), gte(equipmentUses.startedAt, since)));
  return new Decimal(r?.h ?? 0);
}

/** Usage of each active usage-based plan (plan id → usage since the last PM). */
export async function planUsage(q: DbOrTx, plans: Pick<PlanRow, "id" | "equipmentId" | "triggerKind" | "usageMetric" | "usageSince">[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  for (const p of plans) if (p.triggerKind === "usage" && p.usageMetric) out.set(p.id, await usageSince(q, p.equipmentId, p.usageMetric, p.usageSince));
  return out;
}

export const USAGE_UNIT: Record<string, string> = { batches: "batches", hours: "h" };

/**
 * Availability provider for the equipment gate (registered in src/modules/wiring.ts): an active usage-based
 * plan whose usage reached its interval is a `maintenance_due` reason (blocking when the equipment's
 * blocking rule is `block`, a warning when `warn`). Time-based plans keep equipment.maintenance_due_date
 * in step instead (plans.ts), so the W1D derivation covers them without this provider.
 */
export async function usageAvailabilityReasons(q: DbOrTx, equipmentIds: string[]): Promise<Map<string, AvailabilityReason[]>> {
  const out = new Map<string, AvailabilityReason[]>();
  if (!equipmentIds.length) return out;
  const plans = await q
    .select()
    .from(maintenancePlans)
    .where(and(inArray(maintenancePlans.equipmentId, equipmentIds), eq(maintenancePlans.status, "active"), eq(maintenancePlans.triggerKind, "usage")));
  if (!plans.length) return out;
  const usage = await planUsage(q, plans);
  for (const p of plans) {
    const used = usage.get(p.id);
    if (!used || !p.usageInterval || used.lt(p.usageInterval)) continue;
    const unit = USAGE_UNIT[p.usageMetric ?? ""] ?? p.usageMetric;
    out.set(p.equipmentId, [...(out.get(p.equipmentId) ?? []), { code: "maintenance_due", detail: `PM ${p.planNumber} is due: ${used.toDecimalPlaces(1).toString()} of ${new Decimal(p.usageInterval).toString()} ${unit} since the last PM`, dueDate: null }]);
  }
  return out;
}
