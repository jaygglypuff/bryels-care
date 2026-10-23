/**
 * Wave 1 W1A demo data (fictional only; runs inside the ALLOW_DEMO_SEED-guarded seed):
 * a corrected stock move (transfer → reversal → replacement sharing one correlation id), a clean
 * nightly reconciliation with its job row, and in-app notifications for the demo managers.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW1a(db: Db, organizationId: string) {
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, organizationId), eq(s.sites.code, "NFD")));
  if (!nfd) return;
  const byEmail = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const warehouse = await byEmail("warehouse.nfd@bryels-care.test");
  const manager = await byEmail("manager.nfd@bryels-care.test");
  const admin = await byEmail("admin@bryels-care.test");
  const loc = async (code: string) => (await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, code))))[0];
  const a02 = await loc("A-02");
  const b01 = await loc("B-01");

  // 1. A corrected move: 2,000 g put away to A-02 by mistake, reversed, then posted to B-01.
  const [bal] = await db
    .select({ lotId: s.inventoryBalances.lotId, locationId: s.inventoryBalances.locationId, lot: s.inventoryLots })
    .from(s.inventoryBalances)
    .innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.inventoryBalances.lotId))
    .where(and(eq(s.inventoryBalances.siteId, nfd.id), eq(s.inventoryLots.qualityStatus, "released"), eq(s.inventoryLots.baseUom, "g"), gt(s.inventoryBalances.qtyBase, "5000")))
    .orderBy(desc(s.inventoryBalances.qtyBase))
    .limit(1);
  if (bal && warehouse && manager && a02 && b01 && bal.locationId !== a02.id && bal.locationId !== b01.id) {
    const qty = "2000";
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const shift = async (locationId: string, delta: string) => {
      await db
        .insert(s.inventoryBalances)
        .values({ siteId: nfd.id, lotId: bal.lotId, locationId, qtyBase: delta })
        .onConflictDoUpdate({ target: [s.inventoryBalances.lotId, s.inventoryBalances.locationId], set: { qtyBase: sql`${s.inventoryBalances.qtyBase} + ${delta}::numeric` } });
    };
    const base = { organizationId, siteId: nfd.id, lotId: bal.lotId, qtyBase: qty, baseUom: "g", qtyEntered: qty, enteredUom: "g", qualityStatusAtPosting: "released" };
    const [original] = await db
      .insert(s.stockMovements)
      .values({ ...base, movementType: "transfer", fromLocationId: bal.locationId, toLocationId: a02.id, sourceDocumentType: "stock_transfer", sourceDocumentNumber: "MOV-DEMO-01", reason: "Put-away after weighing", postedBy: warehouse.id, postedAt: at(180) })
      .returning();
    await shift(bal.locationId, `-${qty}`);
    await shift(a02.id, qty);
    const correlationId = uuidv7();
    const [reversal] = await db
      .insert(s.stockMovements)
      .values({ ...base, movementType: "reversal", fromLocationId: a02.id, toLocationId: bal.locationId, reversalOfId: original.id, correlationId, sourceDocumentType: "stock_transfer", sourceDocumentNumber: "MOV-DEMO-01", reason: "Scanned the wrong rack (demo)", postedBy: manager.id, postedAt: at(120) })
      .returning();
    await shift(a02.id, `-${qty}`);
    await shift(bal.locationId, qty);
    const [replacement] = await db
      .insert(s.stockMovements)
      .values({ ...base, movementType: "transfer", fromLocationId: bal.locationId, toLocationId: b01.id, correlationId, sourceDocumentType: "stock_transfer", sourceDocumentNumber: "MOV-DEMO-02", reason: "Replacement: Scanned the wrong rack (demo)", postedBy: manager.id, postedAt: at(119) })
      .returning();
    await shift(bal.locationId, `-${qty}`);
    await shift(b01.id, qty);
    await db.insert(s.auditEvents).values({
      organizationId,
      siteId: nfd.id,
      actorId: manager.id,
      action: "inventory.stock_movement.reversed",
      entityType: "stock_movement",
      entityId: original.id,
      entityNumber: "MOV-DEMO-01",
      reason: "Scanned the wrong rack (demo)",
      correlationId,
      after: { reversalId: reversal.id, replacementId: replacement.id, lotNumber: bal.lot.lotNumber },
      occurredAt: at(119),
    });
  }

  // 2. Last night's reconciliation: clean, run by the worker.
  const ranAt = new Date(Date.now() - 6 * 3600_000);
  const [job] = await db
    .insert(s.backgroundJobs)
    .values({
      organizationId,
      jobKind: "inventory.reconcile",
      status: "succeeded",
      payload: { siteId: null, asOf: ranAt.toISOString(), trigger: "schedule" },
      result: { status: "clean", differencesCount: 0 },
      attempts: 1,
      idempotencyKey: `inventory.reconcile:inventory_balances:all:${ranAt.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}`,
      correlationId: uuidv7(),
      startedAt: ranAt,
      finishedAt: ranAt,
      createdAt: ranAt,
    })
    .returning();
  await db.insert(s.reconciliationRuns).values({ organizationId, kind: "inventory_balances", status: "clean", asOf: ranAt, differencesCount: 0, report: [], backgroundJobId: job.id, createdAt: ranAt });

  // 3. Notifications for the demo action centre.
  const rows = [
    admin && { recipientUserId: admin.id, severity: "info", kind: "reconciliation_clean", title: "Nightly stock reconciliation: no differences", body: "The ledger and the balance table agreed at every site last night.", link: "/admin/diagnostics#reconciliation" },
    manager && { recipientUserId: manager.id, siteId: nfd.id, severity: "warning", kind: "correction_posted", title: "A stock move was corrected at NFD", body: "MOV-DEMO-01 was reversed and replaced by MOV-DEMO-02 (wrong rack). Check the stock card if you count that rack today.", link: "/inventory/movements" },
  ].filter(Boolean) as { recipientUserId: string; siteId?: string; severity: string; kind: string; title: string; body: string; link: string }[];
  if (rows.length) await db.insert(s.notifications).values(rows.map((r) => ({ organizationId, channel: "in_app", deliveredAt: new Date(), ...r })));
}
