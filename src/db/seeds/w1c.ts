/**
 * Wave 1 W1C fictional demo data: a second NFD warehouse operator (so counts and adjustments can
 * show separation of duties), one box of finished goods, a planned blind count, a submitted
 * adjustment awaiting approval, an active reservation and the default FEFO rule row.
 * Called once from src/db/seed.ts after the core demo data. Fictional data only.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

async function nextNo(db: Db, organizationId: string, type: string, prefix: string, width: number, period: string) {
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${type}, ${prefix}, ${width}, ${period}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  return [prefix, period, String(rows[0].value).padStart(width, "0")].filter(Boolean).join("-");
}

export async function seedW1C(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const local = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const YY = String(local.getFullYear()).slice(2);
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const loc = async (code: string) => (await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, code))))[0];
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];

  // 1. Second warehouse operator at NFD (fictional), password demo1234 like every demo account.
  const [whRole] = await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, "warehouse_operator")));
  const pw = await hash("demo1234", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const [tess] = await db.insert(s.users).values({ organizationId: O, email: "warehouse2.nfd@bryels-care.test", displayName: "Tess Navarro", passwordHash: pw }).returning();
  await db.insert(s.userSiteAssignments).values({ userId: tess.id, roleId: whRole.id, siteId: nfd.id });
  const lito = await user("warehouse.nfd@bryels-care.test");
  const manager = await user("manager.nfd@bryels-care.test");

  // 2. One box of released Acapulco Soap at FG-01 (48 pcs), the rest stays loose.
  const fg = await loc("FG-01");
  const [acs] = await db.select().from(s.products).where(eq(s.products.skuCode, "ACS-135"));
  const [fgLot] = await db
    .select({ id: s.inventoryLots.id, qty: s.inventoryBalances.qtyBase })
    .from(s.inventoryBalances)
    .innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.inventoryBalances.lotId))
    .where(and(eq(s.inventoryBalances.locationId, fg.id), eq(s.inventoryLots.productId, acs.id), eq(s.inventoryLots.qualityStatus, "released"), gt(s.inventoryBalances.qtyBase, "48")))
    .limit(1);
  if (fgLot) {
    const number = await nextNo(db, O, "BOX", "BX", 8, "");
    const [box] = await db
      .insert(s.containers)
      .values({ organizationId: O, siteId: nfd.id, containerNumber: number, containerKind: "carton", status: "sealed", currentLocationId: fg.id, packedAt: new Date(), packedBy: lito.id, createdBy: lito.id })
      .returning();
    await db.insert(s.containerContents).values({ organizationId: O, siteId: nfd.id, containerId: box.id, lotId: fgLot.id, qtyBase: "48", baseUom: "pcs" });
  }

  // 3. A planned blind cycle count of the packaging shelf and actives shelf (not released, so nothing is frozen).
  const cnt = await nextNo(db, O, "CNT", "CNT", 4, YY);
  const [count] = await db
    .insert(s.stockCounts)
    .values({ organizationId: O, siteId: nfd.id, countNumber: cnt, countKind: "cycle", isBlind: true, status: "planned", scheduledFor: local.toISOString().slice(0, 10), notes: "Monthly cycle count (demo)", createdBy: manager.id })
    .returning();
  for (const code of ["PKG-01", "B-01"]) await db.insert(s.stockCountScopes).values({ stockCountId: count.id, siteId: nfd.id, locationId: (await loc(code)).id });
  await db.insert(s.stockCountCounters).values([
    { stockCountId: count.id, userId: lito.id },
    { stockCountId: count.id, userId: tess.id },
  ]);

  // 4. A submitted adjustment (damaged cetearyl alcohol) waiting for the site manager.
  const b01 = await loc("B-01");
  const [cet] = await db
    .select({ id: s.inventoryLots.id })
    .from(s.inventoryLots)
    .innerJoin(s.materials, eq(s.materials.id, s.inventoryLots.materialId))
    .innerJoin(s.inventoryBalances, and(eq(s.inventoryBalances.lotId, s.inventoryLots.id), eq(s.inventoryBalances.locationId, b01.id)))
    .where(and(eq(s.materials.code, "MAT-0062"), gt(s.inventoryBalances.qtyBase, "250")))
    .limit(1);
  if (cet) {
    const adj = await nextNo(db, O, "ADJ", "ADJ", 5, YY);
    const [a] = await db
      .insert(s.stockAdjustments)
      .values({
        organizationId: O,
        siteId: nfd.id,
        adjustmentNumber: adj,
        status: "submitted",
        reasonCode: "damaged",
        reasonNote: "Bag torn by forklift; contents swept (demo)",
        totalValueAmount: "87.5000",
        currency: "PHP",
        createdBy: lito.id,
        submittedBy: lito.id,
        submittedAt: new Date(),
      })
      .returning();
    await db.insert(s.stockAdjustmentLines).values({ stockAdjustmentId: a.id, lineNo: 1, lotId: cet.id, locationId: b01.id, direction: "decrease", qtyBase: "250", unitCostAmount: "0.3500" });
  }

  // 5. An active reservation of glycerin for a lotion trial (72 h).
  const [gly] = await db
    .select({ id: s.inventoryLots.id })
    .from(s.inventoryLots)
    .innerJoin(s.materials, eq(s.materials.id, s.inventoryLots.materialId))
    .innerJoin(s.inventoryBalances, and(eq(s.inventoryBalances.lotId, s.inventoryLots.id), eq(s.inventoryBalances.locationId, b01.id)))
    .where(and(eq(s.materials.code, "MAT-0061"), eq(s.inventoryLots.qualityStatus, "released"), gt(s.inventoryBalances.qtyBase, "1000")))
    .limit(1);
  if (gly) {
    const rsv = await nextNo(db, O, "RSV", "RSV", 6, YY);
    await db.insert(s.stockReservations).values({
      organizationId: O,
      siteId: nfd.id,
      reservationNumber: rsv,
      lotId: gly.id,
      locationId: b01.id,
      qtyBase: "1000",
      baseUom: "g",
      demandType: "manual",
      demandReference: "Calm Lotion pilot batch (demo)",
      status: "active",
      expiresAt: new Date(Date.now() + 72 * 3600_000),
      createdBy: manager.id,
    });
  }

  // 6. The organization default allocation rule (A-PRD-16: FEFO; lots without expiry FIFO). Confirm with QA (Q-B-07).
  await db.insert(s.allocationRules).values({ organizationId: O, scope: "default", strategy: "fefo", note: "Default A-PRD-16, awaiting QA and production confirmation (Q-B-07)" });
}
