import "server-only";
import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, db } from "@/db/client";
import { equipment, routingRevisions, routingSteps, routings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

/**
 * ADR-104 §4, the largest batch of a product at a site (A-FD-05). The routing effective on the date names the
 * kind of mixing equipment its steps need (mixer, kettle, homogenizer). For each such kind the largest batch is
 * the biggest recorded capacity (capacity_max in g or kg) of in-service equipment of that kind at the site;
 * the product's largest batch is the smallest of those (every mixing step must take the batch). Litres are not
 * converted (no density is assumed). Null = no capacity known: the screen and the server then use the recipe's
 * batch size as the largest (conservative until QA records a capacity).
 */

export const MIXING_EQUIPMENT_KINDS = ["mixer", "kettle", "homogenizer"] as const;

export type LargestBatch = { grams: string | null; from: string | null };

function toGrams(v: string | null, uom: string | null): Decimal | null {
  if (!v) return null;
  const u = (uom ?? "").trim().toLowerCase();
  if (u === "g") return new Decimal(v);
  if (u === "kg") return new Decimal(v).mul(1000);
  return null;
}

export async function largestBatchFor(q: DbOrTx, organizationId: string, productId: string, siteId: string, onDate: string): Promise<LargestBatch> {
  const [rev] = await q
    .select({ id: routingRevisions.id })
    .from(routingRevisions)
    .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
    .where(and(eq(routings.organizationId, organizationId), eq(routings.productId, productId), eq(routingRevisions.status, "approved"), lte(routingRevisions.effectiveFrom, onDate), or(isNull(routingRevisions.effectiveTo), gt(routingRevisions.effectiveTo, onDate))))
    .orderBy(desc(routingRevisions.effectiveFrom), desc(routingRevisions.revisionNo))
    .limit(1);
  if (!rev) return { grams: null, from: null };
  const steps = await q.select({ kind: routingSteps.equipmentKind }).from(routingSteps).where(eq(routingSteps.routingRevisionId, rev.id));
  const kinds = [...new Set(steps.map((s) => s.kind).filter((k): k is string => !!k && (MIXING_EQUIPMENT_KINDS as readonly string[]).includes(k)))];
  if (!kinds.length) return { grams: null, from: null };
  const eq_ = await q
    .select({ kind: equipment.equipmentKind, name: equipment.name, max: equipment.capacityMax, uom: equipment.capacityUom })
    .from(equipment)
    .where(and(eq(equipment.organizationId, organizationId), eq(equipment.siteId, siteId), eq(equipment.status, "in_service"), inArray(equipment.equipmentKind, kinds)));
  let best: { grams: Decimal; from: string } | null = null;
  for (const k of kinds) {
    let perKind: { grams: Decimal; from: string } | null = null;
    for (const e of eq_.filter((x) => x.kind === k)) {
      const g = toGrams(e.max, e.uom);
      if (g && g.gt(0) && (!perKind || g.gt(perKind.grams))) perKind = { grams: g, from: e.name };
    }
    if (perKind && (!best || perKind.grams.lt(best.grams))) best = perKind;
  }
  return best ? { grams: best.grams.toString(), from: best.from } : { grams: null, from: null };
}

/** The largest batch per product for the New order screen (current site, today's routing). */
export async function largestBatchesForForm(ctx: AuthContext, productIds: string[], onDate: string): Promise<Record<string, LargestBatch>> {
  const out: Record<string, LargestBatch> = {};
  for (const id of [...new Set(productIds)]) out[id] = await largestBatchFor(db, ctx.organizationId, id, ctx.currentSiteId, onDate);
  return out;
}
