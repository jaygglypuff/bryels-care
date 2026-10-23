/**
 * Wave 1 W1B demo data (fictional): suppliers, a procurement user, receiving flags on materials, the
 * receipt backfill for the MVP-seeded receipts and one draft receipt with a recorded discrepancy.
 * Runs at the end of src/db/seed.ts (guarded there by ALLOW_DEMO_SEED).
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { hash } from "@node-rs/argon2";
import * as s from "../schema";

export async function seedReceivingW1B(db: PostgresJsDatabase<typeof s>) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))))[0];
  const admin = await user("admin@bryels-care.test");
  const wh = await user("warehouse.nfd@bryels-care.test");
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const [rvs] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "RVS")));

  // Procurement user (the role itself is created from ROLE_BUNDLES by the main seed).
  const [role] = await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, "procurement")));
  if (role) {
    const pw = await hash("demo1234", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const [p] = await db.insert(s.users).values({ organizationId: O, email: "procurement@bryels-care.test", displayName: "Tess Navarro", passwordHash: pw }).returning();
    await db.insert(s.userSiteAssignments).values([
      { userId: p.id, roleId: role.id, siteId: nfd.id },
      { userId: p.id, roleId: role.id, siteId: rvs.id },
    ]);
  }

  const supplierDefs: [string, string, string, string, string, number, number, string, string | null][] = [
    ["SUP-0001", "Laguna Oleo Supply", "Ramon Dizon", "+63 917 555 0201", "Calamba, Laguna", 30, 7, "approved", null],
    ["SUP-0002", "Mindanao Palm Co.", "Grace Lim", "+63 918 555 0233", "Davao City", 45, 14, "approved", null],
    ["SUP-0003", "Cebu Chemicals", "Arnel Uy", "+63 919 555 0245", "Mandaue, Cebu", 30, 10, "approved", null],
    ["SUP-0004", "Laguna Botanicals", "Liza Ocampo", "+63 917 555 0277", "Los Baños, Laguna", 30, 10, "conditional", null],
    ["SUP-0005", "Manila Print & Pack", "Joel Santos", "+63 918 555 0288", "Valenzuela, Metro Manila", 30, 5, "approved", null],
    ["SUP-0006", "Bukidnon Aloe Farms", "Mila Cruz", "+63 919 555 0299", "Malaybalay, Bukidnon", 15, 12, "new", null],
    ["SUP-0007", "Visayas Essence Trading", "Noel Tan", "+63 917 555 0310", "Iloilo City", 30, 14, "suspended", "Two CoA mismatches under review (fictional demo record)."],
  ];
  const sups = await db
    .insert(s.suppliers)
    .values(
      supplierDefs.map(([code, name, contactName, phone, city, paymentTermsDays, defaultLeadTimeDays, qualityStatus, qualityStatusReason]) => ({
        organizationId: O,
        code,
        name,
        contactName,
        phone,
        email: `orders@${code.toLowerCase()}.test`,
        city,
        country: "Philippines",
        paymentTermsDays,
        defaultLeadTimeDays,
        qualityStatus,
        qualityStatusReason,
        createdBy: admin.id,
        updatedBy: admin.id,
      })),
    )
    .returning();
  const S = (name: string) => sups.find((x) => x.name === name)!;
  const mat = async (code: string) => (await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, code))))[0];
  const asl: [string, string][] = [
    ["Laguna Oleo Supply", "MAT-0012"],
    ["Mindanao Palm Co.", "MAT-0013"],
    ["Laguna Botanicals", "MAT-0043"],
    ["Laguna Botanicals", "MAT-0044"],
    ["Cebu Chemicals", "MAT-0061"],
    ["Cebu Chemicals", "MAT-0062"],
    ["Bukidnon Aloe Farms", "MAT-0060"],
    ["Manila Print & Pack", "PKG-0101"],
    ["Manila Print & Pack", "PKG-0102"],
  ];
  for (const [sup, code] of asl) {
    const m = await mat(code);
    if (m) await db.insert(s.supplierMaterials).values({ organizationId: O, supplierId: S(sup).id, materialId: m.id, createdBy: admin.id });
  }

  // Assumption A-W1B-03: botanical extracts need a supplier CoA before release (demo default for QA to confirm).
  await db.update(s.materials).set({ requiresCoa: true }).where(and(eq(s.materials.organizationId, O), sql`${s.materials.code} in ('MAT-0043','MAT-0044')`));

  // Backfill the MVP-seeded receipts: they were posted in one step, before receipts became documents.
  await db.execute(sql`
    update goods_receipts g set status = 'posted', posted_at = g.received_at, posted_by = g.received_by, created_by = g.received_by,
      unplanned_reason_code = 'no_purchase_order', supplier_id = sp.id
    from suppliers sp
    where g.organization_id = ${O} and sp.organization_id = ${O} and lower(sp.name) = lower(g.supplier_name) and g.status = 'draft' and g.receipt_number is not null`);
  await db.execute(sql`
    update goods_receipt_lines l set line_no = x.rn, supplier_lot_number = lot.supplier_lot_number, manufactured_on = lot.manufactured_on,
      expires_on = lot.expires_on, qty_entered = l.qty_base, uom_entered = lot.base_uom, created_by = g.received_by,
      stock_movement_id = (select m.id from stock_movements m where m.lot_id = l.lot_id and m.movement_type = 'receipt' order by m.posted_at limit 1)
    from (select id, row_number() over (partition by goods_receipt_id order by created_at, id) as rn from goods_receipt_lines) x,
      inventory_lots lot, goods_receipts g
    where x.id = l.id and lot.id = l.lot_id and g.id = l.goods_receipt_id and g.organization_id = ${O}`);

  // A draft receipt waiting at the NFD dock, with a damaged-drum discrepancy for procurement to review.
  const aloe = await mat("MAT-0060");
  const [rcv] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "RCV")));
  const exp = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const [draft] = await db
    .insert(s.goodsReceipts)
    .values({
      organizationId: O,
      siteId: nfd.id,
      status: "draft",
      supplierId: S("Bukidnon Aloe Farms").id,
      supplierName: "Bukidnon Aloe Farms",
      supplierDocumentNumber: "BAF-DR-3381",
      unplannedReasonCode: "no_purchase_order",
      receivedBy: wh.id,
      createdBy: wh.id,
      notes: "Truck arrived 07:40; one drum dented.",
    })
    .returning();
  await db.insert(s.goodsReceiptLines).values({
    goodsReceiptId: draft.id,
    lineNo: 1,
    materialId: aloe.id,
    qtyEntered: "20",
    uomEntered: "kg",
    qtyBase: "20000",
    locationId: rcv.id,
    supplierLotNumber: "BAF-2291",
    expiresOn: exp,
    containerCount: 2,
    discrepancyKind: "damaged",
    discrepancyNote: "Drum 2 of 2 dented at the rim; seal intact.",
    discrepancyRecordedBy: wh.id,
    discrepancyRecordedAt: new Date(),
    createdBy: wh.id,
  });
  await db.insert(s.auditEvents).values({ organizationId: O, siteId: nfd.id, actorId: wh.id, action: "procurement.goods_receipt.created", entityType: "goods_receipt", entityId: draft.id, after: { seeded: true } });
  console.log(`W1B seed: ${sups.length} suppliers, ${asl.length} supplier materials, 1 draft receipt.`);
}
