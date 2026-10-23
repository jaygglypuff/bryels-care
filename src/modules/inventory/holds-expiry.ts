import "server-only";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { dispositions, inventoryLots, organizations, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthContext } from "@/lib/auth/context";

/**
 * Nightly expiry check (US-2-10 AC2, A-DM-21, A-PROC-36). Runs as the system actor:
 * - lots whose expiry date has passed (Asia/Manila; usable through the end of the expiry day) and that are
 *   not already expired, rejected or recalled get an `expire` disposition and status `expired`;
 * - released lots whose retest date has been reached get a `hold` disposition and status `on_hold`.
 * Idempotent: a second run on the same day finds nothing to do. Concurrent runs serialize on an advisory lock.
 */

export const SYSTEM_ACTOR_EMAIL = "system@bryels-care.invalid";

/** The organization's system actor (users row with status 'system'; it can never sign in). */
export async function systemActorId(organizationId: string): Promise<string> {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.email, SYSTEM_ACTOR_EMAIL))).limit(1);
  if (u) return u.id;
  const [created] = await db
    .insert(users)
    .values({ organizationId, email: SYSTEM_ACTOR_EMAIL, displayName: "System (scheduled jobs)", passwordHash: "!", status: "system" })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (created) return created.id;
  const [again] = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.email, SYSTEM_ACTOR_EMAIL))).limit(1);
  return again.id;
}

/** An AuthContext for the system actor over every active site of the organization (job use only). */
export async function systemContext(organizationId: string, jobCode: string): Promise<AuthContext> {
  const actor = await systemActorId(organizationId);
  const siteRows = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites).where(and(eq(sites.organizationId, organizationId), eq(sites.isActive, true))).orderBy(asc(sites.code));
  return new AuthContext(actor, organizationId, `system:${jobCode}`, SYSTEM_ACTOR_EMAIL, ["system"], new Set<string>(), siteRows, siteRows[0]?.id ?? "");
}

export type ExpiryCheckResult = { asOf: string; expired: { lotNumber: string; from: string }[]; retestHeld: { lotNumber: string }[] };

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * Runs the check for one organization. `asOf` defaults to today in Asia/Manila; a lot expiring on `asOf`
 * is still usable that day. `onBehalfOf` records the user who triggered an on-demand run.
 */
export async function runExpiryCheck(opts: { organizationId: string; asOf?: string; onBehalfOf?: string | null }): Promise<ExpiryCheckResult> {
  const asOf = opts.asOf ?? manilaDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("asOf must be YYYY-MM-DD");
  const ctx = await systemContext(opts.organizationId, "inventory.expiry_check");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"inventory.expiry_check:" + opts.organizationId}))`);
    const expiring = await tx
      .select()
      .from(inventoryLots)
      .where(and(eq(inventoryLots.organizationId, opts.organizationId), lt(inventoryLots.expiresOn, asOf), inArray(inventoryLots.qualityStatus, ["quarantine", "released", "on_hold"])))
      .orderBy(asc(inventoryLots.id))
      .for("update");
    const result: ExpiryCheckResult = { asOf, expired: [], retestHeld: [] };
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
    return result;
  });
}

/** Runs the check for every organization (the scheduled job has no tenant in its payload). */
export async function runExpiryCheckAll(opts: { asOf?: string; onBehalfOf?: string | null } = {}) {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const out: (ExpiryCheckResult & { organizationId: string })[] = [];
  for (const o of orgs) out.push({ organizationId: o.id, ...(await runExpiryCheck({ organizationId: o.id, ...opts })) });
  return out;
}
