import "server-only";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import { dispositions, inventoryBalances, inventoryLots, materials, products } from "@/db/schema";
import { audit } from "@/lib/audit";
import { systemContext } from "@/lib/auth/system";
import { getSetting } from "@/lib/settings";
// Direct import (not the platform index): the platform runtime imports the job registry, which imports this module.
import { notifyUsers, usersWithRoles } from "@/modules/platform/notifications";

/**
 * Nightly expiry check (US-2-10 AC2, A-DM-21, A-PROC-36). Runs as the system actor:
 * - lots whose expiry date has passed (Asia/Manila; usable through the end of the expiry day) and that are
 *   not already expired, rejected or recalled get an `expire` disposition and status `expired`;
 * - released lots whose retest date has been reached get a `hold` disposition and status `on_hold`.
 * Idempotent: a second run on the same day finds nothing to do. Concurrent runs serialize on an advisory lock.
 */

/** Job code; the system actor's audit label is `system:inventory.expiry_check`. */
export const EXPIRY_CHECK_JOB_CODE = "inventory.expiry_check";

export type ExpiryCheckResult = {
  asOf: string;
  expired: { lotNumber: string; from: string }[];
  retestHeld: { lotNumber: string }[];
  /** US-2-16 AC1: lots that entered a near-expiry bucket and the number of new in-app notifications. */
  expiring: { lotNumber: string; bucketDays: number }[];
  notificationsCreated: number;
};

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * Runs the check for one organization. `asOf` defaults to today in Asia/Manila; a lot expiring on `asOf`
 * is still usable that day. `onBehalfOf` records the user who triggered an on-demand run.
 */
export async function runExpiryCheck(opts: { organizationId: string; asOf?: string; onBehalfOf?: string | null; correlationId?: string | null }): Promise<ExpiryCheckResult> {
  const asOf = opts.asOf ?? manilaDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("asOf must be YYYY-MM-DD");
  const ctx = await systemContext(opts.organizationId, { code: EXPIRY_CHECK_JOB_CODE }, { onBehalfOf: opts.onBehalfOf ?? null, correlationId: opts.correlationId ?? null });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"inventory.expiry_check:" + opts.organizationId}))`);
    const expiring = await tx
      .select()
      .from(inventoryLots)
      .where(and(eq(inventoryLots.organizationId, opts.organizationId), lt(inventoryLots.expiresOn, asOf), inArray(inventoryLots.qualityStatus, ["quarantine", "released", "on_hold"])))
      .orderBy(asc(inventoryLots.id))
      .for("update");
    const result: ExpiryCheckResult = { asOf, expired: [], retestHeld: [], expiring: [], notificationsCreated: 0 };
    for (const lot of expiring) {
      await tx.insert(dispositions).values({ id: uuidv7(), organizationId: opts.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision: "expire", fromStatus: lot.qualityStatus, toStatus: "expired", reason: `Expiry date ${lot.expiresOn} passed (expiry check as of ${asOf}).`, decidedBy: ctx.userId });
      await tx.update(inventoryLots).set({ qualityStatus: "expired" }).where(eq(inventoryLots.id, lot.id));
      await audit(tx, ctx, {
        action: "quality.disposition.expired",
        entityType: "inventory_lot",
        entityId: lot.id,
        entityNumber: lot.lotNumber,
        siteId: lot.siteId,
        reason: "Expiry date passed",
        before: { qualityStatus: lot.qualityStatus },
        after: { qualityStatus: "expired", asOf, job: "inventory.expiry_check", onBehalfOf: opts.onBehalfOf ?? null },
      });
      result.expired.push({ lotNumber: lot.lotNumber, from: lot.qualityStatus });
    }
    const retest = await tx
      .select()
      .from(inventoryLots)
      .where(and(eq(inventoryLots.organizationId, opts.organizationId), lte(inventoryLots.retestOn, asOf), eq(inventoryLots.qualityStatus, "released")))
      .orderBy(asc(inventoryLots.id))
      .for("update");
    for (const lot of retest) {
      await tx.insert(dispositions).values({ id: uuidv7(), organizationId: opts.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision: "hold", fromStatus: "released", toStatus: "on_hold", reason: `Retest date ${lot.retestOn} reached (expiry check as of ${asOf}); QA must retest before use.`, decidedBy: ctx.userId });
      await tx.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, lot.id));
      await audit(tx, ctx, {
        action: "quality.disposition.held",
        entityType: "inventory_lot",
        entityId: lot.id,
        entityNumber: lot.lotNumber,
        siteId: lot.siteId,
        reason: "Retest date reached",
        before: { qualityStatus: "released" },
        after: { qualityStatus: "on_hold", asOf, job: "inventory.expiry_check", onBehalfOf: opts.onBehalfOf ?? null },
      });
      result.retestHeld.push({ lotNumber: lot.lotNumber });
    }
    await notifyExpiringLots(tx, opts.organizationId, asOf, result);
    return result;
  });
}

/**
 * US-2-16 AC1: `expiring_lot` in-app notifications to the site's site_manager and qa_qc for lots with
 * stock that expire within a configured bucket (setting `inventory.expiry.alert_days`, A-KPI-03).
 * Deduplicated per lot and bucket, so a lot is announced once when it enters 90, 60 and 30 days.
 */
async function notifyExpiringLots(tx: Tx, organizationId: string, asOf: string, result: ExpiryCheckResult) {
  const buckets = [...(await getSetting(tx, organizationId, "inventory.expiry.alert_days"))].sort((a, b) => a - b);
  const horizon = buckets.at(-1);
  if (!horizon) return;
  const lots = await tx
    .select({
      id: inventoryLots.id,
      siteId: inventoryLots.siteId,
      lotNumber: inventoryLots.lotNumber,
      expiresOn: inventoryLots.expiresOn,
      daysLeft: sql<number>`(${inventoryLots.expiresOn} - ${asOf}::date)::int`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(
      and(
        eq(inventoryLots.organizationId, organizationId),
        inArray(inventoryLots.qualityStatus, ["quarantine", "released", "on_hold"]),
        gte(inventoryLots.expiresOn, asOf),
        sql`${inventoryLots.expiresOn} <= ${asOf}::date + ${horizon}::int`,
        sql`exists (select 1 from ${inventoryBalances} b where b.lot_id = ${inventoryLots.id} and b.qty_base > 0)`,
      ),
    )
    .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber));
  for (const lot of lots) {
    const bucket = buckets.find((b) => lot.daysLeft <= b)!;
    const recipients = await usersWithRoles(tx, organizationId, ["site_manager", "qa_qc"], lot.siteId);
    const created = await notifyUsers(
      tx,
      recipients,
      {
        organizationId,
        siteId: lot.siteId,
        kind: "expiring_lot",
        severity: bucket <= buckets[0] ? "warning" : "info",
        title: `Lot ${lot.lotNumber} expires in ${lot.daysLeft} day${lot.daysLeft === 1 ? "" : "s"}`,
        body: `${lot.itemName ?? "Item"} lot ${lot.lotNumber} expires on ${lot.expiresOn} (within ${bucket} days). Use it first or plan its disposition.`,
        entityType: "inventory_lot",
        entityId: lot.id,
        link: "/inventory/lots/expiry",
        dedupeKey: `expiring_lot:${lot.id}:${bucket}`,
      },
    );
    result.expiring.push({ lotNumber: lot.lotNumber, bucketDays: bucket });
    result.notificationsCreated += created.length;
  }
}
