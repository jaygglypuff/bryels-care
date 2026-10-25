/**
 * Wave 4 W4F fictional demo data (retention, legal holds; runs inside the ALLOW_DEMO_SEED-guarded seed):
 * - two operational retention policies stored and confirmed by the demo owner with a note that says the
 *   reviewer is fictional (in-app notifications 180 days, idempotency keys 7 days), so the demo can show
 *   a purge run deleting something; every other class stays an unconfirmed shipped default;
 * - one active legal hold on a released NFD lot placed by the QA lead (a fictional customer claim).
 * No restore drill or purge run is seeded: those screens show their honest empty state until someone
 * runs the drill script or the sweep.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { RETENTION_DEFAULTS } from "../../modules/platform/retention-defaults";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW4f(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const owner = await user("owner@bryels-care.test");
  const admin = await user("admin@bryels-care.test");
  const qa = await user("qa.lead@bryels-care.test");
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, org.id), eq(s.sites.code, "NFD")));
  if (!owner || !admin || !qa || !nfd) return;
  const today = new Date().toISOString().slice(0, 10);
  const note = "Demo confirmation by a fictional reviewer. Real periods need the company's legal, accounting and HR advisers (A-SEC-24).";
  for (const key of ["jobs_notifications/notifications", "idempotency/idempotency_keys"]) {
    const def = RETENTION_DEFAULTS.find((d) => `${d.dataClass}/${d.target}` === key)!;
    await db
      .insert(s.retentionPolicies)
      .values({
        organizationId: org.id,
        dataClass: def.dataClass,
        target: def.target,
        retentionMonths: def.retentionMonths,
        retentionDays: def.retentionDays,
        basis: def.basis,
        minimumMonths: def.minimumMonths,
        action: def.action,
        effectiveFrom: today,
        assumptionId: def.assumptionId,
        updatedBy: admin.id,
        isConfirmed: true,
        confirmedBy: owner.id,
        confirmedAt: new Date(),
        confirmationNote: note,
      })
      .onConflictDoNothing();
  }
  const [lot] = await db
    .select()
    .from(s.inventoryLots)
    .where(and(eq(s.inventoryLots.siteId, nfd.id), eq(s.inventoryLots.qualityStatus, "released")))
    .limit(1);
  if (lot) {
    await db.insert(s.legalHolds).values({
      organizationId: org.id,
      holdKind: "complaint",
      entityType: "inventory_lot",
      entityId: lot.id,
      entityLabel: lot.lotNumber,
      reason: "Demo: keep every record of this lot while a fictional customer claim is open.",
      placedBy: qa.id,
    });
  }
}
