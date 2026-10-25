import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { dispositions, forecastOverrides, goodsReceiptLines, inventoryLots, products, purchaseOrderLines, purchaseRequestLines, purchaseRequests, reorderSuggestions, supplierMaterialChanges } from "@/db/schema";
import { detectAll } from "@/modules/action-centre";
import { runReport } from "@/modules/reports";
import {
  FORECAST_BANNER,
  acceptReorderSuggestion,
  aslApprovalCandidates,
  computeReorderSuggestions,
  decideForecastOverride,
  dismissReorderSuggestion,
  forecastRows,
  forecastSeries,
  latePoCandidates,
  listReorderSuggestions,
  overDeliveryCandidates,
  poApprovalCandidates,
  receiveAgainstPurchaseOrder,
  saveReorderPolicy,
  submitForecastOverride,
  suggestQty,
  supplierMaterialsKind,
  supplierPerformance,
} from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { customMigration } from "../../support/custom-sql";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { clearOrgSetting, setOrgSetting } from "../sales/w3f-fixtures";
import { materialByCode, sentPo, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;
const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
const D = (xs: number[]) => xs.map((x) => new Decimal(x));

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  u = await w4aUsers(kit);
});

describe("US-6-04 reorder suggestions with drivers", () => {
  it("the documented method: projected = on hand − reserved − expiry risk + open supply; below minimum → min + safety − projected, raised to the MOQ", () => {
    expect(suggestQty({ onHand: 100, reserved: 20, expiryRisk: 10, openSupply: 0, minStock: 100, safetyStock: 50, moq: null }).qty?.toString()).toBe("80");
    expect(suggestQty({ onHand: 100, reserved: 20, expiryRisk: 10, openSupply: 0, minStock: 100, safetyStock: 50, moq: 500 }).qty?.toString()).toBe("500");
    expect(suggestQty({ onHand: 100, reserved: 0, expiryRisk: 0, openSupply: 50, minStock: 120, safetyStock: 0, moq: null }).qty).toBeNull();
  });

  it("computes suggestions per active policy with every driver and an explanation; nothing is ordered", async () => {
    const before = (await db.select().from(purchaseRequests)).length;
    const r = await computeReorderSuggestions(u.proc);
    expect(r.created).toBeGreaterThan(0);
    const rows = await listReorderSuggestions(u.proc);
    const wrap = rows.find((x) => x.materialCode === "PKG-0101")!;
    expect(wrap).toBeDefined();
    const projected = new Decimal(wrap.onHandBase!).minus(wrap.reservedBase!).minus(wrap.expiryRiskQtyBase!).plus(wrap.openPoQtyBase!);
    const expected = Decimal.max(new Decimal(wrap.minStockBase!).plus(wrap.safetyStockBase!).minus(projected), wrap.moqBase ?? 0);
    expect(new Decimal(wrap.suggestedQtyBase).toString()).toBe(expected.toString());
    expect(wrap.leadTimeDays).toBe(5);
    expect(wrap.supplierName).toBe("Manila Print & Pack");
    expect(wrap.explanation).toMatch(/Usable on hand .* reserved .* open POs and requests .* MOQ .* lead time 5 d .* no material forecast → suggest/);
    expect((await db.select().from(purchaseRequests)).length).toBe(before);
    // recomputing supersedes the open row (one open suggestion per material)
    await computeReorderSuggestions(u.proc);
    const open = await db.select().from(reorderSuggestions).where(and(eq(reorderSuggestions.materialId, wrap.materialId), eq(reorderSuggestions.status, "open")));
    expect(open).toHaveLength(1);
  });

  it("accepting creates a draft purchase request linked to the suggestion; dismissing needs a reason; others cannot decide", async () => {
    const rows = await listReorderSuggestions(u.proc);
    const wrap = rows.find((x) => x.materialCode === "PKG-0101")!;
    await expectCode(acceptReorderSuggestion(u.warehouse, { suggestionId: wrap.id }), "forbidden");
    expect((await listReorderSuggestions(await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]))).find((x) => x.id === wrap.id)).toBeUndefined();
    const a = await acceptReorderSuggestion(u.proc, { suggestionId: wrap.id, qty: "12000" });
    const [pr] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, a.requestId));
    expect(pr.status).toBe("draft");
    expect(pr.reorderSuggestionId).toBe(wrap.id);
    const [l] = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.purchaseRequestId, pr.id));
    expect(l.qtyBase).toBe("12000.000000");
    const [s] = await db.select().from(reorderSuggestions).where(eq(reorderSuggestions.id, wrap.id));
    expect(s.status).toBe("accepted");
    const other = rows.find((x) => x.materialCode !== "PKG-0101");
    if (other) {
      await expectCode(dismissReorderSuggestion(u.proc, { suggestionId: other.id, note: "" }), "validation");
      await dismissReorderSuggestion(u.proc, { suggestionId: other.id, note: "Production plan changed (fictional)." });
    }
    await expectCode(saveReorderPolicy(u.warehouse, { materialId: wrap.materialId, minStockBase: "1" }), "forbidden");
    const wrongSupplier = await supplierByName("Cebu Chemicals");
    await expectCode(saveReorderPolicy(u.proc, { materialId: wrap.materialId, minStockBase: "1", preferredSupplierId: wrongSupplier.id }), "validation");
  });
});

describe("US-6-04 supplier performance", () => {
  it("on time, in full and quality rejects from the records; no data is not 0 %", async () => {
    const po = await sentPo(u, [{ code: "MAT-0013", qty: "10" }], "Mindanao Palm Co.");
    const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    const qua = await loc(kit.nfd.id, "QUA-01");
    const r = await receiveAgainstPurchaseOrder(u.warehouse, { purchaseOrderId: po.id, supplierDocumentNumber: "MPC-DR-1", idempotencyKey: crypto.randomUUID(), intent: "post", lines: [{ purchaseOrderLineId: line.id, materialId: line.materialId, qty: "10", uom: "kg", supplierLotNumber: "MPC-L1", expiresOn: exp, locationId: qua.id, storageConditionsConfirmed: true }] });
    const [grl] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, grl.lotId!));
    await db.insert(dispositions).values({ organizationId: kit.orgId, siteId: kit.nfd.id, subjectType: "lot", subjectId: lot.id, decision: "reject", fromStatus: "quarantine", toStatus: "rejected", reason: "Fictional test rejection", decidedBy: u.qa.userId });
    const mpc = await supplierByName("Mindanao Palm Co.");
    const perf = await supplierPerformance(u.proc, { supplierId: mpc.id });
    const row = perf.rows.find((x) => x.supplierId === mpc.id)!;
    expect(row.receiptLines).toBe(1);
    expect(row.onTimePct).toBe("100.0");
    expect(row.inFullPct).toBe("100.0");
    expect(row.lotsRejected).toBe(1);
    expect(row.rejectPct).toBe(new Decimal(row.lotsRejected).div(row.lotsReceived).mul(100).toDecimalPlaces(1).toFixed(1));
    await expectCode(supplierPerformance(u.warehouse), "forbidden");
    const qaPerf = await supplierPerformance(u.qa);
    expect(qaPerf.rows.length).toBeGreaterThan(0);
    const rvs = await supplierPerformance(await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]), { supplierId: mpc.id });
    expect(rvs.rows).toHaveLength(0); // the NFD activity is not visible from RVS
  });
});

describe("US-6-20 forecast assumptions and overrides", () => {
  it("documented methods: insufficient history shows text and no number; method, metrics and band follow the sufficiency rules", () => {
    const short = forecastSeries(D([5, 6, 7]), 0.3);
    expect(short.sufficient).toBe(false);
    if (!short.sufficient) expect(short.text).toMatch(/^Insufficient history \(3 of 6 months needed\)$/);
    const eight = forecastSeries(D([100, 110, 90, 105, 95, 100, 102, 98]), 0.3);
    expect(eight.sufficient).toBe(true);
    if (eight.sufficient) {
      expect(["ma3", "ma6"]).toContain(eight.method);
      expect(eight.band).toBeNull();
      expect(eight.bandText).toBe("no confidence band: too little history");
      expect(eight.metrics.wape).not.toBeNull();
    }
    const year = forecastSeries(D([100, 120, 110, 130, 125, 140, 135, 150, 145, 160, 155, 170, 165, 180]), 0.3);
    if (year.sufficient) {
      expect(year.band).not.toBeNull();
      // empirical P10–P90 of the one-step residuals around the forecast (a trend leaves a biased band)
      expect(Number(year.band!.p10)).toBeLessThanOrEqual(Number(year.band!.p90));
      expect(year.metrics.bias).not.toBeNull();
    } else throw new Error("expected a forecast");
    const intermittent = forecastSeries(D([0, 0, 5, 0, 0, 0, 7, 0]), 0.3);
    if (intermittent.sufficient) expect(intermittent.intermittent).toBe(true);
  });

  it("the page data carries the estimate banner; a SKU without enough history has no number", async () => {
    const f = await forecastRows(u.planner);
    expect(f.banner).toBe(FORECAST_BANNER);
    expect(FORECAST_BANNER).toBe("Forecasts are estimates, not actuals.");
    for (const r of f.rows) if (!r.forecast.sufficient) expect("next" in r.forecast).toBe(false);
    await expectCode(forecastRows(u.qa), "forbidden");
    await expectCode(forecastRows(u.admin), "forbidden");
  });

  it("authz.sod.approve_own (forecast_override): stays submitted until a different user approves; the baseline stays", async () => {
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const now = new Date();
    const next = new Date(Date.UTC(Number(now.toISOString().slice(0, 4)), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    await expectCode(submitForecastOverride(u.warehouse, { siteId: kit.nfd.id, productId: acs.id, periodStart: next, overrideQty: "100", reason: "Promotion" }), "forbidden");
    await expectCode(submitForecastOverride(u.manager, { siteId: kit.rvs.id, productId: acs.id, periodStart: next, overrideQty: "100", reason: "Promotion" }), "not_found");
    await expectCode(submitForecastOverride(u.manager, { siteId: kit.nfd.id, productId: acs.id, periodStart: next, overrideQty: "100", reason: "" }), "validation");
    await expectCode(submitForecastOverride(u.manager, { siteId: kit.nfd.id, productId: acs.id, periodStart: "2020-01-01", overrideQty: "100", reason: "Too old a month" }), "validation");
    const o = await submitForecastOverride(u.manager, { siteId: kit.nfd.id, productId: acs.id, periodStart: next, overrideQty: "1200", reason: "Retailer promotion (fictional)." });
    const [row] = await db.select().from(forecastOverrides).where(eq(forecastOverrides.id, o.overrideId));
    expect(row.status).toBe("submitted");
    await expectCode(decideForecastOverride(u.manager, { overrideId: o.overrideId, decision: "approved" }), "separation_of_duties");
    await expectCode(decideForecastOverride(u.planner, { overrideId: o.overrideId, decision: "approved" }), "forbidden");
    const other = await asUser(kit, "checker.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    await decideForecastOverride(other, { overrideId: o.overrideId, decision: "approved" });
    // the setting can switch SoD off for this record type (A-PM-14 default on)
    await setOrgSetting(kit.orgId, "approvals.sod.forecast_override", false);
    const o2 = await submitForecastOverride(u.manager, { siteId: kit.nfd.id, productId: acs.id, periodStart: next, overrideQty: "1300", reason: "Updated promotion volume (fictional)." });
    await decideForecastOverride(u.manager, { overrideId: o2.overrideId, decision: "approved" });
    await clearOrgSetting(kit.orgId, "approvals.sod.forecast_override");
    const all = await db.select().from(forecastOverrides).where(and(eq(forecastOverrides.productId, acs.id), eq(forecastOverrides.periodStart, next)));
    expect(all.find((x) => x.id === o.overrideId)?.status).toBe("retired");
    expect(all.find((x) => x.id === o2.overrideId)?.status).toBe("approved");
  });
});

describe("W4A wiring: action centre, import kind, custom SQL", () => {
  it("action-centre sources: POs to approve, late POs, ASL proposals, over-deliveries", async () => {
    expect((await poApprovalCandidates(kit.orgId)).length).toBeGreaterThan(0);
    const late = await latePoCandidates(kit.orgId, new Date());
    expect(late.some((c) => /is late/.test(c.title))).toBe(true);
    expect((await aslApprovalCandidates(kit.orgId)).some((c) => c.recordNumber?.includes("MAT-0060"))).toBe(true);
    expect(await overDeliveryCandidates(kit.orgId)).toHaveLength(0);
    const all = await detectAll(kit.orgId, new Date());
    expect(all.some((c) => c.kind === "approval.purchase_order")).toBe(true);
    expect(all.some((c) => c.kind === "late_purchase_order")).toBe(true);
  });

  it("supplier_materials import kind creates an approved-list proposal for QA, never an approval", async () => {
    const s = await supplierByName("Mindanao Palm Co.");
    const m = await materialByCode("MAT-0061");
    const created = await db.transaction(async (tx: Tx) =>
      supplierMaterialsKind.create({ ctx: u.proc, tx, job: {} as never, row: { id: crypto.randomUUID(), rowNo: 1 }, dryRun: false, state: new Map() }, { supplierCode: s.code, materialCode: m.code, supplierPartNumber: "MPC-GLY", leadTimeDays: 12, moqQty: "50", moqUom: "kg", unitPrice: "99", priceUom: "kg", currency: "PHP", priceEffectiveFrom: null, note: "Fictional: second glycerin source." }),
    );
    const [c] = await db.select().from(supplierMaterialChanges).where(and(eq(supplierMaterialChanges.supplierMaterialId, created.entityId), eq(supplierMaterialChanges.status, "pending")));
    expect(c.proposedBy).toBe(u.proc.userId);
  });

  it("procurement reports: open PO lines (no prices) and supplier performance, site-scoped", async () => {
    const open = await runReport(u.proc, "RPT-PRO-OPEN-PO", { late: "late" });
    expect(open.rows.length).toBeGreaterThan(0);
    expect(open.rows.every((r) => r.late === "yes")).toBe(true);
    expect(open.columns.map((c) => c.key)).not.toContain("unitAmount");
    const perf = await runReport(u.proc, "RPT-PRO-SUPPLIER", {});
    expect(perf.valueLabel).toBe("Actual");
    await expectCode(runReport(u.warehouse, "RPT-PRO-SUPPLIER", {}), "forbidden");
  });

  it("custom SQL w4a is shipped verbatim as its migration", () => {
    const { migration, canonical } = customMigration("w4a");
    expect(migration.trim().endsWith(canonical.trim())).toBe(true);
  });
});
