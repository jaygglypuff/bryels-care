import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { CONTAINER_KINDS, goodsReceipts, importJobRows, inventoryLots, locations, materials, openingBalanceLines, products, sites, suppliers, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { createBox, manilaToday, postMovement, voidBoxesForReversal } from "@/modules/inventory";
import { toBaseQuantity } from "@/modules/masterdata";
import type { CreateContext, ExistingMatch, ImportKindHandler } from "./types";

/**
 * `opening_stock` (docs/data-migration-plan.md §7.9, §7.10, §8, P1, P7, A-MIG-06, A-MIG-07).
 *
 * The physical count becomes ledger postings, never typed balances:
 * - one posted goods receipt of kind `opening_balance` (rule GR, no supplier) per job and warehouse;
 * - one lot per item × supplier lot × expiry (or per legacy batch number) with rule LOT numbers, in the
 *   status of A-MIG-06: `quarantine`; `expired` when the expiry has passed; `on_hold` when the expiry
 *   (or the supplier lot) is missing for a class listed in setting `imports.opening_stock.status_rules`.
 *   No lot is ever released by an import: QA releases through the bulk disposition (US-2-23);
 * - one `receipt` movement per row through `postMovement` (source_document_type goods_receipt, reason
 *   `opening_balance`), so balances, V-FREEZE, blocked locations and the audit trail follow the ledger;
 * - containers per row (count × quantity per container, or finished goods per the product's units per
 *   box with the remainder in one `loose` container) through the container service.
 * Void (platform.import_job.void) empties the boxes and posts one `reversal` per line (reason
 * `import_voided`); lots stay at zero balance and keep their status (a status change is QA's).
 */
type ItemKind = "material" | "product";
type OpeningValues = {
  siteCode: string | null;
  warehouseCode: string | null;
  locationCode: string;
  itemKind: ItemKind;
  itemCode: string;
  legacyNumber: string | null;
  supplierCode: string | null;
  supplierLotNumber: string | null;
  manufacturedOn: string | null;
  expiresOn: string | null;
  retestOn: string | null;
  qty: string;
  uom: string | null;
  containerKind: string | null;
  containerCount: number | null;
  qtyPerContainer: string | null;
  qualityStatusClaimed: string | null;
  countedBy: string;
  checkedBy: string;
  countSheetRef: string;
  unitCost: string | null;
  currency: string | null;
  notes: string | null;
};

const MAX_CONTAINERS_PER_ROW = 1000;
const NOT_FOR_OPENING = ["production", "shipping"];

const lotKey = (v: OpeningValues) => (v.legacyNumber ? `legacy:${v.legacyNumber}` : `${v.itemKind}:${v.itemCode}|${v.supplierLotNumber ?? ""}|${v.expiresOn ?? ""}`);

export const openingStockKind: ImportKindHandler<OpeningValues> = {
  kind: "opening_stock",
  label: "Opening stock",
  description: "The go-live physical count: lots, quantities per location and containers, posted as opening-balance receipts.",
  creates: "inventory_lot",
  entityPermissions: ["procurement.goods_receipt.post", "inventory.movement.post", "inventory.container.create"],
  availability: { available: true },
  requiresMigrationWindow: true,
  columns: [
    { key: "site_code", label: "Site", hint: "Blank = the import's site; otherwise it must be the import's site." },
    { key: "warehouse_code", label: "Warehouse", hint: "Optional check: the location must be in this warehouse." },
    { key: "location_code", label: "Location", required: true, hint: "Location code as on the location label.", aliases: ["location"] },
    { key: "item_kind", label: "Item kind", required: true, hint: "material or product (finished goods)." },
    { key: "item_code", label: "Item code", required: true, hint: "Material code or product code.", aliases: ["material_code", "product_code", "code"] },
    { key: "legacy_number", label: "Legacy batch / lot number", hint: "Paper batch number of a finished-goods lot (links the scanned BMR)." },
    { key: "supplier_code", label: "Supplier code", hint: "Optional; must exist in the supplier list." },
    { key: "supplier_lot_number", label: "Supplier lot", hint: "As written on the container." },
    { key: "manufacture_date", label: "Manufacture date", hint: "Date format of the mapping (default DD/MM/YYYY)." },
    { key: "expiry_date", label: "Expiry date", hint: "Missing for a class that needs it → lot on hold (expiry_unknown)." },
    { key: "retest_date", label: "Retest date", hint: "Optional; not after the expiry." },
    { key: "qty", label: "Quantity", required: true, hint: "Counted quantity in the unit of the next column.", aliases: ["quantity", "counted_qty"] },
    { key: "uom", label: "Unit", hint: "Blank = the item's base unit; other units need an approved conversion." },
    { key: "container_kind", label: "Container kind", hint: `${CONTAINER_KINDS.join(", ")}.` },
    { key: "container_count", label: "Containers", hint: "How many containers of this row." },
    { key: "qty_per_container", label: "Quantity per container", hint: "Containers × quantity per container must equal the quantity." },
    { key: "quality_status_claimed", label: "Status in the old records", hint: "Informational only; QA decides the status (bulk disposition)." },
    { key: "counted_by", label: "Counted by", required: true, hint: "Counter's name." },
    { key: "checked_by", label: "Checked by", required: true, hint: "A different person than the counter." },
    { key: "count_sheet_ref", label: "Count sheet", required: true, hint: "Pre-numbered count sheet reference.", aliases: ["count_sheet"] },
    { key: "unit_cost", label: "Unit cost", hint: "Only when the Accountant supplies it (A-MIG-12)." },
    { key: "currency", label: "Currency", hint: "ISO 4217, e.g. PHP." },
    { key: "notes", label: "Notes", hint: "Optional." },
  ],
  exampleRows: [
    {
      site_code: "NFD",
      warehouse_code: "",
      location_code: "NFD-RM-A1",
      item_kind: "material",
      item_code: "MAT-0012",
      legacy_number: "",
      supplier_code: "",
      supplier_lot_number: "DEMO-LOT-001",
      manufacture_date: "01/03/2026",
      expiry_date: "28/02/2028",
      retest_date: "",
      qty: "50",
      uom: "kg",
      container_kind: "drum",
      container_count: "2",
      qty_per_container: "25",
      quality_status_claimed: "released",
      counted_by: "Sample Counter (fictional)",
      checked_by: "Sample Checker (fictional)",
      count_sheet_ref: "CS-DEMO-0001",
      unit_cost: "",
      currency: "",
      notes: "",
    },
  ],
  normalize(r) {
    const itemKind = r.oneOf("item_kind", ["material", "product"] as const, {
      required: true,
      synonyms: { raw: "material", raw_material: "material", packaging: "material", intermediate: "material", sku: "product", finished_good: "product", finished_goods: "product", fg: "product" },
    });
    const v: OpeningValues = {
      siteCode: r.code("site_code"),
      warehouseCode: r.code("warehouse_code"),
      locationCode: r.code("location_code", { required: true }) ?? "",
      itemKind: itemKind ?? "material",
      itemCode: r.code("item_code", { required: true }) ?? "",
      legacyNumber: r.text("legacy_number", { max: 80 }),
      supplierCode: r.code("supplier_code"),
      supplierLotNumber: r.text("supplier_lot_number", { max: 80 }),
      manufacturedOn: r.date("manufacture_date"),
      expiresOn: r.date("expiry_date"),
      retestOn: r.date("retest_date"),
      qty: r.decimal("qty", { required: true, positive: true }) ?? "",
      uom: r.text("uom", { max: 16 }),
      containerKind: r.oneOf("container_kind", CONTAINER_KINDS),
      containerCount: r.int("container_count", { min: 1, max: MAX_CONTAINERS_PER_ROW }),
      qtyPerContainer: r.decimal("qty_per_container", { positive: true }),
      qualityStatusClaimed: r.text("quality_status_claimed", { max: 40 }),
      countedBy: r.text("counted_by", { required: true, max: 120 }) ?? "",
      checkedBy: r.text("checked_by", { required: true, max: 120 }) ?? "",
      countSheetRef: r.text("count_sheet_ref", { required: true, max: 80 }) ?? "",
      unitCost: r.decimal("unit_cost", { nonNegative: true, dp: 4 }),
      currency: r.code("currency", { pattern: /^[A-Z]{3}$/, example: "PHP" }),
      notes: r.text("notes", { max: 1000 }),
    };
    if (v.countedBy && v.checkedBy && v.countedBy.toLowerCase() === v.checkedBy.toLowerCase()) r.error("checked_by", "The checker must be a different person than the counter (F-10).");
    const today = manilaToday();
    if (v.manufacturedOn && v.manufacturedOn > today) r.error("manufacture_date", "The manufacture date cannot be in the future.");
    if (v.manufacturedOn && v.expiresOn && v.expiresOn < v.manufacturedOn) r.error("expiry_date", "The expiry date is before the manufacture date.");
    if (v.retestOn && v.expiresOn && v.retestOn > v.expiresOn) r.error("retest_date", "The retest date is after the expiry date.");
    if (v.unitCost && !v.currency) r.error("currency", "Give the currency of the unit cost.");
    if (v.qty && (v.containerCount || v.qtyPerContainer)) {
      const qty = new Decimal(v.qty);
      if (v.containerCount && v.qtyPerContainer) {
        if (!new Decimal(v.qtyPerContainer).times(v.containerCount).eq(qty)) r.error("qty_per_container", `Containers × quantity per container (${v.containerCount} × ${v.qtyPerContainer}) must equal the quantity ${v.qty}.`);
      } else if (v.containerCount) {
        const per = qty.div(v.containerCount);
        if (per.decimalPlaces() > 6 || !per.times(v.containerCount).eq(qty)) r.error("container_count", `${v.qty} cannot be split evenly into ${v.containerCount} containers; give the quantity per container.`);
      } else if (v.qtyPerContainer) {
        const n = qty.div(v.qtyPerContainer);
        if (!n.isInteger()) r.error("qty_per_container", `${v.qty} is not a whole number of containers of ${v.qtyPerContainer}; give the container count or split the row.`);
        else if (n.gt(MAX_CONTAINERS_PER_ROW)) r.error("qty_per_container", `More than ${MAX_CONTAINERS_PER_ROW} containers in one row; split the row.`);
      }
    }
    if (v.qualityStatusClaimed) r.warn(`The old records say "${v.qualityStatusClaimed}"; the lot starts in the opening status and QA decides the release (A-MIG-06).`);
    if (!itemKind || !v.locationCode || !v.itemCode || !v.qty || !v.countedBy || !v.checkedBy || !v.countSheetRef) return null;
    return {
      values: v,
      tier1Key: `${v.itemKind}:${v.itemCode}|${v.supplierLotNumber ?? ""}|${v.expiresOn ?? ""}|${v.locationCode}|${v.countSheetRef}|${new Decimal(v.qty).toFixed()}|${v.uom ?? ""}`,
      groupKey: lotKey(v),
    };
  },
  fileChecks(rows) {
    // §8 opening lot tier 2: the same item and supplier lot with a different expiry → separate lots, flagged for QA.
    const out = new Map<number, string[]>();
    const byLot = new Map<string, { rowNo: number; expiresOn: string | null }[]>();
    for (const r of rows) {
      if (!r.values.supplierLotNumber) continue;
      const k = `${r.values.itemKind}:${r.values.itemCode}|${r.values.supplierLotNumber}`;
      byLot.set(k, [...(byLot.get(k) ?? []), { rowNo: r.rowNo, expiresOn: r.values.expiresOn }]);
    }
    for (const list of byLot.values()) {
      const expiries = new Set(list.map((x) => x.expiresOn ?? "none"));
      if (expiries.size > 1) for (const x of list) out.set(x.rowNo, [`The same supplier lot appears with different expiry dates (${[...expiries].join(", ")}); separate lots are created and QA should check them.`]);
    }
    return out;
  },
  async findExisting(tx, ctx, job, rows) {
    // Re-running a corrected file never posts a line twice: an identical line already posted (and not reversed) is a tier 1 duplicate.
    const out = new Map<number, ExistingMatch>();
    const posted = await tx
      .select({
        id: openingBalanceLines.id,
        itemKind: openingBalanceLines.itemKind,
        materialCode: materials.code,
        productCode: products.skuCode,
        supplierLot: inventoryLots.supplierLotNumber,
        expiresOn: inventoryLots.expiresOn,
        locationCode: locations.code,
        countSheetRef: openingBalanceLines.countSheetRef,
        qtyEntered: openingBalanceLines.qtyEntered,
        uomEntered: openingBalanceLines.uomEntered,
        lotId: openingBalanceLines.lotId,
        lotNumber: inventoryLots.lotNumber,
      })
      .from(openingBalanceLines)
      .innerJoin(inventoryLots, eq(inventoryLots.id, openingBalanceLines.lotId))
      .innerJoin(locations, eq(locations.id, openingBalanceLines.locationId))
      .leftJoin(materials, eq(materials.id, openingBalanceLines.materialId))
      .leftJoin(products, eq(products.id, openingBalanceLines.productId))
      .where(and(eq(openingBalanceLines.organizationId, ctx.organizationId), eq(openingBalanceLines.siteId, job.siteId), isNull(openingBalanceLines.reversalMovementId)));
    const legacy = [...new Set(rows.map((r) => r.values.legacyNumber).filter((x): x is string => !!x))];
    const lotsWithLegacy = legacy.length
      ? await tx.select({ id: inventoryLots.id, lotNumber: inventoryLots.lotNumber, legacyNumber: inventoryLots.legacyNumber }).from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), inArray(inventoryLots.legacyNumber, legacy)))
      : [];
    for (const { rowNo, values: v } of rows) {
      const same = posted.find(
        (p) =>
          p.itemKind === v.itemKind &&
          (p.materialCode ?? p.productCode) === v.itemCode &&
          (p.supplierLot ?? null) === v.supplierLotNumber &&
          (p.expiresOn ?? null) === v.expiresOn &&
          p.locationCode === v.locationCode &&
          p.countSheetRef === v.countSheetRef &&
          new Decimal(p.qtyEntered).eq(v.qty) &&
          (v.uom === null || p.uomEntered === v.uom),
      );
      if (same) {
        out.set(rowNo, { tier: 1, entityType: "inventory_lot", entityId: same.lotId, label: same.lotNumber, message: `This count line was already posted as opening stock (lot ${same.lotNumber}); the row is skipped.` });
        continue;
      }
      const lot = v.legacyNumber ? lotsWithLegacy.find((l) => l.legacyNumber === v.legacyNumber) : undefined;
      if (lot) out.set(rowNo, { tier: 1, entityType: "inventory_lot", entityId: lot.id, label: lot.lotNumber, message: `Lot ${lot.lotNumber} already carries legacy number ${v.legacyNumber}; the row is skipped.` });
    }
    return out;
  },
  async create(k, v) {
    return postOpeningRow(k, v);
  },
  async voidPosted({ ctx, tx, job, reason }) {
    const lines = await tx
      .select()
      .from(openingBalanceLines)
      .where(and(eq(openingBalanceLines.importJobId, job.id), isNull(openingBalanceLines.reversalMovementId)))
      .orderBy(asc(openingBalanceLines.lotId), asc(openingBalanceLines.lineNo));
    const receipts = await tx.select().from(goodsReceipts).where(inArray(goodsReceipts.id, [...new Set(lines.map((l) => l.goodsReceiptId))].length ? [...new Set(lines.map((l) => l.goodsReceiptId))] : ["00000000-0000-0000-0000-000000000000"])).for("update");
    let reversed = 0;
    const boxes: string[] = [];
    for (const l of lines) {
      const gr = receipts.find((g) => g.id === l.goodsReceiptId)!;
      boxes.push(...(await voidBoxesForReversal(tx, ctx, { lotId: l.lotId, locationId: l.locationId, reason: `import_voided: ${reason}` })));
      try {
        const { movement } = await postMovement(tx, ctx, {
          movementType: "reversal",
          lotId: l.lotId,
          fromLocationId: l.locationId,
          qtyBase: l.qtyBase,
          sourceDocumentType: "goods_receipt",
          sourceDocumentId: gr.id,
          sourceDocumentNumber: gr.receiptNumber ?? undefined,
          reason: `import_voided: ${reason}`,
          reversalOfId: l.stockMovementId,
          correlationId: job.correlationId ?? undefined,
          idempotencyKey: `imp-void:${l.id}`,
          meta: { importJob: job.importNumber },
        });
        await tx.update(openingBalanceLines).set({ reversalMovementId: movement.id }).where(eq(openingBalanceLines.id, l.id));
        reversed++;
      } catch (e) {
        if (e instanceof DomainError && e.code === "insufficient_stock") {
          const [lot] = await tx.select({ lotNumber: inventoryLots.lotNumber }).from(inventoryLots).where(eq(inventoryLots.id, l.lotId));
          throw new DomainError("insufficient_stock", `Lot ${lot?.lotNumber ?? l.lotId} no longer has its opening quantity at its location. Move the stock back (or reverse the later movements) before voiding the import.`);
        }
        throw e;
      }
    }
    const now = new Date();
    for (const gr of receipts) {
      if (gr.status !== "posted") continue;
      await tx.update(goodsReceipts).set({ status: "reversed", reversedAt: now, reversedBy: ctx.userId, reversalReason: `import_voided: ${reason}`, updatedAt: now }).where(eq(goodsReceipts.id, gr.id));
      await audit(tx, ctx, { action: "procurement.goods_receipt.reversed", entityType: "goods_receipt", entityId: gr.id, entityNumber: gr.receiptNumber, siteId: gr.siteId, reason: `import_voided: ${reason}`, before: { status: "posted" }, after: { status: "reversed", importJob: job.importNumber } });
    }
    return { reversedLines: reversed, reversedReceipts: receipts.filter((r) => r.status === "posted").map((r) => r.receiptNumber), voidedBoxes: boxes.length };
  },
};

type StatusRules = { expiryRequiredClasses: string[]; supplierLotRequiredClasses: string[] };

/** A-MIG-06 opening status; pure so the rule table is unit-tested. */
export function openingStatus(input: { itemClass: string; expiresOn: string | null; supplierLotNumber: string | null; today: string }, rules: StatusRules): { status: "quarantine" | "on_hold" | "expired"; reasonCode: string | null; note: string | null } {
  if (input.expiresOn && input.expiresOn < input.today) return { status: "expired", reasonCode: null, note: `Expired on ${input.expiresOn} at the opening count.` };
  if (!input.expiresOn && rules.expiryRequiredClasses.includes(input.itemClass)) return { status: "on_hold", reasonCode: "expiry_unknown", note: "Expiry date unknown at the opening count." };
  if (!input.supplierLotNumber && rules.supplierLotRequiredClasses.includes(input.itemClass)) return { status: "on_hold", reasonCode: "documentation_issue", note: "Supplier lot number missing at the opening count." };
  return { status: "quarantine", reasonCode: null, note: null };
}

async function openingReceipt(k: CreateContext, warehouse: { id: string; code: string }) {
  const key = `gr:${warehouse.id}`;
  const cached = k.state.get(key) as typeof goodsReceipts.$inferSelect | undefined;
  if (cached) return cached;
  const idem = `imp:${k.job.id}:${warehouse.id}`;
  const [existing] = await k.tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.organizationId, k.ctx.organizationId), eq(goodsReceipts.idempotencyKey, idem))).limit(1);
  if (existing) {
    k.state.set(key, existing);
    return existing;
  }
  const receiptNumber = await nextNumber(k.tx, k.ctx.organizationId, "GR");
  const now = new Date();
  const [gr] = await k.tx
    .insert(goodsReceipts)
    .values({
      organizationId: k.ctx.organizationId,
      siteId: k.job.siteId,
      receiptNumber,
      receiptKind: "opening_balance",
      status: "posted",
      supplierId: null,
      supplierName: "Opening balance (data migration)",
      supplierDocumentNumber: k.job.importNumber,
      unplannedReasonCode: "opening_balance",
      receivedBy: k.ctx.userId,
      notes: `Opening stock of warehouse ${warehouse.code} loaded by import ${k.job.importNumber} (${k.job.fileName}).`,
      idempotencyKey: idem,
      correlationId: k.job.correlationId,
      postedAt: now,
      postedBy: k.ctx.userId,
      createdBy: k.ctx.userId,
    })
    .returning();
  await audit(k.tx, k.ctx, {
    action: "procurement.goods_receipt.posted",
    entityType: "goods_receipt",
    entityId: gr.id,
    entityNumber: receiptNumber,
    siteId: gr.siteId,
    after: { status: "posted", receiptKind: "opening_balance", warehouse: warehouse.code, importJob: k.job.importNumber },
  });
  k.state.set(key, gr);
  return gr;
}

async function postOpeningRow(k: CreateContext, v: OpeningValues) {
  const { tx, ctx, job } = k;
  const warnings: string[] = [];
  const [site] = await tx.select({ code: sites.code }).from(sites).where(eq(sites.id, job.siteId)).limit(1);
  if (v.siteCode && v.siteCode !== site.code) throw new DomainError("validation", `Site ${v.siteCode} is not the import's site ${site.code}. Load each site's count in its own import.`, { field: "site_code" });
  const [loc] = await tx.select().from(locations).where(and(eq(locations.siteId, job.siteId), eq(locations.code, v.locationCode))).limit(1);
  if (!loc) throw new DomainError("validation", `Location ${v.locationCode} does not exist at site ${site.code}.`, { field: "location_code" });
  if (loc.status !== "active") throw new DomainError("validation", `Location ${loc.code} is ${loc.status}.`, { field: "location_code" });
  if (NOT_FOR_OPENING.includes(loc.kind)) throw new DomainError("validation", `Location ${loc.code} is a ${loc.kind} location; opening stock is counted into storage, receiving, quarantine or hold locations.`, { field: "location_code" });
  const [wh] = await tx.select({ id: warehouses.id, code: warehouses.code }).from(warehouses).where(eq(warehouses.id, loc.warehouseId)).limit(1);
  if (v.warehouseCode && v.warehouseCode !== wh.code) throw new DomainError("validation", `Location ${loc.code} is in warehouse ${wh.code}, not ${v.warehouseCode}.`, { field: "warehouse_code" });

  let item: { id: string; code: string; baseUom: string; itemClass: string; unitsPerBox: number | null; materialId: string | null; productId: string | null };
  if (v.itemKind === "material") {
    const [m] = await tx.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.code, v.itemCode))).limit(1);
    if (!m) throw new DomainError("validation", `Material ${v.itemCode} does not exist. Import the materials first.`, { field: "item_code" });
    if (m.status !== "active") throw new DomainError("validation", `Material ${m.code} is ${m.status} in master data and cannot take stock.`, { field: "item_code" });
    item = { id: m.id, code: m.code, baseUom: m.baseUom, itemClass: m.materialKind, unitsPerBox: null, materialId: m.id, productId: null };
  } else {
    const [p] = await tx.select().from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.skuCode, v.itemCode))).limit(1);
    if (!p) throw new DomainError("validation", `Product ${v.itemCode} does not exist. Import the products first.`, { field: "item_code" });
    if (p.status === "discontinued") throw new DomainError("validation", `Product ${p.skuCode} is discontinued.`, { field: "item_code" });
    if (p.status === "draft") warnings.push(`Product ${p.skuCode} is still a draft in master data.`);
    item = { id: p.id, code: p.skuCode, baseUom: p.baseUom, itemClass: "product", unitsPerBox: p.unitsPerBox, materialId: null, productId: p.id };
  }
  let supplierName: string | null = null;
  if (v.supplierCode) {
    const [s] = await tx.select({ name: suppliers.name }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.code, v.supplierCode))).limit(1);
    if (!s) throw new DomainError("validation", `Supplier ${v.supplierCode} does not exist.`, { field: "supplier_code" });
    supplierName = s.name;
  }
  const enteredUom = v.uom ?? item.baseUom;
  const pair = await toBaseQuantity(tx, ctx.organizationId, { qty: v.qty, uom: enteredUom }, item.baseUom, item.materialId);
  const qtyBase = new Decimal(pair.base.qty);
  if (item.baseUom === "pcs" && !qtyBase.isInteger()) throw new DomainError("validation", `${item.code} is counted in pieces; the quantity must be a whole number of pieces.`, { field: "qty" });
  if (qtyBase.decimalPlaces() > 6) throw new DomainError("validation", "The quantity is finer than 0.000001 of the base unit.", { field: "qty" });

  const today = manilaToday();
  const rules = await getSetting(tx, ctx.organizationId, "imports.opening_stock.status_rules", job.siteId);
  const st = openingStatus({ itemClass: item.itemClass, expiresOn: v.expiresOn, supplierLotNumber: v.supplierLotNumber, today }, rules);
  if (v.retestOn && v.retestOn < today) warnings.push(`The retest date ${v.retestOn} has passed; QA should retest before release.`);

  const gr = await openingReceipt(k, wh);
  // One lot per lot key (§8); rows of one key are in the same chunk. A posted row of an earlier run keeps its lot.
  const groupKey = lotKey(v);
  const lotStateKey = `lot:${groupKey}`;
  let lot = k.state.get(lotStateKey) as typeof inventoryLots.$inferSelect | undefined;
  if (!lot) {
    const [prev] = await tx
      .select({ lotId: importJobRows.createdEntityId })
      .from(importJobRows)
      .where(and(eq(importJobRows.importJobId, job.id), eq(importJobRows.groupKey, groupKey), isNotNull(importJobRows.createdEntityId)))
      .limit(1);
    if (prev?.lotId) [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, prev.lotId)).limit(1);
  }
  if (lot) {
    const differs: string[] = [];
    if ((lot.materialId ?? lot.productId) !== item.id) differs.push("item");
    if ((lot.supplierLotNumber ?? null) !== v.supplierLotNumber) differs.push("supplier lot");
    if ((lot.expiresOn ?? null) !== v.expiresOn) differs.push("expiry");
    if (v.manufacturedOn && lot.manufacturedOn && lot.manufacturedOn !== v.manufacturedOn) differs.push("manufacture date");
    if (differs.length) throw new DomainError("validation", `This row belongs to lot ${lot.lotNumber} (same ${v.legacyNumber ? "legacy number" : "item, supplier lot and expiry"}) but its ${differs.join(", ")} differ. Correct the count sheet.`, { field: "legacy_number" });
  } else {
    const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
    [lot] = await tx
      .insert(inventoryLots)
      .values({
        organizationId: ctx.organizationId,
        siteId: job.siteId,
        lotNumber,
        itemKind: v.itemKind,
        materialId: item.materialId,
        productId: item.productId,
        supplierName,
        supplierLotNumber: v.supplierLotNumber,
        manufacturedOn: v.manufacturedOn,
        expiresOn: v.expiresOn,
        retestOn: v.retestOn,
        qualityStatus: st.status,
        baseUom: item.baseUom,
        legacyNumber: v.legacyNumber,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, {
      action: "inventory.inventory_lot.created",
      entityType: "inventory_lot",
      entityId: lot.id,
      entityNumber: lotNumber,
      siteId: job.siteId,
      reason: st.note,
      after: { source: "opening_balance", receiptNumber: gr.receiptNumber, importJob: job.importNumber, rowNo: k.row.rowNo, item: item.code, qualityStatus: st.status, holdReasonCode: st.reasonCode, legacyNumber: v.legacyNumber },
    });
    k.state.set(lotStateKey, lot);
  }
  if (st.status !== "quarantine") warnings.push(st.note!);

  const { movement } = await postMovement(tx, ctx, {
    movementType: "receipt",
    lotId: lot.id,
    toLocationId: loc.id,
    qtyBase,
    entered: { qty: pair.entered.qty, uom: pair.entered.uom },
    sourceDocumentType: "goods_receipt",
    sourceDocumentId: gr.id,
    sourceDocumentNumber: gr.receiptNumber ?? undefined,
    reason: "opening_balance",
    idempotencyKey: `imp:${k.row.id}`,
    correlationId: job.correlationId ?? undefined,
    meta: { importJob: job.importNumber, rowNo: k.row.rowNo, countSheetRef: v.countSheetRef },
  });

  // Containers (§7.10, A-MIG-07), quantities in the base unit.
  const ratio = qtyBase.div(new Decimal(v.qty));
  const boxes: { kind: string; qty: Decimal; partial: boolean }[] = [];
  if (v.containerCount || v.qtyPerContainer) {
    const per = v.qtyPerContainer ? new Decimal(v.qtyPerContainer).times(ratio) : qtyBase.div(v.containerCount!);
    const n = v.containerCount ?? qtyBase.div(per).toNumber();
    if (per.decimalPlaces() > 6) throw new DomainError("validation", "The quantity per container is finer than 0.000001 of the base unit.", { field: "qty_per_container" });
    for (let i = 0; i < n; i++) boxes.push({ kind: v.containerKind ?? "box", qty: per, partial: false });
  } else if (item.unitsPerBox && item.unitsPerBox > 0) {
    const full = qtyBase.div(item.unitsPerBox).floor().toNumber();
    const rest = qtyBase.minus(new Decimal(item.unitsPerBox).times(full));
    if (full > MAX_CONTAINERS_PER_ROW) throw new DomainError("validation", `More than ${MAX_CONTAINERS_PER_ROW} boxes in one row; split the row.`, { field: "qty" });
    for (let i = 0; i < full; i++) boxes.push({ kind: v.containerKind ?? "box", qty: new Decimal(item.unitsPerBox), partial: false });
    if (rest.gt(0)) boxes.push({ kind: "loose", qty: rest, partial: true });
  } else {
    warnings.push("No containers were counted for this row; label the lot (or record boxes later).");
  }
  if (boxes.length > MAX_CONTAINERS_PER_ROW) throw new DomainError("validation", `More than ${MAX_CONTAINERS_PER_ROW} containers in one row; split the row.`, { field: "container_count" });
  for (let i = 0; i < boxes.length; i++) {
    await createBox(ctx, { lotId: lot.id, locationId: loc.id, qty: boxes[i].qty.toFixed(), containerKind: boxes[i].kind, isPartial: boxes[i].partial, notes: `Opening count ${v.countSheetRef}`, idempotencyKey: `imp:${k.row.id}:${i}` }, { tx });
  }

  const [{ next }] = await tx.execute<{ next: number }>(sql`select coalesce(max(line_no), 0) + 1 as next from opening_balance_lines where goods_receipt_id = ${gr.id}`);
  await tx.insert(openingBalanceLines).values({
    organizationId: ctx.organizationId,
    siteId: job.siteId,
    goodsReceiptId: gr.id,
    importJobId: job.id,
    importJobRowId: k.row.id,
    lineNo: Number(next),
    itemKind: v.itemKind,
    materialId: item.materialId,
    productId: item.productId,
    lotId: lot.id,
    locationId: loc.id,
    qtyEntered: pair.entered.qty,
    uomEntered: pair.entered.uom,
    qtyBase: qtyBase.toFixed(),
    baseUom: item.baseUom,
    countSheetRef: v.countSheetRef,
    countedBy: v.countedBy,
    checkedBy: v.checkedBy,
    initialQualityStatus: st.status,
    holdReasonCode: st.reasonCode,
    holdReasonNote: st.status === "on_hold" ? st.note : null,
    qualityStatusClaimed: v.qualityStatusClaimed,
    containerCount: boxes.length,
    unitCost: v.unitCost,
    currency: v.currency,
    notes: v.notes,
    stockMovementId: movement.id,
    createdBy: ctx.userId,
  });
  return { entityType: "inventory_lot", entityId: lot.id, label: lot.lotNumber, hold: st.status !== "quarantine", warnings };
}
