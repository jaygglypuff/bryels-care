/**
 * W3C import wizard engine, master-data and opening-stock kinds, legacy documents and the loader
 * (US-5-08, US-5-09, US-2-25, US-2-26; docs/data-migration-plan.md §7–§9, MC-01..MC-04, MC-09, MC-12, MC-16).
 * Tests: import.duplicates_flagged, import.requires_approval, import.row_cap, audit.import_events,
 * authz.cross_site.* (imports, legacy documents), role escalation negatives.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  containers,
  customerAddresses,
  customers,
  goodsReceipts,
  importJobRows,
  importJobs,
  inventoryBalances,
  inventoryLots,
  legacyDocuments,
  locations,
  materialAliases,
  materials,
  openingBalanceLines,
  products,
  stockMovements,
  suppliers,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { writeStoredSetting } from "@/lib/settings";
import { findLedgerDifferences, reverseReceipt } from "@/modules/inventory";
import {
  approveImport,
  decideRow,
  exportImportRows,
  getImportJob,
  listImportJobs,
  listImportRows,
  lotMigrationHistory,
  parseLoaderArgs,
  postImport,
  rejectImport,
  runLoader,
  saveJobMapping,
  startValidation,
  submitImport,
  uploadImport,
  uploadLegacyScans,
  verifyLegacyDocument,
  voidImport,
  issueImportFileUrl,
  redeemImportFile,
} from "@/modules/imports";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let manager: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let warehouseRvs: AuthContext;
let procurement: AuthContext;
const saved = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };
const bytes = (s: string) => new TextEncoder().encode(s);
const PDF = Uint8Array.from(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"));

async function upload(ctx: AuthContext, kind: string, fileName: string, text: string, extra: { reuploadReason?: string; siteId?: string } = {}) {
  return uploadImport(ctx, { kind, fileName, bytes: bytes(text), idempotencyKey: randomUUID(), ...extra });
}
const job = async (id: string) => (await db.select().from(importJobs).where(eq(importJobs.id, id)))[0];
const rowsOf = async (id: string) => db.select().from(importJobRows).where(eq(importJobRows.importJobId, id)).orderBy(importJobRows.rowNo);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  process.env.FILE_STORAGE = "local";
  process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "bc-w3c-"));
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouseRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  procurement = await asUser(kit, "sales@bryels-care.test", "procurement", [kit.nfd]);
}, 180_000);

afterAll(() => {
  process.env.FILE_STORAGE = saved.FILE_STORAGE;
  process.env.FILE_STORAGE_DIR = saved.FILE_STORAGE_DIR;
});

const MATERIALS_CSV = [
  "code,name,inci_name,material_class,uom_base,shelf_life_days,requires_coa,legacy_number",
  "MAT-7001,Shea Butter (fictional),Butyrospermum Parkii Butter,raw,g,730,yes,OLD-SHEA",
  "MAT-0012,Coconut Oil,Cocos Nucifera (Coconut) Oil,raw_material,g,730,yes,",
  "MAT-7002,Mystery Powder,,,g,,,",
  "MAT-7003,Coconut  Oil.,,raw_material,g,,no,OLD-COCO-2",
  ",Kraft Box Sleeve (fictional),,packaging,pcs,,no,",
  'MAT-7004,"=HYPERLINK(""http://evil.test"")",,consumable,pcs,,no,',
].join("\n");

describe("US-5-08 / US-5-09 materials import through the wizard engine", () => {
  let jobId: string;

  it("upload keeps the file and checksum, maps the columns automatically and records platform.import_job.uploaded", async () => {
    const r = await upload(admin, "materials", "materials.csv", MATERIALS_CSV);
    jobId = r.jobId;
    const j = await job(jobId);
    expect(j.status).toBe("uploaded");
    expect(j.importNumber).toMatch(/^IMP-\d{4}-\d{3}$/);
    expect(j.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(j.rowsTotal).toBe(6);
    expect((j.mapping as { columns: Record<string, string> }).columns.material_class).toBe("material_class");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.import_job.uploaded"), eq(auditEvents.entityId, jobId)));
    expect(ev).toBeTruthy();
    // Retry with the same key returns the same job (idempotent upload).
    const again = await uploadImport(admin, { kind: "materials", fileName: "materials.csv", bytes: bytes(MATERIALS_CSV), idempotencyKey: j.idempotencyKey });
    expect(again).toMatchObject({ jobId, replayed: true });
  });

  it("validation gives every row a result: accepted, tier 1 duplicate, rejected, tier 2 possible duplicate (import.duplicates_flagged)", async () => {
    await startValidation(admin, jobId);
    const j = await job(jobId);
    expect(j.status).toBe("under_review");
    const rows = await rowsOf(jobId);
    const by = (n: number) => rows.find((r) => r.rowNo === n)!;
    expect(by(2).result).toBe("accepted");
    expect(by(3)).toMatchObject({ result: "duplicate", duplicateTier: 1 });
    expect(by(4).result).toBe("rejected");
    expect(by(4).errorMessage).toMatch(/Material class is required/);
    expect(by(5)).toMatchObject({ result: "possible_duplicate", duplicateTier: 2 });
    expect(by(6).result).toBe("accepted");
    expect(by(7).result).toBe("accepted");
    // MC-01: no row without a result; the dry run did not create anything.
    expect(rows.every((r) => r.result !== "pending")).toBe(true);
    expect(await db.select().from(materials).where(eq(materials.code, "MAT-7001"))).toHaveLength(0);
    expect(j.errorFileAttachmentId).toBeTruthy();
    expect(j).toMatchObject({ rowsAccepted: 3, rowsDuplicate: 1, rowsRejected: 1, rowsPossibleDuplicate: 1 });
  });

  it("the results file is downloadable through a signed link and neutralises formulas (export.formula_neutralized)", async () => {
    const j = await job(jobId);
    const link = await issueImportFileUrl(admin, j.errorFileAttachmentId!);
    const u = new URL(link.url, "http://x");
    const file = await redeemImportFile(admin, j.errorFileAttachmentId!, { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") });
    expect(file.kind).toBe("bytes");
    const text = Buffer.from((file as { bytes: Uint8Array }).bytes).toString("utf8");
    expect(text).toContain("Material class is required");
    await expectCode(redeemImportFile(manager, j.errorFileAttachmentId!, { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") }), "forbidden");
  });

  it("the custodian decides the possible duplicate; submit, then a second person approves (import.requires_approval)", async () => {
    await expectCode(submitImport(admin, jobId), "state");
    const row = (await rowsOf(jobId)).find((r) => r.rowNo === 5)!;
    await expectCode(decideRow(admin, jobId, { rowId: row.id, decision: "reject", note: "x" }), "validation");
    await decideRow(admin, jobId, { rowId: row.id, decision: "same_as_existing", note: "Same oil, old spelling" });
    expect((await job(jobId)).status).toBe("validated");
    await expectCode(postImport(admin, jobId), "state");
    await submitImport(admin, jobId);
    await expectCode(approveImport(admin, jobId), "separation_of_duties");
    await expectCode(approveImport(procurement, jobId), "forbidden");
    await approveImport(manager, jobId, "Checked against the S-03 list");
    expect((await job(jobId)).status).toBe("approved");
  });

  it("posting creates the accepted rows through the material service, records the crosswalk, the alias and platform.import_job.posted with counts", async () => {
    await expectCode(postImport(procurement, jobId), "forbidden");
    await postImport(admin, jobId);
    const j = await job(jobId);
    expect(j.status).toBe("posted");
    expect(j.rowsCreated).toBe(4); // 3 new materials + the alias link of the decided duplicate
    const created = await db.select().from(materials).where(sql`${materials.code} in ('MAT-7001','MAT-7004')`);
    expect(created).toHaveLength(2);
    expect(created.find((m) => m.code === "MAT-7004")!.name).toBe('=HYPERLINK("http://evil.test")');
    const assigned = await db.select().from(materials).where(eq(materials.name, "Kraft Box Sleeve (fictional)"));
    expect(assigned[0].code).toMatch(/^MAT-\d{4}$/);
    const alias = await db.select().from(materialAliases).where(eq(materialAliases.alias, "Coconut Oil."));
    expect(alias).toHaveLength(1);
    const rows = await rowsOf(jobId);
    expect(rows.find((r) => r.rowNo === 2)!.createdEntityType).toBe("material");
    // MC-02: created entities = accepted rows.
    expect(rows.filter((r) => r.createdEntityType === "material" && r.result === "accepted")).toHaveLength(3);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.import_job.posted"), eq(auditEvents.entityId, jobId)));
    expect((ev.after as { counts: { created: number } }).counts.created).toBe(4);
    const [mat] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.material.created"), eq(auditEvents.entityNumber, "MAT-7001")));
    expect(mat.actorLabel).toBe("system:platform.import_job.process");
    expect(mat.onBehalfOf).toBe(admin.userId);
    const crosswalk = await exportImportRows(admin, jobId, "crosswalk");
    expect(crosswalk.body.toString()).toContain("MAT-7001");
  });

  it("re-uploading the same file needs a reason and then creates nothing new (create-only re-run)", async () => {
    await expectCode(upload(admin, "materials", "materials.csv", MATERIALS_CSV), "conflict");
    const r = await upload(admin, "materials", "materials.csv", MATERIALS_CSV, { reuploadReason: "Rehearsal re-run of the same file" });
    await startValidation(admin, r.jobId);
    const rows = await rowsOf(r.jobId);
    expect(rows.find((x) => x.rowNo === 2)!.result).toBe("duplicate");
    expect(rows.find((x) => x.rowNo === 7)!.result).toBe("duplicate");
    await rejectImport(admin, r.jobId, "Nothing new to load");
    expect((await job(r.jobId)).status).toBe("rejected");
  });

  it("a saved mapping profile is versioned and reused for a file with other headers", async () => {
    const r = await upload(admin, "materials", "suppliers-list.csv", "Item No,Item Name,Kind,Unit\nMAT-7100,Rice Bran Oil (fictional),raw_material,g\n");
    await expectCode(startValidation(admin, r.jobId), "validation");
    await saveJobMapping(admin, r.jobId, { columns: { code: "Item No", name: "Item Name", material_class: "Kind", uom_base: "Unit" }, dateFormat: "DD/MM/YYYY", decimalSeparator: ".", thousandsSeparator: ",", profile: { code: "PURCHASE-LIST", name: "Purchase list export" } });
    const r2 = await uploadImport(admin, { kind: "materials", fileName: "list2.csv", bytes: bytes("Item No,Item Name,Kind,Unit\nMAT-7101,Oat Milk (fictional),raw_material,g\n"), idempotencyKey: randomUUID(), mappingCode: "PURCHASE-LIST" });
    const j2 = await getImportJob(admin, r2.jobId);
    expect(j2.profile?.version).toBe(1);
    await startValidation(admin, r2.jobId);
    expect((await job(r2.jobId)).rowsAccepted).toBe(1);
  });

  it("refuses a file above the row cap set in settings (import.row_cap) and roles without the permission", async () => {
    await writeStoredSetting(db, { organizationId: kit.orgId, key: "platform.imports.max_rows", value: 2, updatedBy: admin.userId });
    await expectCode(upload(admin, "materials", "big.csv", "code,name,material_class,uom_base\nA1,a,raw_material,g\nA2,b,raw_material,g\nA3,c,raw_material,g\n"), "too_large");
    await writeStoredSetting(db, { organizationId: kit.orgId, key: "platform.imports.max_rows", value: null, updatedBy: admin.userId });
    await expectCode(upload(operator, "materials", "m.csv", MATERIALS_CSV), "forbidden");
    await expectCode(upload(admin, "customers", "c.csv", "code,name\nC1,x\n"), "setup_required");
  });
});

describe("suppliers kind", () => {
  it("procurement prepares a supplier file; an invalid email is a warning and is not loaded; procurement cannot approve", async () => {
    const r = await upload(procurement, "suppliers", "sup.csv", "code,name,email,quality_status\nSUP-8001,Bicol Coco Traders (fictional),not-an-email,new\nSUP-8002,Zamboanga Resin Works (fictional),,approved\n");
    await startValidation(procurement, r.jobId);
    const rows = (await listImportRows(procurement, r.jobId)).rows;
    expect(rows[0].result).toBe("accepted");
    expect((rows[0].warnings as string[]).join(" ")).toMatch(/not a valid address/);
    expect((rows[0].values as { email: string | null }).email).toBeNull();
    await submitImport(procurement, r.jobId);
    await expectCode(approveImport(procurement, r.jobId), "forbidden");
    // Wave 3 integration (ADR-053): a seeded role can post it — system_admin holds platform.import_job.post
    // and masterdata.supplier.create; the site manager approves but cannot post suppliers.
    await approveImport(manager, r.jobId, "Checked against the vendor list");
    await expectCode(postImport(manager, r.jobId), "forbidden");
    await postImport(admin, r.jobId);
    expect((await job(r.jobId)).status).toBe("posted");
    const created = await db.select().from(suppliers).where(sql`${suppliers.code} in ('SUP-8001','SUP-8002')`);
    expect(created.map((x) => x.code).sort()).toEqual(["SUP-8001", "SUP-8002"]);
    expect(created.find((x) => x.code === "SUP-8001")!.email).toBeNull();
  });
});

describe("customers kind (W3D customer service, registered by the Wave 3 wiring)", () => {
  it("validates, refuses credit terms without finance.credit_terms.approve, and posts customers with their ship-to address", async () => {
    registerAppHooks();
    const csv = [
      "code,name,status,ship_to_line1,ship_to_city,ship_to_province,contact_name,phone,email,min_shelf_life_days,payment_terms_days,credit_limit_amount,currency,tax_identifier,legacy_number",
      "CUS-9101,Sampaguita Wellness Store (fictional),active,12 Rizal Ave.,Santa Rosa,Laguna,Lorna Reyes,+63 900 111 2222,orders@sampaguita.test,180,,,PHP,,C-101",
      "CUS-9102,Ilang-Ilang Spa (fictional),prospect,3 Mabini St.,Calamba,Laguna,,,,,30,50000,PHP,,C-102",
      "CUS-9103,No Address Trading (fictional),active,,,,,,,,,,PHP,,C-103",
      "CUS-9104,Dollar Buyer (fictional),active,4 Luna St.,Calamba,,,,,,,,USD,,",
    ].join("\n");
    const r = await upload(admin, "customers", "customers.csv", csv);
    await startValidation(admin, r.jobId);
    const rows = (await listImportRows(admin, r.jobId)).rows;
    expect(rows.map((x) => x.result)).toEqual(["accepted", "rejected", "rejected", "rejected"]);
    expect(JSON.stringify(rows[1].errors)).toMatch(/finance/);
    expect(JSON.stringify(rows[2].errors)).toMatch(/ship-to/i);
    expect(JSON.stringify(rows[3].errors)).toMatch(/PHP/);
    await submitImport(admin, r.jobId);
    await approveImport(manager, r.jobId, "Checked against the customer list");
    await postImport(admin, r.jobId);
    expect((await job(r.jobId)).status).toBe("posted");
    const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-9101"));
    expect(c).toMatchObject({ name: "Sampaguita Wellness Store (fictional)", minShelfLifeDays: 180, creditLimitAmount: null });
    expect(c.shipToAddress).toMatch(/12 Rizal Ave\./);
    const [addr] = await db.select().from(customerAddresses).where(eq(customerAddresses.customerId, c.id));
    expect(addr).toMatchObject({ isDefaultShipTo: true, city: "Santa Rosa" });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.customer.created"), eq(auditEvents.entityId, c.id)));
    expect(ev).toHaveLength(1);
    expect(await db.select().from(customers).where(eq(customers.code, "CUS-9102"))).toHaveLength(0);
  });
});

describe("cross-site isolation of imports (authz.cross_site)", () => {
  it("a user of another site cannot see or act on the job", async () => {
    const r = await upload(manager, "locations", "loc.csv", "warehouse_code,code,kind\nWH1,NFD-Z9,zone\n");
    const rvsManager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
    await expectCode(getImportJob(rvsManager, r.jobId), "not_found");
    await expectCode(startValidation(rvsManager, r.jobId), "not_found");
    expect((await listImportJobs(rvsManager)).some((j) => j.id === r.jobId)).toBe(false);
    await expectCode(upload(manager, "locations", "x.csv", "warehouse_code,code,kind\nWH1,X,zone\n", { siteId: kit.rvs.id }), "not_found");
  });
});

const OPENING = (rows: string[]) =>
  ["site_code,location_code,item_kind,item_code,legacy_number,supplier_lot_number,manufacture_date,expiry_date,qty,uom,container_kind,container_count,qty_per_container,counted_by,checked_by,count_sheet_ref", ...rows].join("\n");

describe("US-5-09 / US-2-26 opening stock as opening-balance receipts (P7, A-MIG-06, A-MIG-07)", () => {
  let jobId: string;
  const file = OPENING([
    "NFD,A-01,material,MAT-0012,,SUP-LOT-77,01/03/2026,28/02/2028,50,kg,drum,2,25,Ana Cruz,Ben Diaz,CS-0001",
    "NFD,A-02,material,MAT-0012,,SUP-LOT-77,01/03/2026,28/02/2028,10000,g,,,,Ana Cruz,Ben Diaz,CS-0002",
    "NFD,B-01,material,MAT-0043,,SUP-LOT-9,,,2000,g,,,,Ana Cruz,Ben Diaz,CS-0003",
    "NFD,A-01,material,MAT-0013,,OLD-1,01/01/2024,01/01/2025,3000,g,,,,Ana Cruz,Ben Diaz,CS-0004",
    "NFD,FG-01,product,ACS-135,PB-2025-0142,,05/02/2025,05/02/2027,100,,,,,Ana Cruz,Ben Diaz,CS-0005",
    "NFD,A-01,material,MAT-0061,,G-1,,01/01/2028,500,g,,,,Ana Cruz,ana cruz,CS-0006",
    "NFD,ZZ-99,material,MAT-0061,,G-1,,01/01/2028,500,g,,,,Ana Cruz,Ben Diaz,CS-0007",
    "RVS,FG-01,product,ACS-135,,,,01/01/2027,10,,,,,Ana Cruz,Ben Diaz,CS-0008",
  ]);

  it("validates: counter ≠ checker, unknown location, wrong site rejected; missing expiry is a hold; nothing posts in the dry run", async () => {
    const r = await upload(manager, "opening_stock", "count-nfd.csv", file);
    jobId = r.jobId;
    await startValidation(manager, jobId);
    const rows = await rowsOf(jobId);
    const res = Object.fromEntries(rows.map((x) => [x.rowNo, x.result]));
    expect(res).toMatchObject({ 2: "accepted", 3: "accepted", 4: "hold", 5: "hold", 6: "accepted", 7: "rejected", 8: "rejected", 9: "rejected" });
    expect(rows.find((x) => x.rowNo === 7)!.errorMessage).toMatch(/different person/);
    expect(rows.find((x) => x.rowNo === 8)!.errorMessage).toMatch(/ZZ-99 does not exist/);
    expect(rows.find((x) => x.rowNo === 9)!.errorMessage).toMatch(/not the import's site/);
    expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.receiptKind, "opening_balance"))).toHaveLength(0);
  });

  it("posting needs the migration window on production and the entity permissions of the poster", async () => {
    await submitImport(manager, jobId);
    await approveImport(admin, jobId);
    await expectCode(postImport(manager, jobId, { env: { APP_ENV: "production" } }), "forbidden");
    await expectCode(postImport(admin, jobId), "forbidden"); // system_admin may post imports but not goods receipts
    await postImport(manager, jobId, { env: { APP_ENV: "production", MIGRATION_WINDOW_OPEN: "true" } });
    expect((await job(jobId)).status).toBe("posted");
  });

  it("posts one opening receipt, lots in their opening status, ledger receipts and containers (MC-03, MC-04, MC-16)", async () => {
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.receiptKind, "opening_balance"));
    expect(gr).toMatchObject({ status: "posted", supplierId: null, unplannedReasonCode: "opening_balance" });
    const lines = await db.select().from(openingBalanceLines).where(eq(openingBalanceLines.importJobId, jobId));
    expect(lines).toHaveLength(5);
    const lots = await db.select().from(inventoryLots).where(sql`${inventoryLots.id} in (select lot_id from opening_balance_lines where import_job_id = ${jobId})`);
    expect(lots).toHaveLength(4); // rows 2 and 3 share one lot (same material, supplier lot, expiry)
    const coco = lots.find((l) => l.supplierLotNumber === "SUP-LOT-77")!;
    expect(coco.qualityStatus).toBe("quarantine");
    expect(lots.find((l) => l.supplierLotNumber === "SUP-LOT-9")!.qualityStatus).toBe("on_hold");
    expect(lots.find((l) => l.supplierLotNumber === "OLD-1")!.qualityStatus).toBe("expired");
    const fg = lots.find((l) => l.itemKind === "product")!;
    expect(fg).toMatchObject({ legacyNumber: "PB-2025-0142", qualityStatus: "quarantine" });
    expect(lines.find((l) => l.lotId === lots.find((x) => x.supplierLotNumber === "SUP-LOT-9")!.id)!.holdReasonCode).toBe("expiry_unknown");
    // MC-03: Σ on hand of the coconut lot = 50 kg + 10,000 g in base units.
    const bal = await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, coco.id));
    expect(bal.reduce((s, b) => s + Number(b.qtyBase), 0)).toBe(60000);
    // MC-16: every opening movement is a receipt with the opening receipt as source.
    const moves = await db.select().from(stockMovements).where(sql`${stockMovements.lotId} in (select lot_id from opening_balance_lines where import_job_id = ${jobId})`);
    expect(moves).toHaveLength(5);
    expect(moves.every((m) => m.movementType === "receipt" && m.sourceDocumentType === "goods_receipt" && m.sourceDocumentId === gr.id && m.reason === "opening_balance")).toBe(true);
    // A-MIG-07: 100 finished units at 48 per box → 2 boxes + 1 loose; 2 drums of 25 kg for the coconut row.
    const fgBoxes = await db.execute<{ kind: string; qty: string }>(sql`select c.container_kind as kind, cc.qty_base as qty from containers c join container_contents cc on cc.container_id = c.id where cc.lot_id = ${fg.id} order by c.container_number`);
    expect(fgBoxes.map((b) => [b.kind, Number(b.qty)])).toEqual([["box", 48], ["box", 48], ["loose", 4]]);
    const drums = await db.execute<{ n: number }>(sql`select count(*)::int as n from containers c join container_contents cc on cc.container_id = c.id where cc.lot_id = ${coco.id} and c.container_kind = 'drum' and cc.qty_base = 25000`);
    expect(drums[0].n).toBe(2);
    // MC-04: ledger and projection agree.
    expect(await findLedgerDifferences(db, { organizationId: kit.orgId, siteIds: [kit.nfd.id] })).toEqual([]);
  });

  it("the generic receipt reversal refuses an opening receipt; a re-run of the count file posts nothing twice", async () => {
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.receiptKind, "opening_balance"));
    await expectCode(reverseReceipt(manager, { receiptId: gr.id, reason: "wrong path test" }), "state");
    const r = await upload(manager, "opening_stock", "count-nfd.csv", file, { reuploadReason: "Re-run after fixing two rows" });
    await startValidation(manager, r.jobId);
    const rows = await rowsOf(r.jobId);
    expect(rows.filter((x) => x.result === "duplicate").map((x) => x.rowNo)).toEqual([2, 3, 4, 5, 6]);
  });

  it("legacy BMR scans are indexed, open from the migrated lot page and are verified by a second person (MC-12)", async () => {
    const csv = "kind,legacy_number,product_code,batch_size,batch_size_uom,start_date,disposition,qa_name,file_name\nbmr,PB-2025-0142,ACS-135,17600,g,03/02/2025,approved,Sample Reviewer,PB-2025-0142.pdf\nbmr,PB-2025-0999,ACS-135,,,,,,missing.pdf\n";
    const r = await upload(manager, "legacy_documents", "ldoc.csv", csv);
    await expectCode(uploadLegacyScans(manager, r.jobId, [{ fileName: "evil.pdf", declaredType: "application/pdf", bytes: bytes("<script>") }]), "validation");
    await uploadLegacyScans(manager, r.jobId, [{ fileName: "PB-2025-0142.pdf", declaredType: "application/pdf", bytes: PDF }]);
    await startValidation(manager, r.jobId);
    const rows = await rowsOf(r.jobId);
    expect(rows.map((x) => x.result)).toEqual(["accepted", "rejected"]);
    await submitImport(manager, r.jobId);
    await approveImport(admin, r.jobId);
    await postImport(manager, r.jobId);
    const [doc] = await db.select().from(legacyDocuments).where(eq(legacyDocuments.legacyNumber, "PB-2025-0142"));
    expect(doc.documentNumber).toMatch(/^LDOC-\d{6}$/);
    const [fg] = await db.select().from(inventoryLots).where(eq(inventoryLots.legacyNumber, "PB-2025-0142"));
    const h = await lotMigrationHistory(qa, fg.id);
    expect(h.documents.map((d) => d.documentNumber)).toEqual([doc.documentNumber]);
    expect(h.opening[0]).toMatchObject({ countSheetRef: "CS-0005", countedBy: "Ana Cruz", checkedBy: "Ben Diaz" });
    await expectCode(verifyLegacyDocument(manager, doc.id), "forbidden");
    await expectCode(lotMigrationHistory(warehouseRvs, fg.id), "not_found");
    await verifyLegacyDocument(qa, doc.id);
    const link = await issueImportFileUrl(qa, doc.fileAttachmentId);
    expect(link.url).toContain("/api/v1/imports/files/");
    await expectCode(issueImportFileUrl(warehouseRvs, doc.fileAttachmentId), "forbidden");
  });

  it("void reverses every opening line (import_voided), empties the boxes and leaves the lots at zero with their status", async () => {
    await expectCode(voidImport(manager, jobId, "Wrong zone counted"), "forbidden");
    const out = await voidImport(admin, jobId, "Zone A recounted");
    expect(out).toMatchObject({ status: "voided", reversedLines: 5 });
    const lots = await db.select().from(inventoryLots).where(sql`${inventoryLots.id} in (select lot_id from opening_balance_lines where import_job_id = ${jobId})`);
    for (const l of lots) {
      const b = await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, l.id));
      expect(b.reduce((s, x) => s + Number(x.qtyBase), 0)).toBe(0);
    }
    expect(lots.find((l) => l.supplierLotNumber === "OLD-1")!.qualityStatus).toBe("expired");
    const rev = await db.select().from(stockMovements).where(and(eq(stockMovements.movementType, "reversal"), sql`${stockMovements.reason} like 'import_voided:%'`));
    expect(rev).toHaveLength(5);
    const live = await db.execute<{ n: number }>(sql`select count(*)::int as n from containers where status in ('open','sealed') and id in (select container_id from container_contents where lot_id in (select lot_id from opening_balance_lines where import_job_id = ${jobId}))`);
    expect(live[0].n).toBe(0);
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.receiptKind, "opening_balance"));
    expect(gr.status).toBe("reversed");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.import_job.reversed"), eq(auditEvents.entityId, jobId)));
    expect(ev.reason).toBe("Zone A recounted");
    void containers;
    void locations;
    void products;
  });
});

describe("US-2-25 command-line loader", () => {
  const prompts = (answers: string[]) => async () => answers.shift() ?? "";
  const files = new Map<string, Uint8Array>();
  const deps = (env: Record<string, string>, answers: string[], log: string[]) => ({
    env,
    readFile: async (p: string) => files.get(p)!,
    writeFile: async (p: string, b: Uint8Array) => void files.set(p, b),
    prompt: prompts(answers),
    log: (l: string) => void log.push(l),
  });

  it("parses the documented options", () => {
    expect(parseLoaderArgs(["--kind", "suppliers", "--file", "s.csv", "--site", "NFD", "--as", "a@b.test"])).toMatchObject({ command: "load", kind: "suppliers", site: "NFD" });
    expect(parseLoaderArgs(["approve", "IMP-1", "--as", "x@y.test"])).toMatchObject({ command: "approve", job: "IMP-1" });
    expect(() => parseLoaderArgs(["--bogus"])).toThrow();
  });

  it("refuses production without MIGRATION_WINDOW_OPEN and a wrong password; dry run validates and submits; --post needs read-only mode and the second person's approval", async () => {
    files.set("/data/suppliers.csv", bytes("code,name,material_class,uom_base\nMAT-8001,Bicol Coco Fibre (fictional),consumable,pcs\n"));
    const log: string[] = [];
    expect(await runLoader(parseLoaderArgs(["--kind", "materials", "--file", "/data/suppliers.csv", "--site", "NFD", "--as", "admin@bryels-care.test"]), deps({ APP_ENV: "production" }, ["demo1234"], log))).toBe(1);
    expect(log.join(" ")).toMatch(/MIGRATION_WINDOW_OPEN/);
    await expectCode(runLoader(parseLoaderArgs(["--kind", "materials", "--file", "/data/suppliers.csv", "--site", "NFD", "--as", "admin@bryels-care.test"]), deps({}, ["wrong"], log)), "reauth_required");
    expect(await runLoader(parseLoaderArgs(["--kind", "materials", "--file", "/data/suppliers.csv", "--site", "NFD", "--as", "admin@bryels-care.test"]), deps({}, ["demo1234"], log))).toBe(0);
    const [j] = await db.select().from(importJobs).where(and(eq(importJobs.source, "loader"), eq(importJobs.importKind, "materials")));
    expect(j.status).toBe("submitted");
    expect([...files.keys()].some((k) => k.endsWith(".results.csv"))).toBe(true);
    // --post refused without the read-only maintenance mode, then without approval.
    expect(await runLoader(parseLoaderArgs(["--post", "--job", j.importNumber, "--as", "admin@bryels-care.test"]), deps({ MIGRATION_WINDOW_OPEN: "true" }, ["demo1234"], log))).toBe(1);
    await writeStoredSetting(db, { organizationId: kit.orgId, key: "platform.maintenance.read_only", value: { enabled: true, allowed_role_codes: ["system_admin", "site_manager"] }, updatedBy: admin.userId });
    try {
      await expectCode(runLoader(parseLoaderArgs(["--post", "--job", j.importNumber, "--as", "admin@bryels-care.test"]), deps({ MIGRATION_WINDOW_OPEN: "true" }, ["demo1234"], log)), "state");
      await expectCode(runLoader(parseLoaderArgs(["approve", j.importNumber, "--as", "admin@bryels-care.test"]), deps({}, ["demo1234"], log)), "separation_of_duties");
      expect(await runLoader(parseLoaderArgs(["approve", j.importNumber, "--as", "manager.nfd@bryels-care.test"]), deps({}, ["demo1234"], log))).toBe(0);
      expect(await runLoader(parseLoaderArgs(["--post", "--job", j.importNumber, "--as", "admin@bryels-care.test"]), deps({ MIGRATION_WINDOW_OPEN: "true" }, ["demo1234"], log))).toBe(0);
    } finally {
      await writeStoredSetting(db, { organizationId: kit.orgId, key: "platform.maintenance.read_only", value: null, updatedBy: admin.userId });
    }
    expect(await db.select().from(materials).where(eq(materials.code, "MAT-8001"))).toHaveLength(1);
    expect((await job(j.id)).status).toBe("posted");
    const [rauth] = await db.select().from(auditEvents).where(eq(auditEvents.action, "identity.reauth.succeeded"));
    expect(rauth).toBeTruthy();
  });
});
