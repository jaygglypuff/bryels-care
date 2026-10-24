/**
 * Fictional demo data for development and client demos (never run in production).
 * Shaped after the Acapulco Soap BMR: formula, 7 checklist steps, lots in every quality state.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import Decimal from "decimal.js";
import { hash } from "@node-rs/argon2";
import * as s from "./schema";
import { seedW1a } from "./seeds/w1a";
import { ROLE_BUNDLES } from "../lib/permissions";
import { LOTION_ROUTING, SOAP_ROUTING, type SeedStep, seedApprovedFormulaAndRouting, seedW1D } from "./seeds/w1d";
import { seedReceivingW1B } from "./seeds/w1b";
import { seedW1e } from "./seeds/w1e";

if (process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed: ALLOW_DEMO_SEED is not true. Demo data must never reach production.");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: s });

const now = new Date();
const manila = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const YY = String(manila.getFullYear()).slice(2);
const YYMM = YY + String(manila.getMonth() + 1).padStart(2, "0");
const day = (offset: number) => {
  const d = new Date(manila);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offsetDays: number, hour = 9) => {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};

async function main() {
  const existing = await db.select().from(s.organizations).limit(1);
  if (existing.length) {
    console.log("Seed skipped: data already present. Run pnpm db:reset to start over.");
    await client.end();
    return;
  }

  const [org] = await db.insert(s.organizations).values({ name: "Bryel's Care Corporation (demo)" }).returning();
  const O = org.id;

  // Sites, warehouses, locations
  const [nfd] = await db.insert(s.sites).values({ organizationId: O, code: "NFD", name: "North Fields Plant" }).returning();
  const [rvs] = await db.insert(s.sites).values({ organizationId: O, code: "RVS", name: "Riverside Warehouse" }).returning();
  const [whN] = await db.insert(s.warehouses).values({ siteId: nfd.id, code: "WH1", name: "Main warehouse" }).returning();
  const [whR] = await db.insert(s.warehouses).values({ siteId: rvs.id, code: "WH1", name: "Distribution warehouse" }).returning();
  const locDefs: [string, string, string, string, string][] = [
    [nfd.id, whN.id, "RCV", "Receiving dock", "receiving"],
    [nfd.id, whN.id, "QUA-01", "Quarantine cage", "quarantine"],
    [nfd.id, whN.id, "A-01", "Oils rack A-01", "storage"],
    [nfd.id, whN.id, "A-02", "Oils rack A-02", "storage"],
    [nfd.id, whN.id, "B-01", "Actives shelf B-01", "storage"],
    [nfd.id, whN.id, "PKG-01", "Packaging shelf", "storage"],
    [nfd.id, whN.id, "PRD-01", "Production room 1 (soap line)", "production"],
    [nfd.id, whN.id, "FG-01", "Finished goods bay", "storage"],
    [nfd.id, whN.id, "SHP", "Dispatch bay", "shipping"],
    [nfd.id, whN.id, "REJ", "Rejected goods cage", "rejected"],
    [nfd.id, whN.id, "HLD-01", "QA hold cage", "hold"],
    [rvs.id, whR.id, "RCV", "Receiving dock", "receiving"],
    [rvs.id, whR.id, "QUA-01", "Quarantine cage", "quarantine"],
    [rvs.id, whR.id, "FG-01", "Finished goods racks", "storage"],
    [rvs.id, whR.id, "SHP", "Dispatch bay", "shipping"],
    [rvs.id, whR.id, "REJ", "Rejected goods cage", "rejected"],
  ];
  const locs = await db
    .insert(s.locations)
    .values(locDefs.map(([siteId, warehouseId, code, name, kind]) => ({ siteId, warehouseId, code, name, kind })))
    .returning();
  const L = (site: string, code: string) => locs.find((l) => l.siteId === site && l.code === code)!.id;

  // Roles and users
  const roleRows: Record<string, string> = {};
  for (const [code, b] of Object.entries(ROLE_BUNDLES)) {
    const [r] = await db.insert(s.roles).values({ organizationId: O, code, name: b.name, allowsOrganizationWide: b.orgWide }).returning();
    roleRows[code] = r.id;
    await db.insert(s.rolePermissions).values(b.permissions.map((p) => ({ roleId: r.id, permissionCode: p })));
  }
  const pw = await hash("demo1234", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const people: [string, string, string, (string | "org")[]][] = [
    ["owner@bryels-care.test", "Ana Villanueva", "owner_director", ["org"]],
    ["admin@bryels-care.test", "Paolo Reyes", "system_admin", ["org"]],
    ["manager.nfd@bryels-care.test", "Dino Reyes", "site_manager", [nfd.id]],
    ["operator.nfd@bryels-care.test", "Rhea Mendoza", "production_operator", [nfd.id]],
    ["checker.nfd@bryels-care.test", "Jun Dela Cruz", "production_operator", [nfd.id]],
    ["warehouse.nfd@bryels-care.test", "Lito Pascual", "warehouse_operator", [nfd.id]],
    ["qa.nfd@bryels-care.test", "Nina Quiambao", "qa_qc", [nfd.id, rvs.id]],
    ["sales@bryels-care.test", "Mara Santos", "sales_cs", [nfd.id, rvs.id]],
    ["warehouse.rvs@bryels-care.test", "Carlo Bautista", "warehouse_operator", [rvs.id]],
    ["auditor@bryels-care.test", "Lea Fernandez", "auditor", ["org"]],
  ];
  const U: Record<string, string> = {};
  // The organization's system actor (ADR-029; src/lib/auth/system.ts): attributed scheduled work, never signs in.
  await db.insert(s.users).values({ organizationId: O, email: "system@bryels-care.invalid", displayName: "System (scheduled jobs)", passwordHash: "!", status: "system" });
  for (const [email, displayName, role, scope] of people) {
    const [u] = await db.insert(s.users).values({ organizationId: O, email, displayName, passwordHash: pw }).returning();
    U[email.split("@")[0]] = u.id;
    for (const sc of scope) {
      await db.insert(s.userSiteAssignments).values(
        sc === "org" ? { userId: u.id, roleId: roleRows[role], isOrganizationWide: true } : { userId: u.id, roleId: roleRows[role], siteId: sc },
      );
    }
  }

  // Materials
  const matDefs: [string, string, string | null, string, string, number][] = [
    ["MAT-0012", "Coconut Oil", "Cocos Nucifera (Coconut) Oil", "raw_material", "g", 730],
    ["MAT-0013", "Palm Oil", "Elaeis Guineensis (Palm) Oil", "raw_material", "g", 540],
    ["MAT-0021", "33.33% Lye Solution", "Sodium Hydroxide (aqueous)", "intermediate", "g", 30],
    ["MAT-0043", "Acapulco Extract", "Cassia Alata Leaf Extract", "raw_material", "g", 365],
    ["MAT-0044", "Guava Leaf Extract", "Psidium Guajava Leaf Extract", "raw_material", "g", 365],
    ["MAT-0051", "6% Green in Oil", "Chromium Oxide Greens dispersion", "intermediate", "g", 180],
    ["MAT-0060", "Aloe Vera Juice", "Aloe Barbadensis Leaf Juice", "raw_material", "g", 365],
    ["MAT-0061", "Glycerin", "Glycerin", "raw_material", "g", 1095],
    ["MAT-0062", "Cetearyl Alcohol", "Cetearyl Alcohol", "raw_material", "g", 1095],
    ["MAT-0063", "Purified Water", "Aqua", "raw_material", "g", 30],
    ["PKG-0101", "Soap wrapper 135 g", null, "packaging", "pcs", 1825],
    ["PKG-0102", "Shipping carton (48)", null, "packaging", "pcs", 1825],
  ];
  const mats = await db
    .insert(s.materials)
    .values(matDefs.map(([code, name, inciName, materialKind, baseUom, shelfLifeDays]) => ({ organizationId: O, code, name, inciName, materialKind, baseUom, shelfLifeDays })))
    .returning();
  const M = (code: string) => mats.find((m) => m.code === code)!;

  // Products and formulas
  const [acs] = await db.insert(s.products).values({ organizationId: O, skuCode: "ACS-135", name: "Acapulco Soap 135 g", family: "Soap", unitNetMassG: "135", unitsPerBox: 48, shelfLifeDays: 730 }).returning();
  const [gbs] = await db.insert(s.products).values({ organizationId: O, skuCode: "GBS-135", name: "Guava Bar Soap 135 g", family: "Soap", unitNetMassG: "135", unitsPerBox: 48, shelfLifeDays: 730 }).returning();
  const [ahl] = await db.insert(s.products).values({ organizationId: O, skuCode: "AHL-250", name: "Aloe Hand Lotion 250 mL", family: "Lotion", unitNetMassG: "255", unitsPerBox: 24, shelfLifeDays: 540 }).returning();

  // Formulas and routings: approved revision 1 of each, two approvals (W1D, src/db/seeds/w1d.ts).
  async function makeFormula(product: typeof acs, code: string, name: string, sizeG: string, lines: [string, string][], steps: SeedStep[], yieldPct: string, routingCode: string) {
    const r = await seedApprovedFormulaAndRouting(db, {
      O,
      U,
      product,
      code,
      name,
      sizeG,
      yieldPct,
      lines: lines.map(([mat, q]) => ({ materialId: M(mat).id, quantityG: q, tolerancePct: "0.5" })),
      routingCode,
      steps,
    });
    return { ...r, product };
  }

  const fACS = await makeFormula(acs, "F-ACS-01", "Acapulco Soap", "17600", [["MAT-0012", "3723.2"], ["MAT-0013", "8687.4"], ["MAT-0021", "4964.2"], ["MAT-0043", "190.9"], ["MAT-0051", "34.4"]], SOAP_ROUTING, "95", "R-ACS-01");
  const fGBS = await makeFormula(gbs, "F-GBS-01", "Guava Bar Soap", "17600", [["MAT-0012", "3723.2"], ["MAT-0013", "8687.4"], ["MAT-0021", "4964.2"], ["MAT-0044", "225.2"]], SOAP_ROUTING, "95", "R-GBS-01");
  const fAHL = await makeFormula(ahl, "F-AHL-01", "Aloe Hand Lotion", "40000", [["MAT-0063", "28400"], ["MAT-0060", "6000"], ["MAT-0061", "2400"], ["MAT-0062", "3200"]], LOTION_ROUTING, "97", "R-AHL-01");
  void fAHL;

  // Numbering helper (keeps numbering_rules in sync with the seeded numbers)
  const counters: Record<string, number> = {};
  const RULE = { GR: ["GR", 5, YY], LOT: ["L", 5, YYMM], BATCH: ["B", 4, YY], SO: ["SO", 5, YY], DR: ["DR", 5, YY], MOV: ["MOV", 6, YY] } as const;
  const next = (t: keyof typeof RULE) => {
    counters[t] = (counters[t] ?? 0) + 1;
    const [p, w, pk] = RULE[t];
    return `${p}-${pk}-${String(counters[t]).padStart(w, "0")}`;
  };

  const balance = async (siteId: string, lotId: string, locationId: string, delta: Decimal) => {
    if (delta.isNegative()) {
      await db
        .update(s.inventoryBalances)
        .set({ qtyBase: sql`${s.inventoryBalances.qtyBase} - ${delta.abs().toString()}` })
        .where(sql`${s.inventoryBalances.lotId} = ${lotId} AND ${s.inventoryBalances.locationId} = ${locationId}`);
      return;
    }
    await db
      .insert(s.inventoryBalances)
      .values({ siteId, lotId, locationId, qtyBase: delta.toString() })
      .onConflictDoUpdate({ target: [s.inventoryBalances.lotId, s.inventoryBalances.locationId], set: { qtyBase: sql`${s.inventoryBalances.qtyBase} + ${delta.toString()}` } });
  };
  const move = async (m: { siteId: string; type: string; lotId: string; from?: string; to?: string; qty: Decimal; uom: string; doc?: [string, string | null, string]; by: string; when: Date; reason?: string }) => {
    if (m.from) await balance(m.siteId, m.lotId, m.from, m.qty.neg());
    if (m.to) await balance(m.siteId, m.lotId, m.to, m.qty);
    await db.insert(s.stockMovements).values({
      organizationId: O,
      siteId: m.siteId,
      movementType: m.type,
      lotId: m.lotId,
      fromLocationId: m.from ?? null,
      toLocationId: m.to ?? null,
      qtyBase: m.qty.toString(),
      baseUom: m.uom,
      sourceDocumentType: m.doc?.[0] ?? null,
      sourceDocumentId: m.doc?.[1] ?? null,
      sourceDocumentNumber: m.doc?.[2] ?? null,
      reason: m.reason ?? null,
      postedBy: m.by,
      postedAt: m.when,
    });
  };
  const audit = (action: string, entityType: string, entityId: string, entityNumber: string, actor: string, siteId: string, when: Date, after?: object) =>
    db.insert(s.auditEvents).values({ organizationId: O, siteId, actorId: actor, action, entityType, entityId, entityNumber, after: after ?? null, occurredAt: when });

  // Material receipts
  type LotSpec = { mat: string; qty: string; supplier: string; sLot: string; daysAgo: number; expiresIn: number; status: string; loc: string };
  const receive = async (site: string, specs: LotSpec[], supplier: string) => {
    const daysAgo = Math.max(...specs.map((x) => x.daysAgo));
    const grNo = next("GR");
    const [gr] = await db.insert(s.goodsReceipts).values({ organizationId: O, siteId: site, receiptNumber: grNo, supplierName: supplier, supplierDocumentNumber: `DR-${1000 + counters.GR}`, receivedBy: U["warehouse.nfd"], receivedAt: at(-daysAgo, 8) }).returning();
    const out: Record<string, typeof s.inventoryLots.$inferSelect> = {};
    for (const x of specs) {
      const m = M(x.mat);
      const [lot] = await db
        .insert(s.inventoryLots)
        .values({ organizationId: O, siteId: site, lotNumber: next("LOT"), itemKind: "material", materialId: m.id, supplierName: x.supplier, supplierLotNumber: x.sLot, manufacturedOn: day(-x.daysAgo - 30), expiresOn: day(x.expiresIn), qualityStatus: x.status, baseUom: m.baseUom, createdBy: U["warehouse.nfd"], createdAt: at(-x.daysAgo, 8) })
        .returning();
      await db.insert(s.goodsReceiptLines).values({ goodsReceiptId: gr.id, lotId: lot.id, materialId: m.id, qtyBase: x.qty, locationId: L(site, x.loc) });
      await move({ siteId: site, type: "receipt", lotId: lot.id, to: L(site, x.loc), qty: new Decimal(x.qty), uom: m.baseUom, doc: ["goods_receipt", gr.id, grNo], by: U["warehouse.nfd"], when: at(-x.daysAgo, 8) });
      await audit("inventory.goods_receipt.posted", "inventory_lot", lot.id, lot.lotNumber, U["warehouse.nfd"], site, at(-x.daysAgo, 8), { qty: x.qty });
      if (x.status !== "quarantine") {
        await db.insert(s.dispositions).values({ organizationId: O, siteId: site, subjectType: "lot", subjectId: lot.id, decision: x.status === "released" || x.status === "expired" ? "release" : x.status === "on_hold" ? "hold" : "reject", fromStatus: "quarantine", toStatus: x.status === "expired" ? "released" : x.status, reason: "Incoming inspection: CoA reviewed, appearance and odour conform.", decidedBy: U["qa.nfd"], decidedAt: at(-x.daysAgo + 1, 10) });
        if (x.loc === "QUA-01" && x.status === "released") {
          /* stays */
        }
      }
      out[x.mat + ":" + x.sLot] = lot;
    }
    return out;
  };

  const r1 = await receive(nfd.id, [
    { mat: "MAT-0012", qty: "40000", supplier: "Laguna Oleo Supply", sLot: "LOS-24871", daysAgo: 40, expiresIn: 600, status: "released", loc: "A-01" },
    { mat: "MAT-0013", qty: "60000", supplier: "Laguna Oleo Supply", sLot: "LOS-24872", daysAgo: 40, expiresIn: 21, status: "released", loc: "A-02" },
  ], "Laguna Oleo Supply");
  const r2 = await receive(nfd.id, [
    { mat: "MAT-0013", qty: "90000", supplier: "Mindanao Palm Co.", sLot: "MPC-7731", daysAgo: 25, expiresIn: 480, status: "released", loc: "A-02" },
    { mat: "MAT-0021", qty: "50000", supplier: "In-house (lye room)", sLot: "LYE-1009", daysAgo: 6, expiresIn: 24, status: "released", loc: "B-01" },
    { mat: "MAT-0043", qty: "2500", supplier: "Laguna Botanicals", sLot: "LB-7712", daysAgo: 25, expiresIn: 300, status: "released", loc: "B-01" },
    { mat: "MAT-0044", qty: "2500", supplier: "Laguna Botanicals", sLot: "LB-7719", daysAgo: 25, expiresIn: 280, status: "released", loc: "B-01" },
    { mat: "MAT-0051", qty: "800", supplier: "In-house (colour room)", sLot: "GRN-0311", daysAgo: 20, expiresIn: 150, status: "released", loc: "B-01" },
  ], "Mindanao Palm Co.");
  const r3 = await receive(nfd.id, [
    { mat: "MAT-0043", qty: "600", supplier: "Laguna Botanicals", sLot: "LB-6620", daysAgo: 400, expiresIn: -5, status: "expired", loc: "B-01" },
    { mat: "MAT-0062", qty: "15000", supplier: "Cebu Chemicals", sLot: "CC-55120", daysAgo: 30, expiresIn: 900, status: "released", loc: "B-01" },
    { mat: "MAT-0061", qty: "12000", supplier: "Cebu Chemicals", sLot: "CC-55121", daysAgo: 30, expiresIn: 900, status: "released", loc: "B-01" },
    { mat: "MAT-0060", qty: "30000", supplier: "Bukidnon Aloe Farms", sLot: "BAF-2210", daysAgo: 12, expiresIn: 200, status: "on_hold", loc: "QUA-01" },
    { mat: "MAT-0063", qty: "120000", supplier: "In-house (RO plant)", sLot: "RO-1015", daysAgo: 2, expiresIn: 28, status: "released", loc: "B-01" },
  ], "Cebu Chemicals");
  const r4 = await receive(nfd.id, [
    { mat: "MAT-0012", qty: "40000", supplier: "Laguna Oleo Supply", sLot: "LOS-25013", daysAgo: 1, expiresIn: 700, status: "quarantine", loc: "QUA-01" },
    { mat: "PKG-0101", qty: "5000", supplier: "Manila Print & Pack", sLot: "MPP-889", daysAgo: 1, expiresIn: 1800, status: "quarantine", loc: "QUA-01" },
  ], "Laguna Oleo Supply");
  // expired lot is flagged as expired status after its date
  void r3;
  void r4;

  // Batches
  type F = typeof fACS;
  const makeBatch = async (f: F, opts: { status: string; daysAgo: number; outputUnits?: number; site?: string; stepsDone?: number; dispense?: boolean; tests?: [string, string, string, boolean][]; release?: boolean; matLots: Record<string, string> }) => {
    const site = opts.site ?? nfd.id;
    const bNo = next("BATCH");
    const snapshot = {
      schemaVersion: "bom_snapshot/v2",
      formulaId: f.formula.id,
      formulaRevisionId: f.rev.id,
      formulaCode: f.formula.code,
      formulaName: f.formula.name,
      revisionNo: f.rev.revisionNo,
      effectiveFrom: f.rev.effectiveFrom,
      routing: { routingId: f.routing.id, routingCode: f.routing.code, routingName: f.routing.name, routingRevisionId: f.routingRev.id, revisionNo: f.routingRev.revisionNo, effectiveFrom: f.routingRev.effectiveFrom },
      referenceBatchSizeG: f.rev.referenceBatchSizeG,
      theoreticalYieldPct: f.rev.theoreticalYieldPct,
      lines: f.bomLines.map((b) => ({ bomLineId: b.id, lineNo: b.lineNo, materialId: b.materialId, materialCode: mats.find((m) => m.id === b.materialId)!.code, materialName: mats.find((m) => m.id === b.materialId)!.name, inciName: mats.find((m) => m.id === b.materialId)!.inciName, quantityG: b.quantityG, tolerancePct: b.tolerancePct ?? "0", targetQtyG: b.quantityG })),
      steps: f.steps.map((st) => ({ routingStepId: st.id, stepNo: st.stepNo, name: st.name, stepKind: st.stepKind, area: st.area, instruction: st.instruction, requiresChecker: st.requiresChecker })),
    };
    const size = new Decimal(f.rev.referenceBatchSizeG);
    const theoYield = size.mul(f.rev.theoreticalYieldPct).div(100);
    const started = opts.status !== "planned";
    // Created the day before the planned start, but never in the future (batches planned ahead were created yesterday).
    const createdAt = at(Math.min(-opts.daysAgo - 1, -1), 15);
    const [b] = await db
      .insert(s.batches)
      .values({
        organizationId: O,
        siteId: site,
        batchNumber: bNo,
        productId: f.product.id,
        formulaRevisionId: f.rev.id,
        routingRevisionId: f.routingRev.id,
        formulaSnapshot: snapshot,
        plannedSizeG: size.toString(),
        status: opts.status,
        plannedStartOn: day(-opts.daysAgo),
        startedAt: started ? at(-opts.daysAgo, 8) : null,
        theoreticalYieldG: theoYield.toString(),
        createdBy: U["manager.nfd"],
        createdAt,
      })
      .returning();
    await db.insert(s.batchStateTransitions).values({ batchId: b.id, fromState: null, toState: "planned", actorId: U["manager.nfd"], at: createdAt });
    const bms = await db
      .insert(s.batchMaterials)
      .values(f.bomLines.map((bl) => ({ batchId: b.id, bomLineId: bl.id, lineNo: bl.lineNo, materialId: bl.materialId, theoreticalQtyG: bl.quantityG, tolerancePct: bl.tolerancePct ?? "0" })))
      .returning();
    if (opts.dispense) {
      for (const bm of bms) {
        const mat = mats.find((m) => m.id === bm.materialId)!;
        const lotId = opts.matLots[mat.code];
        const lotLoc = await db.select().from(s.inventoryBalances).where(eq(s.inventoryBalances.lotId, lotId)).limit(1);
        const theo = new Decimal(bm.theoreticalQtyG);
        const actual = theo.mul(1 + ((bm.lineNo % 3) - 1) * 0.0012).toDecimalPlaces(1);
        await db.insert(s.dispenseRecords).values({ batchMaterialId: bm.id, lotId, fromLocationId: lotLoc[0].locationId, actualQtyG: actual.toString(), isWithinTolerance: true, scaleCode: "SC-01", operatorId: U["operator.nfd"], checkerId: U["checker.nfd"], recordedAt: at(-opts.daysAgo, 9) });
        await db.update(s.batchMaterials).set({ dispensedQtyG: actual.toString(), status: "dispensed" }).where(eq(s.batchMaterials.id, bm.id));
        await move({ siteId: site, type: "consumption", lotId, from: lotLoc[0].locationId, qty: actual, uom: "g", doc: ["batch", b.id, bNo], by: U["operator.nfd"], when: at(-opts.daysAgo, 9) });
      }
    }
    const done = opts.stepsDone ?? 0;
    for (const st of f.steps.slice(0, done)) {
      await db.insert(s.processStepRecords).values({ batchId: b.id, routingStepId: st.id, stepNo: st.stepNo, name: st.name, conductedBy: U["operator.nfd"], checkedBy: U["checker.nfd"], readings: st.stepKind === "process" ? "Mix temp 48 °C, trace at 22 min" : null, completedAt: at(-opts.daysAgo, 9 + st.stepNo) });
    }
    if (opts.outputUnits) {
      const units = new Decimal(opts.outputUnits);
      const outG = units.mul(f.product.unitNetMassG);
      const lotNo = next("LOT");
      const [lot] = await db
        .insert(s.inventoryLots)
        .values({ organizationId: O, siteId: site, lotNumber: lotNo, itemKind: "product", productId: f.product.id, manufacturedOn: day(-opts.daysAgo), expiresOn: day(-opts.daysAgo + f.product.shelfLifeDays), qualityStatus: opts.release ? "released" : "quarantine", sourceBatchId: b.id, baseUom: "pcs", createdBy: U["operator.nfd"], createdAt: at(-opts.daysAgo, 17) })
        .returning();
      await move({ siteId: site, type: "output", lotId: lot.id, to: L(site, opts.release ? "FG-01" : "QUA-01"), qty: units, uom: "pcs", doc: ["batch", b.id, bNo], by: U["operator.nfd"], when: at(-opts.daysAgo, 17) });
      await db
        .update(s.batches)
        .set({ outputLotId: lot.id, actualOutputG: outG.toString(), actualUnits: units.toString(), yieldPct: outG.div(theoYield).mul(100).toDecimalPlaces(2).toString(), completedAt: at(-opts.daysAgo, 17) })
        .where(eq(s.batches.id, b.id));
      for (const [tn, spec, res, ok] of opts.tests ?? []) {
        await db.insert(s.testResults).values({ batchId: b.id, testName: tn, specification: spec, result: res, passed: ok, testedBy: U["qa.nfd"], testedAt: at(-opts.daysAgo + 1, 10) });
      }
      if (opts.release) {
        await db.insert(s.dispositions).values({ organizationId: O, siteId: site, subjectType: "batch", subjectId: b.id, decision: "release", fromStatus: "awaiting_qc", toStatus: "released", reason: "All tests within specification; BMR reviewed.", decidedBy: U["qa.nfd"], decidedAt: at(-opts.daysAgo + 2, 11) });
        await audit("quality.disposition.released", "batch", b.id, bNo, U["qa.nfd"], site, at(-opts.daysAgo + 2, 11));
      }
    }
    const path: Record<string, string[]> = {
      planned: [],
      in_process: ["materials_staged", "in_process"],
      awaiting_qc: ["materials_staged", "in_process", "awaiting_qc"],
      released: ["materials_staged", "in_process", "awaiting_qc", "released"],
    };
    let prev = "planned";
    for (const st of path[opts.status] ?? []) {
      await db.insert(s.batchStateTransitions).values({ batchId: b.id, fromState: prev, toState: st, actorId: st === "released" ? U["qa.nfd"] : U["operator.nfd"], at: at(-opts.daysAgo, 9) });
      prev = st;
    }
    await audit("production.batch.created", "batch", b.id, bNo, U["manager.nfd"], site, createdAt);
    return b;
  };

  const soapLots = { "MAT-0012": r1["MAT-0012:LOS-24871"].id, "MAT-0013": r1["MAT-0013:LOS-24872"].id, "MAT-0021": r2["MAT-0021:LYE-1009"].id, "MAT-0043": r2["MAT-0043:LB-7712"].id, "MAT-0051": r2["MAT-0051:GRN-0311"].id, "MAT-0044": r2["MAT-0044:LB-7719"].id };
  const lotionLots = { "MAT-0063": r3["MAT-0063:RO-1015"].id, "MAT-0060": r3["MAT-0060:BAF-2210"].id, "MAT-0061": r3["MAT-0061:CC-55121"].id, "MAT-0062": r3["MAT-0062:CC-55120"].id };
  const soapTests: [string, string, string, boolean][] = [
    ["pH (10% solution)", "9.0 – 10.5", "9.8", true],
    ["Appearance", "Smooth green bar, no cracks", "Conforms", true],
    ["Net weight (n=10)", "≥ 135 g each", "136.2 g avg", true],
  ];
  const b1 = await makeBatch(fACS, { status: "released", daysAgo: 18, outputUnits: 124, stepsDone: 7, dispense: true, tests: soapTests, release: true, matLots: soapLots });
  const b2 = await makeBatch(fGBS, { status: "released", daysAgo: 11, outputUnits: 122, stepsDone: 7, dispense: true, tests: soapTests, release: true, matLots: soapLots });
  const b3 = await makeBatch(fACS, { status: "awaiting_qc", daysAgo: 3, outputUnits: 121, stepsDone: 7, dispense: true, tests: [["pH (10% solution)", "9.0 – 10.5", "10.1", true]], matLots: soapLots });
  const b4 = await makeBatch(fACS, { status: "in_process", daysAgo: 0, stepsDone: 1, matLots: soapLots });
  await db.update(s.batches).set({ status: "in_process" }).where(eq(s.batches.id, b4.id));
  const b5 = await makeBatch(fGBS, { status: "planned", daysAgo: -2, matLots: soapLots });
  void b5;
  void lotionLots;
  void b2;
  void b3;

  // A released lotion lot received from a previous period (finished goods at RVS for multi-site demo)
  const lotionLotNo = next("LOT");
  const [lotionFg] = await db
    .insert(s.inventoryLots)
    .values({ organizationId: O, siteId: rvs.id, lotNumber: lotionLotNo, itemKind: "product", productId: ahl.id, manufacturedOn: day(-60), expiresOn: day(480), qualityStatus: "released", baseUom: "pcs", createdBy: U["warehouse.rvs"], createdAt: at(-55, 9) })
    .returning();
  await move({ siteId: rvs.id, type: "receipt", lotId: lotionFg.id, to: L(rvs.id, "FG-01"), qty: new Decimal(310), uom: "pcs", doc: ["transfer_in", null, "Opening stock"], by: U["warehouse.rvs"], when: at(-55, 9), reason: "Opening balance (demo)" });

  // Customers and orders
  const custs = await db
    .insert(s.customers)
    .values([
      { organizationId: O, code: "CUS-001", name: "Luntian Wellness Stores", contactName: "Bea Ramos", phone: "+63 917 555 0101", email: "orders@luntian.test", shipToAddress: "12 Mabini St., Quezon City, Metro Manila", minShelfLifeDays: 365 },
      { organizationId: O, code: "CUS-002", name: "Isla Spa Supplies", contactName: "Marco Tan", phone: "+63 918 555 0144", email: "buying@islaspa.test", shipToAddress: "88 Osmeña Blvd., Cebu City", minShelfLifeDays: 180 },
      { organizationId: O, code: "CUS-003", name: "Mabuhay Pharmacy Group", contactName: "Joy Castillo", phone: "+63 919 555 0177", email: "po@mabuhayrx.test", shipToAddress: "3F Ayala Ave., Makati City", minShelfLifeDays: 270 },
    ])
    .returning();

  const fg1 = (await db.select().from(s.inventoryLots).where(eq(s.inventoryLots.sourceBatchId, b1.id)))[0];
  // Shipped order: 48 pcs of ACS from batch 1
  const soNo1 = next("SO");
  const [so1] = await db.insert(s.salesOrders).values({ organizationId: O, siteId: nfd.id, orderNumber: soNo1, customerId: custs[0].id, customerPoNumber: "LWS-PO-4471", requestedDeliveryOn: day(-6), status: "shipped", createdBy: U["sales"], confirmedBy: U["manager.nfd"], createdAt: at(-9, 10) }).returning();
  const [sol1] = await db.insert(s.salesOrderLines).values({ salesOrderId: so1.id, lineNo: 1, productId: acs.id, qtyUnits: "48", unitPrice: "68.00" }).returning();
  await db.insert(s.stockAllocations).values({ salesOrderLineId: sol1.id, lotId: fg1.id, locationId: L(nfd.id, "FG-01"), qtyUnits: "48" });
  const drNo = next("DR");
  const [sh1] = await db.insert(s.shipments).values({ organizationId: O, siteId: nfd.id, salesOrderId: so1.id, deliveryReceiptNumber: drNo, carrier: "Own truck", driverName: "Ramon Aquino", vehiclePlate: "NBC 1234", packageCount: 1, dispatchedBy: U["warehouse.nfd"], dispatchedAt: at(-7, 14), receivedByName: "Bea Ramos", deliveredAt: at(-6, 11) }).returning();
  await move({ siteId: nfd.id, type: "shipment", lotId: fg1.id, from: L(nfd.id, "FG-01"), qty: new Decimal(48), uom: "pcs", doc: ["shipment", sh1.id, drNo], by: U["warehouse.nfd"], when: at(-7, 14) });

  // Confirmed order waiting for allocation
  const soNo2 = next("SO");
  const [so2] = await db.insert(s.salesOrders).values({ organizationId: O, siteId: nfd.id, orderNumber: soNo2, customerId: custs[1].id, customerPoNumber: "ISS-2210", requestedDeliveryOn: day(3), status: "confirmed", createdBy: U["sales"], confirmedBy: U["manager.nfd"], createdAt: at(-1, 13) }).returning();
  await db.insert(s.salesOrderLines).values([
    { salesOrderId: so2.id, lineNo: 1, productId: acs.id, qtyUnits: "48", unitPrice: "70.00" },
    { salesOrderId: so2.id, lineNo: 2, productId: gbs.id, qtyUnits: "48", unitPrice: "70.00" },
  ]);
  // Draft order
  const soNo3 = next("SO");
  const [so3] = await db.insert(s.salesOrders).values({ organizationId: O, siteId: nfd.id, orderNumber: soNo3, customerId: custs[2].id, requestedDeliveryOn: day(10), status: "draft", createdBy: U["sales"], createdAt: at(0, 9) }).returning();
  await db.insert(s.salesOrderLines).values({ salesOrderId: so3.id, lineNo: 1, productId: gbs.id, qtyUnits: "96", unitPrice: "66.50" });

  // Numbering rules continue after the seeded numbers
  for (const [t, [p, w, pk]] of Object.entries(RULE)) {
    await db.insert(s.numberingRules).values({ organizationId: O, documentType: t, prefix: p, sequenceWidth: w, periodKey: pk, nextValue: (counters[t] ?? 0) + 1 });
  }

  await seedW1D(db, { O, U, sites: { NFD: nfd.id, RVS: rvs.id }, roleRows, passwordHash: pw });

  await seedReceivingW1B(db);
  await (await import("./seeds/w1c")).seedW1C(db);
  await seedW1e(db); // W1E: templates, label templates, print station
  await seedW1a(db, O);
  await (await import("./seeds/w2b")).seedW2B(db); // W2B: released wrapper lot for the packaging step

  console.log(`Seeded demo organization with ${mats.length} materials, ${counters.LOT} lots, ${counters.BATCH} batches, ${counters.SO} orders.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
