/**
 * Wave 3 W3A demo seed: a month of fictional operations so the KPI dashboards and trends mean
 * something in the demo (US-5-01..03, US-5-16). Everything is fictional (customers, suppliers and lot
 * numbers of the base seed; numbers below carry an "M" series so they never collide with documents
 * the numbering service allocates later).
 *
 * Per working day at North Fields (NFD): a work order with its batch (dispensing, steps, output,
 * yield record, finished-product inspection, QA decision), goods receipts every third day (incoming
 * inspection for coconut oil, releases, a few discrepancies), sales orders at both sites with
 * shipments (most on time, some late, some short, some still open), quality holds, deviations and a
 * few open action-centre items. Stock moves only through ledger rows plus the matching balance
 * projection update, so inventory.reconcile stays clean.
 *
 * `seedW3a(db, { endDate })` covers the 30 days before `endDate` (exclusive). No event is dated after
 * `now`. With `backfill` it also computes the nightly KPI snapshots for every day of the window
 * through the real engine (src/modules/analytics/kpi/engine.ts), so trends have points at once.
 */
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { computeSnapshots } from "../../modules/analytics/kpi/engine";
import { addDays, localDate, zonedStart } from "../../modules/analytics/kpi/time";

type Db = PostgresJsDatabase<typeof s>;

const TZ = "Asia/Manila";

/** Deterministic PRNG (mulberry32) so a given window always produces the same month. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type W3aSeedOptions = {
  /** Exclusive end of the 30-day window (YYYY-MM-DD, Manila). Default: tomorrow, so today is included. */
  endDate?: string;
  /** Events after this instant are not created. Default: now. */
  now?: Date;
  /** Compute the nightly KPI snapshots for each day of the window (demo). */
  backfill?: boolean;
  days?: number;
};

export async function seedW3a(db: Db, opts: W3aSeedOptions = {}) {
  const now = opts.now ?? new Date();
  const endDate = opts.endDate ?? addDays(localDate(now, TZ), 1);
  const DAYS = opts.days ?? 30;
  const startDate = addDays(endDate, -DAYS);
  const cap = new Date(Math.min(zonedStart(endDate, TZ).getTime(), now.getTime()));
  const series = endDate.slice(2, 4) + endDate.slice(5, 7);
  const rand = rng(Number(endDate.replace(/-/g, "")));
  const at = (date: string, hour: number, minute = 0) => new Date(zonedStart(date, TZ).getTime() + (hour * 60 + minute) * 60_000);
  const ok = (t: Date) => t.getTime() <= cap.getTime();

  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return { skipped: true };
  const O = org.id;
  const siteRows = await db.select().from(s.sites).where(eq(s.sites.organizationId, O));
  const NFD = siteRows.find((x) => x.code === "NFD");
  const RVS = siteRows.find((x) => x.code === "RVS");
  if (!NFD || !RVS) return { skipped: true };
  const userRows = await db.select({ id: s.users.id, email: s.users.email }).from(s.users).where(eq(s.users.organizationId, O));
  const U = (email: string) => {
    const u = userRows.find((x) => x.email === email);
    if (!u) throw new Error(`W3A seed: user ${email} missing`);
    return u.id;
  };
  const owner = U("owner@bryels-care.test");
  const manager = U("manager.nfd@bryels-care.test");
  const operator = U("operator.nfd@bryels-care.test");
  const checker = U("checker.nfd@bryels-care.test");
  const whN = U("warehouse.nfd@bryels-care.test");
  const whR = U("warehouse.rvs@bryels-care.test");
  const qa = U("qa.nfd@bryels-care.test");
  const qa2 = userRows.find((x) => x.email === "qa.lead@bryels-care.test")?.id ?? manager;
  const salesUser = U("sales@bryels-care.test");

  const locRows = await db.select().from(s.locations);
  const L = (siteId: string, code: string) => {
    const l = locRows.find((x) => x.siteId === siteId && x.code === code);
    if (!l) throw new Error(`W3A seed: location ${code} missing`);
    return l.id;
  };
  const productRows = await db.select().from(s.products).where(eq(s.products.organizationId, O));
  const P = (sku: string) => productRows.find((x) => x.skuCode === sku)!;
  const materialRows = await db.select().from(s.materials).where(eq(s.materials.organizationId, O));
  const M = (code: string) => materialRows.find((x) => x.code === code)!;
  const customerRows = await db.select().from(s.customers).where(eq(s.customers.organizationId, O));
  const [soapLine] = await db.select().from(s.productionLines).where(and(eq(s.productionLines.siteId, NFD.id), eq(s.productionLines.code, "SOAP-1"))).limit(1);

  // Template batches of the base seed carry the frozen snapshot, formula and routing revisions per product.
  const templates = new Map<string, typeof s.batches.$inferSelect>();
  for (const sku of ["ACS-135", "GBS-135"]) {
    const [b] = await db.select().from(s.batches).where(eq(s.batches.productId, P(sku).id)).limit(1);
    if (b) templates.set(sku, b);
  }
  if (templates.size < 2) return { skipped: true };
  const formulaOf = new Map<string, { formulaId: string }>();
  for (const [sku, b] of templates) {
    const [fr] = await db.select({ formulaId: s.formulaRevisions.formulaId }).from(s.formulaRevisions).where(eq(s.formulaRevisions.id, b.formulaRevisionId)).limit(1);
    formulaOf.set(sku, fr);
  }
  const plans = await db.select().from(s.inspectionPlans).where(and(eq(s.inspectionPlans.organizationId, O), eq(s.inspectionPlans.status, "approved")));
  const planTests = await db.select().from(s.inspectionPlanTests);
  const fpPlan = (productId: string) => plans.find((p) => p.planKind === "finished_product" && p.productId === productId);
  const inPlan = (materialId: string) => plans.find((p) => p.planKind === "incoming" && p.materialId === materialId);
  const routingSteps = new Map<string, (typeof s.routingSteps.$inferSelect)[]>();
  for (const [sku, b] of templates) routingSteps.set(sku, await db.select().from(s.routingSteps).where(eq(s.routingSteps.routingRevisionId, b.routingRevisionId)).orderBy(s.routingSteps.stepNo));

  const seq: Record<string, number> = {};
  const num = (prefix: string, width = 3) => {
    seq[prefix] = (seq[prefix] ?? 0) + 1;
    return `${prefix}-${series}-${String(seq[prefix]).padStart(width, "0")}`;
  };

  // ---------------------------------------------------------------- ledger helpers
  const balance = async (siteId: string, lotId: string, locationId: string, delta: Decimal) => {
    if (delta.isNegative()) {
      const out = await db
        .update(s.inventoryBalances)
        .set({ qtyBase: sql`${s.inventoryBalances.qtyBase} - ${delta.abs().toString()}` })
        .where(and(eq(s.inventoryBalances.lotId, lotId), eq(s.inventoryBalances.locationId, locationId)))
        .returning({ id: s.inventoryBalances.id });
      if (out.length !== 1) throw new Error("W3A seed: moving stock that is not there");
      return;
    }
    await db
      .insert(s.inventoryBalances)
      .values({ siteId, lotId, locationId, qtyBase: delta.toString() })
      .onConflictDoUpdate({ target: [s.inventoryBalances.lotId, s.inventoryBalances.locationId], set: { qtyBase: sql`${s.inventoryBalances.qtyBase} + ${delta.toString()}` } });
  };
  const move = async (m: { siteId: string; type: string; lotId: string; from?: string; to?: string; qty: Decimal; uom: string; doc: [string, string | null, string]; by: string; when: Date; reason?: string; status?: string }) => {
    if (m.from) await balance(m.siteId, m.lotId, m.from, m.qty.neg());
    if (m.to) await balance(m.siteId, m.lotId, m.to, m.qty);
    const [row] = await db
      .insert(s.stockMovements)
      .values({
        organizationId: O,
        siteId: m.siteId,
        movementType: m.type,
        lotId: m.lotId,
        fromLocationId: m.from ?? null,
        toLocationId: m.to ?? null,
        qtyBase: m.qty.toString(),
        baseUom: m.uom,
        qualityStatusAtPosting: m.status ?? null,
        sourceDocumentType: m.doc[0],
        sourceDocumentId: m.doc[1],
        sourceDocumentNumber: m.doc[2],
        reason: m.reason ?? null,
        postedBy: m.by,
        postedAt: m.when,
      })
      .returning({ id: s.stockMovements.id });
    return row.id;
  };
  const disposition = (siteId: string, subjectType: "lot" | "batch", subjectId: string, decision: string, fromStatus: string, toStatus: string, when: Date, by: string, reason: string, inspectionId?: string) =>
    db.insert(s.dispositions).values({ organizationId: O, siteId, subjectType, subjectId, decision, fromStatus, toStatus, reason, decidedBy: by, decidedAt: when, inspectionId: inspectionId ?? null });
  const audit = (action: string, entityType: string, entityId: string, entityNumber: string, actor: string, siteId: string | null, when: Date) =>
    db.insert(s.auditEvents).values({ organizationId: O, siteId, actorId: actor, action, entityType, entityId, entityNumber, occurredAt: when });

  // ---------------------------------------------------------------- opening finished-goods stock
  const openingAt = at(startDate, 6);
  const fgLots: Record<string, string> = {};
  for (const [site, sku, qty] of [
    [NFD, "ACS-135", 6000],
    [NFD, "GBS-135", 6000],
    [RVS, "ACS-135", 5000],
    [RVS, "AHL-250", 5000],
  ] as const) {
    const pr = P(sku);
    const [lot] = await db
      .insert(s.inventoryLots)
      .values({ organizationId: O, siteId: site.id, lotNumber: num("LM", 4), itemKind: "product", productId: pr.id, manufacturedOn: addDays(startDate, -20), expiresOn: addDays(startDate, pr.shelfLifeDays - 20), qualityStatus: "released", baseUom: "pcs", createdBy: site.id === NFD.id ? whN : whR, createdAt: openingAt })
      .returning();
    await move({ siteId: site.id, type: "receipt", lotId: lot.id, to: L(site.id, "FG-01"), qty: new Decimal(qty), uom: "pcs", doc: ["opening_balance", null, "Opening stock (demo month)"], by: site.id === NFD.id ? whN : whR, when: openingAt, reason: "Opening balance (demo)", status: "released" });
    fgLots[`${site.code}:${sku}`] = lot.id;
  }

  // ---------------------------------------------------------------- receipts (NFD, every third day)
  const receiptMaterials = ["MAT-0012", "MAT-0013", "MAT-0061", "MAT-0043"];
  const heldCandidates: { lotId: string; number: string; at: Date }[] = [];
  for (let i = 0; i < DAYS; i += 3) {
    const date = addDays(startDate, i);
    const receivedAt = at(date, 8, 30);
    if (!ok(receivedAt)) break;
    const grNo = num("GRM");
    const supplier = i % 2 === 0 ? "Laguna Oleo Supply" : "Cebu Chemicals";
    const [gr] = await db
      .insert(s.goodsReceipts)
      .values({ organizationId: O, siteId: NFD.id, receiptNumber: grNo, status: "posted", supplierName: supplier, supplierDocumentNumber: `DR-M${i + 100}`, receivedBy: whN, receivedAt, postedAt: receivedAt, postedBy: whN, createdBy: whN, createdAt: receivedAt })
      .returning();
    const lines = [receiptMaterials[i % 4], receiptMaterials[(i + 1) % 4]];
    for (const [li, code] of lines.entries()) {
      const m = M(code);
      const qty = new Decimal(code === "MAT-0043" ? 2000 : 20000 + Math.round(rand() * 4) * 5000);
      // A few lots expire soon (FEFO risk) and one is past expiry by the end of the window.
      const expiresOn = i === 3 && li === 1 ? addDays(endDate, -3) : i === 6 && li === 0 ? addDays(endDate, 12) : i === 12 && li === 1 ? addDays(endDate, 24) : addDays(date, 365);
      const [lot] = await db
        .insert(s.inventoryLots)
        .values({ organizationId: O, siteId: NFD.id, lotNumber: num("LM", 4), itemKind: "material", materialId: m.id, supplierName: supplier, supplierLotNumber: `SL-${series}-${i}${li}`, manufacturedOn: addDays(date, -10), expiresOn, qualityStatus: "quarantine", baseUom: m.baseUom, createdBy: whN, createdAt: receivedAt })
        .returning();
      const discrepancy = (i + li) % 7 === 4 ? "short" : (i + li) % 11 === 5 ? "damaged" : null;
      const mv = await move({ siteId: NFD.id, type: "receipt", lotId: lot.id, to: L(NFD.id, "QUA-01"), qty, uom: m.baseUom, doc: ["goods_receipt", gr.id, grNo], by: whN, when: receivedAt, status: "quarantine" });
      await db.insert(s.goodsReceiptLines).values({
        goodsReceiptId: gr.id,
        lineNo: li + 1,
        lotId: lot.id,
        materialId: m.id,
        qtyBase: qty.toString(),
        locationId: L(NFD.id, "QUA-01"),
        supplierLotNumber: lot.supplierLotNumber,
        expiresOn,
        discrepancyKind: discrepancy,
        discrepancyNote: discrepancy ? (discrepancy === "short" ? "Two drums fewer than the delivery note." : "One drum dented, contents intact.") : null,
        discrepancyRecordedBy: discrepancy ? whN : null,
        discrepancyRecordedAt: discrepancy ? receivedAt : null,
        stockMovementId: mv,
        createdBy: whN,
        createdAt: receivedAt,
      });
      // Release after 1–3 days (incoming inspection for materials with a plan).
      const releaseAt = at(addDays(date, 1 + ((i + li) % 3)), 11, 15);
      if (!ok(releaseAt)) continue;
      const plan = inPlan(m.id);
      let inspectionId: string | undefined;
      if (plan) {
        const sampledAt = at(addDays(date, 1), 9);
        const [insp] = await db
          .insert(s.inspections)
          .values({ organizationId: O, siteId: NFD.id, inspectionNumber: num("INM"), status: "approved", inspectionKind: "incoming", inspectionPlanId: plan.id, lotId: lot.id, sampledAt, sampledBy: qa2, performedBy: qa2, reviewedBy: qa, reviewedAt: releaseAt, outcome: "pass", createdBy: whN, createdAt: receivedAt, statusChangedAt: releaseAt, statusChangedBy: qa })
          .returning();
        inspectionId = insp.id;
        await db.insert(s.inspectionStateTransitions).values([
          { organizationId: O, siteId: NFD.id, inspectionId: insp.id, fromState: null, toState: "pending", actorId: whN, occurredAt: receivedAt },
          { organizationId: O, siteId: NFD.id, inspectionId: insp.id, fromState: "pending", toState: "in_progress", actorId: qa2, occurredAt: sampledAt },
          { organizationId: O, siteId: NFD.id, inspectionId: insp.id, fromState: "in_progress", toState: "awaiting_review", actorId: qa2, occurredAt: new Date(sampledAt.getTime() + 3600_000) },
          { organizationId: O, siteId: NFD.id, inspectionId: insp.id, fromState: "awaiting_review", toState: "approved", actorId: qa, occurredAt: releaseAt },
        ]);
        for (const t of planTests.filter((t) => t.inspectionPlanId === plan.id))
          await db.insert(s.testResults).values({ testName: t.name, specification: t.specText ?? "Conforms", result: "Conforms", passed: true, valuePass: true, testedBy: qa2, testedAt: new Date(sampledAt.getTime() + 1800_000), inspectionId: insp.id, inspectionPlanTestId: t.id, testCode: t.testCode });
      }
      await disposition(NFD.id, "lot", lot.id, "release", "quarantine", "released", releaseAt, qa, "Incoming check: CoA reviewed, appearance conforms.", inspectionId);
      await db.update(s.inventoryLots).set({ qualityStatus: "released" }).where(eq(s.inventoryLots.id, lot.id));
      await move({ siteId: NFD.id, type: "transfer", lotId: lot.id, from: L(NFD.id, "QUA-01"), to: L(NFD.id, code === "MAT-0043" || code === "MAT-0061" ? "B-01" : "A-01"), qty, uom: m.baseUom, doc: ["putaway", gr.id, grNo], by: whN, when: new Date(releaseAt.getTime() + 1800_000), status: "released" });
      if (code === "MAT-0061" || code === "MAT-0013") heldCandidates.push({ lotId: lot.id, number: lot.lotNumber, at: releaseAt });
    }
    await audit("inventory.goods_receipt.posted", "goods_receipt", gr.id, grNo, whN, NFD.id, receivedAt);
  }

  // ---------------------------------------------------------------- production (NFD, Monday to Saturday)
  const deviationRows: { id: string; number: string; raisedAt: Date }[] = [];
  const raiseDeviation = async (v: { batchId: string; source: string; severity: string; description: string; raisedAt: Date; closeAfterDays: number | null; dispenseRecordId?: string }) => {
    const closedAt = v.closeAfterDays === null ? null : new Date(v.raisedAt.getTime() + v.closeAfterDays * 86_400_000);
    const closed = closedAt !== null && ok(closedAt);
    const number = num("DVM");
    const [d] = await db
      .insert(s.deviations)
      .values({
        organizationId: O,
        siteId: NFD.id,
        deviationNumber: number,
        status: closed ? "closed" : "investigating",
        source: v.source,
        severity: v.severity,
        description: v.description,
        batchId: v.batchId,
        dispenseRecordId: v.dispenseRecordId ?? null,
        raisedBy: operator,
        raisedAt: v.raisedAt,
        classifiedBy: qa,
        classifiedAt: new Date(v.raisedAt.getTime() + 2 * 3600_000),
        investigation: "Reviewed batch record and equipment log.",
        rootCause: closed ? "Operator read the wrong scale display; retrained." : null,
        resolution: closed ? "Corrected weighing accepted under CX-TOL; no product impact." : null,
        releasePermitted: closed ? true : null,
        closedBy: closed ? qa : null,
        closedAt: closed ? closedAt : null,
        statusChangedAt: closed ? closedAt! : v.raisedAt,
        statusChangedBy: closed ? qa : operator,
        createdAt: v.raisedAt,
      })
      .returning();
    deviationRows.push({ id: d.id, number, raisedAt: v.raisedAt });
    return d;
  };

  const executed: { batchId: string; sku: string; lotId: string; units: number; outputAt: Date }[] = [];
  for (let i = 0; i < DAYS + 6; i++) {
    const date = addDays(startDate, i);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 0) continue;
    const sku = i % 3 === 2 ? "GBS-135" : "ACS-135";
    const pr = P(sku);
    const tpl = templates.get(sku)!;
    const createdAt = at(addDays(date, -3), 9);
    if (!ok(createdAt)) break;
    const woNo = num("WOM");
    const late = i === DAYS - 6; // released but never run: late at the end of the window
    const startAt = at(date, 8);
    const doneAt = at(date, 17, 30);
    const runs = !late && ok(startAt);
    const completed = runs && ok(doneAt);
    const plannedAt = at(addDays(date, -2), 10);
    const releasedAt = at(addDays(date, -1), 14);
    const status = completed ? "completed" : runs ? "in_progress" : ok(releasedAt) ? "released" : ok(plannedAt) ? "planned" : "draft";
    const [wo] = await db
      .insert(s.workOrders)
      .values({
        organizationId: O,
        siteId: NFD.id,
        workOrderNumber: woNo,
        status,
        productId: pr.id,
        formulaId: formulaOf.get(sku)!.formulaId,
        formulaRevisionId: tpl.formulaRevisionId,
        routingRevisionId: tpl.routingRevisionId,
        productionLineId: soapLine?.id ?? null,
        qtyPlannedBase: "17600",
        baseUom: "g",
        batchCount: 1,
        batchSizeBase: "17600",
        targetUnits: "124",
        plannedStart: date,
        plannedEnd: date,
        approvedBy: ok(releasedAt) ? manager : null,
        approvedAt: ok(releasedAt) ? releasedAt : null,
        statusChangedAt: createdAt,
        statusChangedBy: manager,
        createdBy: manager,
        createdAt,
        updatedBy: manager,
        updatedAt: createdAt,
      })
      .returning();
    const corr = wo.id;
    const tr = [
      { fromState: null, toState: "draft", at: createdAt },
      { fromState: "draft", toState: "planned", at: plannedAt },
      { fromState: "planned", toState: "released", at: releasedAt },
      { fromState: "released", toState: "in_progress", at: startAt },
      { fromState: "in_progress", toState: "completed", at: doneAt },
    ].filter((t, k) => ok(t.at) && (k < 3 || runs) && (k < 4 || completed));
    await db.insert(s.workOrderStateTransitions).values(tr.map((t) => ({ organizationId: O, siteId: NFD.id, workOrderId: wo.id, fromState: t.fromState, toState: t.toState, actorId: manager, occurredAt: t.at, correlationId: corr })));
    if (!runs) continue;

    // Batch
    const batchNo = num("BM", 4);
    const batchCreated = at(addDays(date, -1), 15);
    const units = i === 9 ? 110 : 118 + Math.floor(rand() * 9);
    const fpInspection = fpPlan(pr.id);
    const failQc = i === 15;
    const outputAt = at(date, 17);
    const sampledAt = at(addDays(date, 1), 9);
    const reviewedAt = at(addDays(date, 1), 13 + (i % 4));
    const reviewed = completed && ok(reviewedAt);
    const bStatus = !completed ? "in_process" : reviewed ? (failQc ? "rejected" : "released") : "awaiting_qc";
    const theo = new Decimal(17600).mul(95).div(100);
    const actualG = new Decimal(units).mul(pr.unitNetMassG);
    const [b] = await db
      .insert(s.batches)
      .values({
        organizationId: O,
        siteId: NFD.id,
        batchNumber: batchNo,
        productId: pr.id,
        formulaRevisionId: tpl.formulaRevisionId,
        routingRevisionId: tpl.routingRevisionId,
        inspectionPlanId: fpInspection?.id ?? null,
        formulaSnapshot: tpl.formulaSnapshot,
        plannedSizeG: "17600",
        status: bStatus,
        plannedStartOn: date,
        startedAt: startAt,
        completedAt: completed ? outputAt : null,
        actualOutputG: completed ? actualG.toString() : null,
        actualUnits: completed ? String(units) : null,
        theoreticalYieldG: theo.toString(),
        yieldPct: completed ? actualG.div(theo).mul(100).toDecimalPlaces(2).toString() : null,
        workOrderId: wo.id,
        createdBy: manager,
        createdAt: batchCreated,
      })
      .returning();
    const path: [string | null, string, Date, string][] = [
      [null, "planned", batchCreated, manager],
      ["planned", "materials_staged", at(date, 7, 30), operator],
      ["materials_staged", "in_process", startAt, operator],
    ];
    if (completed) path.push(["in_process", "awaiting_qc", outputAt, operator]);
    if (reviewed) path.push(["awaiting_qc", failQc ? "rejected" : "released", reviewedAt, qa]);
    await db.insert(s.batchStateTransitions).values(path.map(([f, t, when, actor]) => ({ batchId: b.id, fromState: f, toState: t, actorId: actor, at: when })));

    // Dispensing: one weighing per BOM line from the snapshot; one batch per month needs a CX-TOL exception.
    const snapshot = tpl.formulaSnapshot as { lines?: { bomLineId: string; lineNo: number; materialId: string; quantityG: string; tolerancePct: string }[] };
    let lineNo = 0;
    for (const line of snapshot.lines ?? []) {
      lineNo += 1;
      const [bm] = await db
        .insert(s.batchMaterials)
        .values({ batchId: b.id, bomLineId: line.bomLineId, lineNo: line.lineNo, materialId: line.materialId, theoreticalQtyG: line.quantityG, tolerancePct: line.tolerancePct ?? "0.5", dispensedQtyG: line.quantityG, status: "dispensed" })
        .returning();
      const [srcLot] = await db.select({ lotId: s.inventoryBalances.lotId, locationId: s.inventoryBalances.locationId }).from(s.inventoryBalances).innerJoin(s.inventoryLots, eq(s.inventoryLots.id, s.inventoryBalances.lotId)).where(eq(s.inventoryLots.materialId, line.materialId)).limit(1);
      if (!srcLot) continue;
      const outside = i === 4 && lineNo === 1;
      const qty = new Decimal(line.quantityG).mul(outside ? 1.012 : 1 + ((lineNo % 3) - 1) * 0.0008).toDecimalPlaces(1);
      const [dr] = await db
        .insert(s.dispenseRecords)
        .values({
          batchMaterialId: bm.id,
          lotId: srcLot.lotId,
          fromLocationId: srcLot.locationId,
          actualQtyG: qty.toString(),
          isWithinTolerance: !outside,
          scaleCode: "SC-01",
          operatorId: operator,
          checkerId: checker,
          checkedAt: at(date, 8, 10 + lineNo),
          exceptionApprovedBy: outside ? qa : null,
          exceptionReason: outside ? "Over by 1.2 %; QA accepted, no effect on the saponification ratio." : null,
          recordedAt: at(date, 8, 5 + lineNo),
        })
        .returning();
      if (outside) await raiseDeviation({ batchId: b.id, source: "cx_tol", severity: "minor", description: `Weighing above tolerance on line ${lineNo}.`, raisedAt: at(date, 8, 30), closeAfterDays: 4, dispenseRecordId: dr.id });
    }

    // Process steps
    const steps = routingSteps.get(sku) ?? [];
    for (const [k, st] of steps.entries()) {
      const started = at(date, 8, 30 + k * 50);
      const completedStep = new Date(started.getTime() + (35 + Math.floor(rand() * 20)) * 60_000);
      if (!ok(completedStep) || (!completed && k >= 3)) break;
      await db.insert(s.processStepRecords).values({
        batchId: b.id,
        routingStepId: st.id,
        stepNo: st.stepNo,
        name: st.name,
        stepKind: st.stepKind,
        area: st.area,
        status: "completed",
        conductedBy: operator,
        checkedBy: checker,
        checkedAt: completedStep,
        startedAt: started,
        performedAt: completedStep,
        completedAt: completedStep,
      });
    }
    if (!completed) continue;

    // Output, yield
    const [lot] = await db
      .insert(s.inventoryLots)
      .values({ organizationId: O, siteId: NFD.id, lotNumber: num("LM", 4), itemKind: "product", productId: pr.id, manufacturedOn: date, expiresOn: addDays(date, pr.shelfLifeDays), qualityStatus: reviewed ? (failQc ? "rejected" : "released") : "quarantine", sourceBatchId: b.id, baseUom: "pcs", createdBy: operator, createdAt: outputAt })
      .returning();
    const [bo] = await db
      .insert(s.batchOutputs)
      .values({ organizationId: O, siteId: NFD.id, batchId: b.id, lineNo: 1, outputKind: "finished", productId: pr.id, qtyBase: String(units), baseUom: "pcs", massG: actualG.toString(), toLocationId: L(NFD.id, "QUA-01"), lotId: lot.id, recordedBy: operator, checkedBy: checker, recordedAt: outputAt })
      .returning();
    const outMv = await move({ siteId: NFD.id, type: "output", lotId: lot.id, to: L(NFD.id, "QUA-01"), qty: new Decimal(units), uom: "pcs", doc: ["batch", b.id, batchNo], by: operator, when: outputAt, status: "quarantine" });
    const [pp] = await db
      .insert(s.productionPostings)
      .values({ organizationId: O, siteId: NFD.id, batchId: b.id, postingType: "output", batchOutputId: bo.id, lotId: lot.id, qtyBase: String(units), baseUom: "pcs", stockMovementId: outMv, postedBy: operator, postedAt: outputAt })
      .returning();
    await db.update(s.batchOutputs).set({ productionPostingId: pp.id }).where(eq(s.batchOutputs.id, bo.id));
    await db.update(s.batches).set({ outputLotId: lot.id }).where(eq(s.batches.id, b.id));
    const yieldPct = actualG.div(theo).mul(100);
    const within = yieldPct.gte(95) && yieldPct.lte(102);
    let yieldDeviation: string | null = null;
    if (!within) yieldDeviation = (await raiseDeviation({ batchId: b.id, source: "yield", severity: "major", description: `Yield ${yieldPct.toFixed(1)} % below the 95 % limit.`, raisedAt: new Date(outputAt.getTime() + 600_000), closeAfterDays: 6 })).id;
    await db.insert(s.yieldRecords).values({
      organizationId: O,
      siteId: NFD.id,
      batchId: b.id,
      theoreticalBase: theo.toString(),
      actualBase: actualG.toString(),
      actualUnits: String(units),
      varianceBase: actualG.minus(theo).toString(),
      yieldPct: yieldPct.toDecimalPlaces(4).toString(),
      variancePct: yieldPct.minus(100).toDecimalPlaces(4).toString(),
      minPct: "95",
      maxPct: "102",
      isWithinLimits: within,
      recordedBy: operator,
      recordedAt: new Date(outputAt.getTime() + 900_000),
      approvedBy: within ? null : manager,
      approvedAt: within ? null : new Date(outputAt.getTime() + 3600_000),
      approvalReason: within ? null : "Low yield investigated under the deviation; lot may proceed to QA.",
      deviationId: yieldDeviation,
    });
    executed.push({ batchId: b.id, sku, lotId: lot.id, units, outputAt });

    // Finished-product inspection and QA decision
    if (fpInspection && ok(sampledAt)) {
      const [insp] = await db
        .insert(s.inspections)
        .values({ organizationId: O, siteId: NFD.id, inspectionNumber: num("INM"), status: reviewed ? (failQc ? "rejected" : "approved") : "in_progress", inspectionKind: "finished_product", inspectionPlanId: fpInspection.id, lotId: lot.id, batchId: b.id, sampledAt, sampledBy: qa2, performedBy: qa2, reviewedBy: reviewed ? qa : null, reviewedAt: reviewed ? reviewedAt : null, outcome: reviewed ? (failQc ? "fail" : "pass") : null, createdBy: operator, createdAt: new Date(outputAt.getTime() + 1200_000), statusChangedAt: reviewed ? reviewedAt : sampledAt, statusChangedBy: reviewed ? qa : qa2 })
        .returning();
      const its = [
        { fromState: null, toState: "pending", actorId: operator, occurredAt: new Date(outputAt.getTime() + 1200_000) },
        { fromState: "pending", toState: "in_progress", actorId: qa2, occurredAt: sampledAt },
      ];
      if (reviewed) its.push({ fromState: "in_progress", toState: "awaiting_review", actorId: qa2, occurredAt: new Date(sampledAt.getTime() + 2 * 3600_000) }, { fromState: "awaiting_review", toState: failQc ? "rejected" : "approved", actorId: qa, occurredAt: reviewedAt });
      await db.insert(s.inspectionStateTransitions).values(its.map((t) => ({ organizationId: O, siteId: NFD.id, inspectionId: insp.id, ...t })));
      let oosResult: string | null = null;
      for (const t of planTests.filter((t) => t.inspectionPlanId === fpInspection.id)) {
        const fails = failQc && t.testCode === "PH";
        const [r] = await db
          .insert(s.testResults)
          .values({ batchId: b.id, testName: t.name, specification: t.specText ?? "Conforms", result: fails ? "11.2" : t.testCode === "PH" ? "9.8" : "Conforms", passed: !fails, valuePass: !fails, testedBy: qa2, testedAt: new Date(sampledAt.getTime() + 3600_000), inspectionId: insp.id, inspectionPlanTestId: t.id, testCode: t.testCode })
          .returning();
        if (fails) oosResult = r.id;
      }
      if (reviewed) {
        if (failQc) {
          await raiseDeviation({ batchId: b.id, source: "oos", severity: "major", description: "pH 11.2 above the 10.5 limit on the finished bar.", raisedAt: new Date(sampledAt.getTime() + 2 * 3600_000), closeAfterDays: null });
          void oosResult;
          await disposition(NFD.id, "batch", b.id, "reject", "awaiting_qc", "rejected", reviewedAt, qa, "pH out of specification; batch rejected.", insp.id);
          await disposition(NFD.id, "lot", lot.id, "reject", "quarantine", "rejected", reviewedAt, qa, "pH out of specification.", insp.id);
          await move({ siteId: NFD.id, type: "transfer", lotId: lot.id, from: L(NFD.id, "QUA-01"), to: L(NFD.id, "REJ"), qty: new Decimal(units), uom: "pcs", doc: ["disposition", b.id, batchNo], by: whN, when: new Date(reviewedAt.getTime() + 1800_000), status: "rejected" });
        } else {
          await disposition(NFD.id, "batch", b.id, "release", "awaiting_qc", "released", reviewedAt, qa, "All tests within specification; BMR reviewed.", insp.id);
          await disposition(NFD.id, "lot", lot.id, "release", "quarantine", "released", reviewedAt, qa, "Finished-product inspection passed.", insp.id);
          await move({ siteId: NFD.id, type: "transfer", lotId: lot.id, from: L(NFD.id, "QUA-01"), to: L(NFD.id, "FG-01"), qty: new Decimal(units), uom: "pcs", doc: ["putaway", b.id, batchNo], by: whN, when: new Date(reviewedAt.getTime() + 1800_000), status: "released" });
        }
        await audit(`quality.disposition.${failQc ? "rejected" : "released"}`, "batch", b.id, batchNo, qa, NFD.id, reviewedAt);
      }
    }
  }

  // ---------------------------------------------------------------- quality holds
  const holdOn = async (lot: { lotId: string; number: string }, openedAt: Date, closeAt: Date | null, reason: string) => {
    if (!ok(openedAt)) return;
    const closed = closeAt !== null && ok(closeAt);
    const [h] = await db
      .insert(s.qualityHolds)
      .values({
        organizationId: O,
        siteId: NFD.id,
        holdNumber: num("HDM"),
        status: closed ? "closed" : "investigating",
        lotId: lot.lotId,
        reasonCode: openedAt.getDate() % 2 ? "investigation" : "suspected_contamination",
        reason,
        openedBy: qa2,
        openedAt,
        resolution: closed ? "released" : null,
        closeReason: closed ? "Retest conforms; lot released." : null,
        closedBy: closed ? qa : null,
        closedAt: closed ? closeAt : null,
        statusChangedAt: closed ? closeAt! : openedAt,
        statusChangedBy: closed ? qa : qa2,
      })
      .returning();
    const [hd] = await db.insert(s.dispositions).values({ organizationId: O, siteId: NFD.id, subjectType: "lot", subjectId: lot.lotId, decision: "hold", fromStatus: "released", toStatus: "on_hold", reason, decidedBy: qa2, decidedAt: openedAt }).returning();
    let closing: string | null = null;
    if (closed) closing = (await db.insert(s.dispositions).values({ organizationId: O, siteId: NFD.id, subjectType: "lot", subjectId: lot.lotId, decision: "release_from_hold", fromStatus: "on_hold", toStatus: "released", reason: "Retest conforms.", decidedBy: qa, decidedAt: closeAt! }).returning())[0].id;
    await db.update(s.inventoryLots).set({ qualityStatus: closed ? "released" : "on_hold" }).where(eq(s.inventoryLots.id, lot.lotId));
    await db.insert(s.qualityHoldLots).values({ qualityHoldId: h.id, lotId: lot.lotId, previousStatus: "released", holdDispositionId: hd.id, closingDispositionId: closing });
    await db.insert(s.qualityHoldStateTransitions).values([
      { organizationId: O, siteId: NFD.id, qualityHoldId: h.id, fromState: null, toState: "open", actorId: qa2, occurredAt: openedAt },
      { organizationId: O, siteId: NFD.id, qualityHoldId: h.id, fromState: "open", toState: "investigating", actorId: qa2, occurredAt: new Date(openedAt.getTime() + 3600_000) },
      ...(closed ? [{ organizationId: O, siteId: NFD.id, qualityHoldId: h.id, fromState: "investigating", toState: "closed", actorId: qa, occurredAt: closeAt! }] : []),
    ]);
  };
  const candidates = heldCandidates.filter((c) => c.at.getTime() < at(addDays(endDate, -6), 0).getTime());
  if (candidates[0]) await holdOn(candidates[0], at(addDays(startDate, 10), 10), at(addDays(startDate, 13), 15), "Odour complaint from the soap line; retest ordered.");
  if (candidates[candidates.length - 1] && candidates.length > 1) await holdOn(candidates[candidates.length - 1], at(addDays(endDate, -5), 10), null, "Supplier notified a possible contamination of the delivery.");

  // ---------------------------------------------------------------- sales orders and shipments
  const shipFrom = async (site: typeof NFD, sku: string) => fgLots[`${site.code}:${sku}`];
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(startDate, i);
    for (const site of [NFD, RVS]) {
      if (site.id === RVS.id && i % 3 !== 1) continue;
      if (site.id === NFD.id && i % 2 === 1) continue;
      const createdAt = at(date, 10, site.id === NFD.id ? 0 : 30);
      if (!ok(createdAt)) continue;
      const cust = customerRows[(i + (site.id === RVS.id ? 1 : 0)) % customerRows.length];
      const skus = site.id === NFD.id ? ["ACS-135", "GBS-135"] : ["ACS-135", "AHL-250"];
      const requested = addDays(date, 3 + (i % 3));
      const cancelled = i === 9 && site.id === NFD.id;
      const neverShipped = i % 11 === 6;
      const lateBy = i % 5 === 3 ? 2 : 0;
      const short = i % 7 === 5;
      const dispatchAt = at(addDays(requested, lateBy === 0 ? -1 : lateBy), 14);
      const ships = !cancelled && !neverShipped && ok(dispatchAt);
      const isDraft = i === DAYS - 1 && site.id === NFD.id;
      const status = isDraft ? "draft" : cancelled ? "cancelled" : ships ? "shipped" : "confirmed";
      const soNo = num("SOM");
      const [so] = await db
        .insert(s.salesOrders)
        .values({ organizationId: O, siteId: site.id, orderNumber: soNo, customerId: cust.id, customerPoNumber: `PO-${series}-${i}`, requestedDeliveryOn: requested, status, createdBy: salesUser, confirmedBy: isDraft ? null : manager, createdAt })
        .returning();
      const lines = (i % 4 === 0 ? skus : [skus[i % 2]]).map((sku, k) => ({ salesOrderId: so.id, lineNo: k + 1, productId: P(sku).id, qtyUnits: String(i % 3 === 0 ? 96 : 48), unitPrice: (66 + ((i + k) % 7)).toFixed(2) }));
      await db.insert(s.salesOrderLines).values(lines);
      await audit("sales.sales_order.created", "sales_order", so.id, soNo, salesUser, site.id, createdAt);
      if (!ships) continue;
      const drNo = num("DRM");
      const [sh] = await db
        .insert(s.shipments)
        .values({ organizationId: O, siteId: site.id, salesOrderId: so.id, deliveryReceiptNumber: drNo, carrier: "Own truck", driverName: "Ramon Aquino", vehiclePlate: "NBC 1234", packageCount: lines.length, dispatchedBy: site.id === NFD.id ? whN : whR, dispatchedAt: dispatchAt })
        .returning();
      for (const [k, l] of lines.entries()) {
        const sku = productRows.find((p) => p.id === l.productId)!.skuCode;
        const qty = new Decimal(l.qtyUnits).mul(short && k === 0 ? 0.5 : 1);
        await move({ siteId: site.id, type: "shipment", lotId: await shipFrom(site, sku), from: L(site.id, "FG-01"), qty, uom: "pcs", doc: ["shipment", sh.id, drNo], by: site.id === NFD.id ? whN : whR, when: dispatchAt, status: "released" });
      }
      await audit("sales.shipment.dispatched", "shipment", sh.id, drNo, site.id === NFD.id ? whN : whR, site.id, dispatchAt);
    }
  }

  // ---------------------------------------------------------------- open action-centre items
  const alertAt = at(addDays(endDate, -2), 7);
  if (ok(alertAt)) {
    const alerts: { siteId: string | null; kind: string; severity: string; title: string; body: string; to: string[]; key: string }[] = [
      { siteId: NFD.id, kind: "expiry_alert", severity: "warning", title: "Palm oil lot expires within 14 days", body: "A released lot at North Fields expires soon; use it first (FEFO).", to: [owner, manager], key: `w3a:${series}:expiry` },
      { siteId: NFD.id, kind: "deviation_overdue", severity: "critical", title: "Deviation open for more than 7 days", body: "An out-of-specification deviation on a soap batch is still under investigation.", to: [owner, qa], key: `w3a:${series}:deviation` },
      { siteId: RVS.id, kind: "order_overdue", severity: "warning", title: "Order past its requested delivery date", body: "A Riverside order has not been dispatched yet.", to: [owner, salesUser], key: `w3a:${series}:order` },
    ];
    for (const a of alerts)
      await db.insert(s.notifications).values(a.to.map((u) => ({ organizationId: O, siteId: a.siteId, recipientUserId: u, kind: a.kind, severity: a.severity, title: a.title, body: a.body, channel: "in_app", deliveredAt: alertAt, dedupeKey: a.key, createdAt: alertAt }))).onConflictDoNothing();
  }

  // ---------------------------------------------------------------- KPI snapshots for every day of the window
  let snapshots = 0;
  if (opts.backfill) {
    const sitesTz = siteRows.filter((x) => x.isActive).map((x) => ({ id: x.id, tz: x.timezone }));
    const lastDay = addDays(localDate(now, TZ), -1);
    const [log] = await db.insert(s.kpiRefreshLog).values({ organizationId: O, runKind: "snapshot", businessDate: lastDay, asOf: now, startedAt: now }).returning();
    for (let i = 0; i < DAYS; i++) {
      const bd = addDays(startDate, i);
      if (bd > lastDay) break;
      const dow = new Date(bd + "T00:00:00Z").getUTCDay();
      const monthEnd = addDays(bd, 1).slice(8, 10) === "01";
      const grains: ("day" | "week" | "month")[] = ["day", ...(dow === 0 || bd === lastDay ? (["week"] as const) : []), ...(monthEnd || bd === lastDay ? (["month"] as const) : [])];
      const r = await computeSnapshots(db, { organizationId: O, sites: sitesTz, orgTz: org.timezone, businessDate: bd, now, settings: { fefoWindowDays: 30, otifGraceDays: 0 }, refreshLogId: log.id, grains });
      snapshots += r.written;
    }
    await db.update(s.kpiRefreshLog).set({ status: "succeeded", snapshotsWritten: snapshots, finishedAt: now }).where(eq(s.kpiRefreshLog.id, log.id));
  }

  return { skipped: false, startDate, endDate, batches: executed.length, deviations: deviationRows.length, snapshots };
}
