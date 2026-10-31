/**
 * Wave 2 W2B fictional demo data (batch execution): a released lot of soap wrappers at the NFD
 * packaging shelf, so the packaging and labelling step (W05-15) can issue and reconcile components
 * in the demo. The seeded wrapper lot MPP-889 stays in quarantine on purpose (blocked-lot demo).
 * Called once from src/db/seed.ts. Fictional data only.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW2B(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const [pkgShelf] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "PKG-01")));
  const [wrapper] = await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, "PKG-0101")));
  const [wh] = await db.select().from(s.users).where(eq(s.users.email, "warehouse.nfd@bryels-care.test"));
  const [qa] = await db.select().from(s.users).where(eq(s.users.email, "qa.nfd@bryels-care.test"));
  if (!pkgShelf || !wrapper || !wh || !qa) return;

  const local = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const period = String(local.getFullYear()).slice(2) + String(local.getMonth() + 1).padStart(2, "0");
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${O}, 'LOT', 'L', 5, ${period}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  const lotNumber = `L-${period}-${String(rows[0].value).padStart(5, "0")}`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const receivedAt = new Date(Date.now() - 20 * 86_400_000);

  const [lot] = await db
    .insert(s.inventoryLots)
    .values({
      organizationId: O,
      siteId: nfd.id,
      lotNumber,
      itemKind: "material",
      materialId: wrapper.id,
      supplierName: "Manila Print & Pack (fictional)",
      supplierLotNumber: "MPP-901",
      manufacturedOn: day(-40),
      expiresOn: day(1500),
      qualityStatus: "released",
      baseUom: wrapper.baseUom,
      createdBy: wh.id,
      createdAt: receivedAt,
    })
    .returning();
  await db.insert(s.inventoryBalances).values({ siteId: nfd.id, lotId: lot.id, locationId: pkgShelf.id, qtyBase: "3000" });
  await db.insert(s.stockMovements).values({
    organizationId: O,
    siteId: nfd.id,
    movementType: "receipt",
    lotId: lot.id,
    toLocationId: pkgShelf.id,
    qtyBase: "3000",
    baseUom: wrapper.baseUom,
    qtyEntered: "3000",
    enteredUom: wrapper.baseUom,
    qualityStatusAtPosting: "released",
    sourceDocumentType: "seed",
    sourceDocumentNumber: "Opening stock (demo)",
    reason: "Opening balance (demo, fictional)",
    postedBy: wh.id,
    postedAt: receivedAt,
  });
  await db.insert(s.dispositions).values({ organizationId: O, siteId: nfd.id, subjectType: "lot", subjectId: lot.id, decision: "release", fromStatus: "quarantine", toStatus: "released", reason: "Incoming inspection: print and dimensions conform (demo).", decidedBy: qa.id, decidedAt: receivedAt });
  // ADR-088 §3 (A-G5-01): the demo soap recipes list no wrapper, so each bar takes one wrapper from the
  // per-piece setup; it is set aside with the ingredients and taken at "Get materials". Fictional.
  await db
    .insert(s.settings)
    .values({ organizationId: O, scope: "organization", key: "production.packaging.per_piece", value: { "ACS-135": [{ materialCode: "PKG-0101", perPiece: 1 }], "GBS-135": [{ materialCode: "PKG-0101", perPiece: 1 }] }, updatedBy: qa.id })
    .onConflictDoNothing();
}
