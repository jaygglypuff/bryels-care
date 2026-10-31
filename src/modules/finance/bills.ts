import "server-only";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { CHARGE_KINDS, goodsReceiptLines, goodsReceipts, materials, supplierBillLines, supplierBills, suppliers } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { approvalProgress, assertPosterAllowed, canDecide, decisionsOf, evaluateAtSubmit, notifyNextStep, recordDecision, type Progress } from "./approvals";
import { purchaseOrderMatchSource } from "./procurement-contract";
import { D, DATE_RE, addDays, computeTaxedLines, isUuid, logTransition, m4, money, namesOf, parseAmount, postFinancial, postingsOf, requireReason, reverseDocumentPosting, settlementState, transitionsOf } from "./shared";
import { type TaxConfigRow, defaultTaxCode, requireTaxConfiguration, taxCodeOptions } from "./tax";

/**
 * Supplier bills with three-way match (US-6-11, FR-finance-02, docs/modules/finance.md §3.2 P-01..P-05).
 *
 *   draft → submitted → approved → posted → partially_paid → paid → closed
 *   draft | submitted → disputed (match variance) → submitted (variance approved / re-matched)
 *   submitted | disputed → draft (returned); draft | submitted | disputed | approved → cancelled
 *   posted → voided (reversal, nothing paid)
 *
 * Three-way match at submission, per goods line: the bill quantity against the posted goods receipt line
 * (minus what other live bills already billed of it) and the bill amount against the purchase order line
 * (read through the W4A contract, `registerPurchaseOrderMatchSource`; without it the price leg is "no PO
 * data"). Tolerances are settings per site (A-FIN-08: quantity exact; price ±2 % or PHP 100 per line,
 * whichever is larger). Any variance puts the bill in `disputed` until a different person approves the
 * variance with a reason, the PO is amended (re-match) or a supplier credit is entered. Bills without a
 * receipt or PO are allowed only for configured non-stock categories and always need a finance approver
 * (A-FIN-09). Posting (`finance.supplier_bill.post`, restricted) writes `bill_post` dated on the bill date
 * in an open period; due date = bill date + supplier terms.
 */

export type SupplierBillRow = typeof supplierBills.$inferSelect;

export const BILL_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  disputed: "Disputed",
  approved: "Approved",
  posted: "Posted",
  partially_paid: "Partially paid",
  paid: "Paid",
  closed: "Closed",
  voided: "Voided",
  cancelled: "Cancelled",
};

export const MATCH_LABEL: Record<string, string> = {
  matched: "Matched",
  qty_variance: "Quantity variance",
  price_variance: "Price variance",
  no_po: "Receipt matched (no PO data)",
  no_receipt: "Not on a receipt",
};

const VARIANCES = ["qty_variance", "price_variance", "no_receipt"];
const label = (b: Pick<SupplierBillRow, "billNumber">) => `Bill ${b.billNumber}`;
const doc = (b: SupplierBillRow) => ({ type: "supplier_bill" as const, id: b.id, siteId: b.siteId, label: label(b) });
export const billOpenAmount = (b: Pick<SupplierBillRow, "totalAmount" | "paidAmount">) => D(b.totalAmount).minus(b.paidAmount);

async function lockBill(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Supplier bill not found in your sites.");
  const [b] = await tx
    .select()
    .from(supplierBills)
    .where(and(eq(supplierBills.id, id), eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!b) throw new DomainError("not_found", "Supplier bill not found in your sites.");
  ctx.requireSite(b.siteId);
  return b;
}

export type BillLineInput = {
  chargeKind?: (typeof CHARGE_KINDS)[number];
  goodsReceiptLineId?: string | null;
  purchaseOrderLineId?: string | null;
  materialId?: string | null;
  description?: string | null;
  qty: string;
  unitAmount: string;
  taxCode?: string | null;
};

export type CreateBillInput = {
  supplierId: string;
  supplierReference: string;
  billDate: string;
  goodsReceiptId?: string | null;
  purchaseOrderId?: string | null;
  categoryCode?: string | null;
  billKind?: "bill" | "credit" | "charge";
  creditForBillId?: string | null;
  notes?: string | null;
  lines: BillLineInput[];
  idempotencyKey?: string | null;
};

/** Validates the lines against the receipt and prices them with the reviewed purchase tax (V-FIN-TAX). */
async function buildLines(tx: Tx, ctx: AuthContext, input: CreateBillInput, gr: typeof goodsReceipts.$inferSelect | null) {
  if (!input.lines?.length) throw new DomainError("validation", "Add at least one line.", { field: "lines" });
  if (input.lines.length > 200) throw new DomainError("validation", "A bill has at most 200 lines.", { field: "lines" });
  const grLines = gr ? await tx.select({ l: goodsReceiptLines, code: materials.code, name: materials.name, uom: materials.baseUom }).from(goodsReceiptLines).innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId)).where(eq(goodsReceiptLines.goodsReceiptId, gr.id)) : [];
  const defaultCode = await defaultTaxCode(tx, ctx.organizationId, "purchases");
  const taxCache = new Map<string, TaxConfigRow>();
  const out = [];
  for (const [i, l] of input.lines.entries()) {
    const field = `lines.${i}`;
    const kind = l.chargeKind ?? "goods";
    if (!(CHARGE_KINDS as readonly string[]).includes(kind)) throw new DomainError("validation", "Choose the line kind.", { field: `${field}.chargeKind` });
    const qty = parseAmount(l.qty, `${field}.qty`);
    const unit = parseAmount(l.unitAmount, `${field}.unitAmount`, { allowZero: true });
    let materialId = l.materialId && isUuid(l.materialId) ? l.materialId : null;
    let description = (l.description ?? "").trim();
    let uom: string | null = null;
    if (l.goodsReceiptLineId) {
      const g = grLines.find((x) => x.l.id === l.goodsReceiptLineId);
      if (!g) throw new DomainError("validation", "The receipt line is not on the chosen goods receipt.", { field: `${field}.goodsReceiptLineId` });
      materialId = g.l.materialId;
      description ||= `${g.code} · ${g.name}`;
      uom = g.uom;
    }
    if (l.purchaseOrderLineId && !isUuid(l.purchaseOrderLineId)) throw new DomainError("validation", "Choose a valid purchase order line.", { field: `${field}.purchaseOrderLineId` });
    if (!description) throw new DomainError("validation", "Describe the line.", { field: `${field}.description` });
    const code = l.taxCode === undefined ? defaultCode : l.taxCode?.trim() || null;
    let tax: TaxConfigRow | null = null;
    if (code) {
      tax = taxCache.get(code) ?? (await requireTaxConfiguration(tx, ctx.organizationId, code, "purchases", input.billDate));
      taxCache.set(code, tax);
    }
    out.push({ kind, qty, unit, materialId, description: description.slice(0, 200), uom, goodsReceiptLineId: l.goodsReceiptLineId ?? null, purchaseOrderLineId: l.purchaseOrderLineId ?? null, tax });
  }
  const calc = computeTaxedLines(out.map((l) => ({ qty: l.qty, unitAmount: l.unit, ratePct: l.tax?.ratePct ?? 0, inclusive: l.tax?.inclusive ?? false, rounding: (l.tax?.rounding ?? "line") as "line" | "document" })));
  return { lines: out, calc };
}

/** P-01: enter the supplier's bill (against a posted receipt, or a non-stock category without one). */
export async function createSupplierBill(ctx: AuthContext, input: CreateBillInput) {
  ctx.require("finance.supplier_bill.create");
  if (!isUuid(input.supplierId)) throw new DomainError("validation", "Choose the supplier.", { field: "supplierId" });
  const ref = (input.supplierReference ?? "").trim();
  if (ref.length < 1 || ref.length > 60) throw new DomainError("validation", "Enter the supplier's bill number (max 60).", { field: "supplierReference" });
  if (!DATE_RE.test(input.billDate)) throw new DomainError("validation", "Choose the bill date.", { field: "billDate" });
  const kind = input.billKind ?? "bill";
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ billId: string; billNumber: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.supplier_bill.create", { ...input, idempotencyKey: undefined });
      if (replay) return replay.replay;
    }
    const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, ctx.organizationId))).limit(1);
    if (!supplier) throw new DomainError("validation", "Choose the supplier.", { field: "supplierId" });
    if (!supplier.isActive) throw new DomainError("validation", "The supplier is inactive.", { field: "supplierId" });
    let gr: typeof goodsReceipts.$inferSelect | null = null;
    let siteId = ctx.currentSiteId;
    if (input.goodsReceiptId) {
      if (!isUuid(input.goodsReceiptId)) throw new DomainError("validation", "Choose a goods receipt.", { field: "goodsReceiptId" });
      const [g] = await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, input.goodsReceiptId), eq(goodsReceipts.organizationId, ctx.organizationId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds))).limit(1);
      if (!g) throw new DomainError("not_found", "Goods receipt not found in your sites.");
      if (g.status !== "posted") throw new DomainError("validation", `SOURCE_NOT_POSTABLE: receipt ${g.receiptNumber ?? ""} is ${g.status}; bills match posted receipts only.`, { code: "SOURCE_NOT_POSTABLE", field: "goodsReceiptId" });
      if (g.supplierId && g.supplierId !== supplier.id) throw new DomainError("validation", "The receipt is from another supplier.", { field: "goodsReceiptId" });
      gr = g;
      siteId = g.siteId;
    }
    ctx.requireAt("finance.supplier_bill.create", siteId);
    let categoryCode: string | null = input.categoryCode?.trim() || null;
    if (!gr && !input.purchaseOrderId && kind !== "credit") {
      const allowed = await getSetting(tx, ctx.organizationId, "finance.bill.no_po_categories");
      if (!categoryCode || !allowed.includes(categoryCode)) {
        throw new DomainError("validation", `A bill without a goods receipt or PO is allowed only for these categories: ${allowed.join(", ")} (A-FIN-09).`, { field: "categoryCode" });
      }
    } else if (gr) categoryCode = null;
    let creditFor: string | null = null;
    if (kind === "credit") {
      if (!input.creditForBillId || !isUuid(input.creditForBillId)) throw new DomainError("validation", "Choose the bill this credit reduces.", { field: "creditForBillId" });
      const [t] = await tx.select().from(supplierBills).where(and(eq(supplierBills.id, input.creditForBillId), eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds))).limit(1);
      if (!t || t.supplierId !== supplier.id || t.billKind === "credit") throw new DomainError("validation", "The credit must reduce a bill of the same supplier.", { field: "creditForBillId" });
      if (["voided", "cancelled", "paid", "closed"].includes(t.status)) throw new DomainError("validation", `Bill ${t.billNumber} is ${t.status}; it cannot take a credit.`, { field: "creditForBillId" });
      creditFor = t.id;
      siteId = t.siteId;
    }
    const { lines, calc } = await buildLines(tx, ctx, input, gr);
    const number = await nextNumber(tx, ctx.organizationId, "BILL");
    const currency = await getSetting(tx, ctx.organizationId, "finance.currency");
    let bill: SupplierBillRow;
    try {
      [bill] = await tx
        .insert(supplierBills)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          billNumber: number,
          billKind: kind,
          supplierId: supplier.id,
          supplierReference: ref,
          goodsReceiptId: gr?.id ?? null,
          purchaseOrderId: input.purchaseOrderId && isUuid(input.purchaseOrderId) ? input.purchaseOrderId : null,
          categoryCode,
          creditForBillId: creditFor,
          billDate: input.billDate,
          paymentTermsDays: supplier.paymentTermsDays,
          currency,
          subtotalAmount: calc.subtotal,
          taxAmount: calc.tax,
          totalAmount: calc.total,
          notes: input.notes?.trim() || null,
          createdBy: ctx.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
    } catch (e) {
      if (String((e as { cause?: { constraint_name?: string } })?.cause?.constraint_name ?? (e as Error).message).includes("uq_supplier_bills_supplier_ref")) {
        throw new DomainError("conflict", `DUPLICATE_DOCUMENT: ${supplier.name} bill ${ref} is already entered.`, { code: "DUPLICATE_DOCUMENT", field: "supplierReference" });
      }
      throw e;
    }
    await tx.insert(supplierBillLines).values(
      lines.map((l, i) => ({
        supplierBillId: bill.id,
        lineNo: i + 1,
        chargeKind: l.kind,
        materialId: l.materialId,
        goodsReceiptLineId: l.goodsReceiptLineId,
        purchaseOrderLineId: l.purchaseOrderLineId,
        description: l.description,
        qty: l.qty.toString(),
        uom: l.uom,
        unitAmount: m4(l.unit),
        taxCode: l.tax?.code ?? null,
        taxConfigurationId: l.tax?.id ?? null,
        taxRatePct: l.tax?.ratePct ?? "0",
        lineAmount: calc.lines[i].lineAmount,
        taxAmount: calc.lines[i].taxAmount,
        currency,
      })),
    );
    await logTransition(tx, ctx, doc(bill), null, "draft");
    await audit(tx, ctx, { action: "finance.supplier_bill.created", entityType: "supplier_bill", entityId: bill.id, entityNumber: number, siteId, after: { supplierReference: ref, kind, total: calc.total, goodsReceiptId: gr?.id ?? null, categoryCode } });
    const result = { billId: bill.id, billNumber: number };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { ...input, idempotencyKey: undefined }, result);
    return result;
  });
}

/** Header edits of a draft or disputed bill (the supplier's number, date, notes). */
export async function editSupplierBill(ctx: AuthContext, id: string, input: { supplierReference?: string; billDate?: string; notes?: string | null }) {
  ctx.require("finance.supplier_bill.edit");
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    ctx.requireAt("finance.supplier_bill.edit", b.siteId);
    if (!["draft", "disputed"].includes(b.status)) throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; only a draft or disputed bill can be edited.`);
    const set: Partial<typeof supplierBills.$inferInsert> = { updatedAt: new Date() };
    if (input.supplierReference !== undefined) {
      const r = input.supplierReference.trim();
      if (!r || r.length > 60) throw new DomainError("validation", "Enter the supplier's bill number (max 60).", { field: "supplierReference" });
      const [dup] = await tx.select({ id: supplierBills.id }).from(supplierBills).where(and(eq(supplierBills.supplierId, b.supplierId), sql`lower(${supplierBills.supplierReference}) = lower(${r})`, ne(supplierBills.id, b.id), ne(supplierBills.status, "cancelled"))).limit(1);
      if (dup) throw new DomainError("conflict", "DUPLICATE_DOCUMENT: this supplier bill number is already entered.", { code: "DUPLICATE_DOCUMENT", field: "supplierReference" });
      set.supplierReference = r;
    }
    if (input.billDate !== undefined) {
      if (!DATE_RE.test(input.billDate)) throw new DomainError("validation", "Choose the bill date.", { field: "billDate" });
      set.billDate = input.billDate;
    }
    if (input.notes !== undefined) set.notes = input.notes?.trim() || null;
    const [after] = await tx.update(supplierBills).set(set).where(eq(supplierBills.id, b.id)).returning();
    await audit(tx, ctx, { action: "finance.supplier_bill.edited", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, before: { supplierReference: b.supplierReference, billDate: b.billDate, notes: b.notes }, after: { supplierReference: after.supplierReference, billDate: after.billDate, notes: after.notes } });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ three-way match */

export type MatchLine = { lineId: string; lineNo: number; result: string; detail: Record<string, string | null> };

/** P-02: per-line three-way match; stores the result on the lines and the summary on the bill. */
async function runMatch(tx: Tx, ctx: AuthContext, b: SupplierBillRow) {
  const lines = await tx.select().from(supplierBillLines).where(eq(supplierBillLines.supplierBillId, b.id)).orderBy(asc(supplierBillLines.lineNo));
  const qtyTol = await getSetting(tx, ctx.organizationId, "finance.match.qty_tolerance_pct", b.siteId);
  const pricePct = await getSetting(tx, ctx.organizationId, "finance.match.price_tolerance_pct", b.siteId);
  const priceAmt = await getSetting(tx, ctx.organizationId, "finance.match.price_tolerance_amount", b.siteId);
  const grIds = lines.map((l) => l.goodsReceiptLineId).filter((x): x is string => !!x);
  const received = grIds.length
    ? await tx.select({ id: goodsReceiptLines.id, qty: goodsReceiptLines.qtyBase, status: goodsReceipts.status }).from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId)).where(inArray(goodsReceiptLines.id, grIds))
    : [];
  const billedElsewhere = grIds.length
    ? await tx
        .select({ id: supplierBillLines.goodsReceiptLineId, qty: sql<string>`sum(${supplierBillLines.qty})::text` })
        .from(supplierBillLines)
        .innerJoin(supplierBills, eq(supplierBills.id, supplierBillLines.supplierBillId))
        .where(and(inArray(supplierBillLines.goodsReceiptLineId, grIds), ne(supplierBills.id, b.id), notInArray(supplierBills.status, ["cancelled", "voided"]), eq(supplierBills.billKind, "bill")))
        .groupBy(supplierBillLines.goodsReceiptLineId)
    : [];
  const source = purchaseOrderMatchSource();
  const poOfGr = source?.poLineOfReceiptLine && grIds.length ? await source.poLineOfReceiptLine(tx, grIds) : new Map<string, string>();
  const poIds = [...new Set(lines.map((l) => l.purchaseOrderLineId ?? (l.goodsReceiptLineId ? poOfGr.get(l.goodsReceiptLineId) : undefined)).filter((x): x is string => !!x))];
  const poLines = source && poIds.length ? await source.linesById(tx, ctx.organizationId, poIds) : [];
  const out: MatchLine[] = [];
  for (const l of lines) {
    let result = "matched";
    const detail: Record<string, string | null> = {};
    if (l.chargeKind !== "goods") {
      detail.note = "Charge line (landed cost): not matched to a receipt.";
    } else if (!l.goodsReceiptLineId && !l.purchaseOrderLineId) {
      result = b.categoryCode ? "no_po" : "no_receipt";
      if (b.categoryCode) detail.note = `Non-stock category ${b.categoryCode} (A-FIN-09).`;
    } else {
      if (l.goodsReceiptLineId) {
        const r = received.find((x) => x.id === l.goodsReceiptLineId);
        const already = D(billedElsewhere.find((x) => x.id === l.goodsReceiptLineId)?.qty ?? 0);
        const billable = D(r?.qty ?? 0).minus(already);
        const allowed = billable.plus(billable.times(qtyTol).div(100));
        detail.receivedQty = r?.qty ?? "0";
        detail.billedElsewhere = already.toString();
        detail.billQty = l.qty;
        if (!r || r.status !== "posted") result = "no_receipt";
        else if (D(l.qty).gt(allowed)) result = "qty_variance";
      }
      const poLineId = l.purchaseOrderLineId ?? (l.goodsReceiptLineId ? poOfGr.get(l.goodsReceiptLineId) : undefined);
      const po = poLineId ? poLines.find((p) => p.purchaseOrderLineId === poLineId) : undefined;
      if (po) {
        const expected = D(l.qty).times(po.unitAmount);
        const diff = D(l.lineAmount).minus(expected).abs();
        const tol = Decimal.max(expected.times(pricePct).div(100), D(priceAmt));
        detail.poNumber = po.poNumber;
        detail.poUnitAmount = po.unitAmount;
        detail.expectedAmount = m4(expected);
        detail.priceDifference = m4(diff);
        detail.priceTolerance = m4(tol);
        if (result === "matched" && diff.gt(tol)) result = "price_variance";
      } else if (result === "matched") {
        result = "no_po";
        detail.note = source ? "No purchase order line found for this receipt line." : "Purchase orders are not connected yet: the price is not checked against a PO (receipt quantity matched).";
      }
    }
    out.push({ lineId: l.id, lineNo: l.lineNo, result, detail });
    await tx.update(supplierBillLines).set({ matchResult: result, matchDetail: detail }).where(eq(supplierBillLines.id, l.id));
  }
  const variance = out.some((o) => VARIANCES.includes(o.result));
  const summary = { at: new Date().toISOString(), variance, tolerances: { qtyPct: qtyTol, pricePct, priceAmount: priceAmt }, poSource: !!source, lines: out.map((o) => ({ lineNo: o.lineNo, result: o.result })) };
  await tx.update(supplierBills).set({ matchSummary: summary, updatedAt: new Date() }).where(eq(supplierBills.id, b.id));
  return { variance, lines: out };
}

/** Moves a matched bill to approval (or approved when no rule applies). */
async function toApproval(tx: Tx, ctx: AuthContext, b: SupplierBillRow, from: string) {
  const ev = await evaluateAtSubmit(tx, ctx, { recordType: "supplier_bill", recordId: b.id, recordNumber: b.billNumber, siteId: b.siteId, basis: { amount: b.totalAmount } });
  const to = ev.steps.length ? "submitted" : "approved";
  const now = new Date();
  await tx.update(supplierBills).set({ status: to, ...(to === "approved" ? { approvedAt: now } : {}), updatedAt: now }).where(eq(supplierBills.id, b.id));
  if (from !== "submitted") await logTransition(tx, ctx, doc(b), from, "submitted");
  if (to === "approved") await logTransition(tx, ctx, doc(b), "submitted", "approved", "No approval rule applies");
  else await notifyNextStep(tx, ctx, ev.steps[0] ?? null, { siteId: b.siteId, kind: "finance.supplier_bill.approval", title: `Bill ${b.billNumber} to approve`, body: `${money(b.totalAmount)} ${b.currency} waits for approval.`, entityType: "supplier_bill", entityId: b.id, link: `/finance/bills/${b.id}` });
  return to;
}

/** P-02/P-04: submit runs the match; a variance beyond tolerance → disputed (409 MATCH_VARIANCE is not thrown: the bill is parked). */
export async function submitSupplierBill(ctx: AuthContext, id: string) {
  ctx.require("finance.supplier_bill.submit");
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    ctx.requireAt("finance.supplier_bill.submit", b.siteId);
    if (b.status !== "draft") throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; only a draft can be submitted.`);
    await tx.update(supplierBills).set({ submittedBy: ctx.userId, submittedAt: new Date() }).where(eq(supplierBills.id, b.id));
    const m = await runMatch(tx, ctx, b);
    let status: string;
    if (m.variance) {
      await tx.update(supplierBills).set({ status: "disputed", updatedAt: new Date() }).where(eq(supplierBills.id, b.id));
      await logTransition(tx, ctx, doc(b), "draft", "disputed", "Three-way match variance beyond tolerance");
      status = "disputed";
    } else status = await toApproval(tx, ctx, { ...b, submittedBy: ctx.userId }, "draft");
    await audit(tx, ctx, { action: "finance.supplier_bill.submitted", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, after: { status, match: m.lines.map((l) => ({ lineNo: l.lineNo, result: l.result })) } });
    return { status, match: m.lines };
  });
}

/**
 * P-03: settle a dispute. `approve_variance`: a holder of `finance.supplier_bill.approve` other than the
 * creator/submitter accepts the variance with a reason; `rematch`: run the match again (after a PO amendment
 * or a supplier credit). Either way the bill continues to approval when nothing is left in dispute.
 */
export async function resolveBillDispute(ctx: AuthContext, id: string, input: { action: "approve_variance" | "rematch"; reason?: string | null }) {
  ctx.require(input.action === "approve_variance" ? "finance.supplier_bill.approve" : "finance.supplier_bill.submit");
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    if (b.status !== "disputed") throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; only a disputed bill can be resolved.`);
    if (input.action === "approve_variance") {
      ctx.requireAt("finance.supplier_bill.approve", b.siteId);
      const reason = requireReason(input.reason);
      ctx.assertSeparation(b.createdBy === ctx.userId || b.submittedBy === ctx.userId, "You entered or submitted this bill; another person approves the variance.", { code: "SEPARATION_OF_DUTIES" });
      const now = new Date();
      await tx.update(supplierBills).set({ varianceApprovedBy: ctx.userId, varianceApprovedAt: now, varianceReason: reason, updatedAt: now }).where(eq(supplierBills.id, b.id));
      await logTransition(tx, ctx, doc(b), "disputed", "submitted", `Variance approved: ${reason}`);
      const status = await toApproval(tx, ctx, b, "submitted");
      await audit(tx, ctx, { action: "finance.supplier_bill.variance_approved", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, reason, after: { status, match: b.matchSummary } });
      return { status };
    }
    ctx.requireAt("finance.supplier_bill.submit", b.siteId);
    const m = await runMatch(tx, ctx, b);
    if (m.variance) {
      await audit(tx, ctx, { action: "finance.supplier_bill.rematched", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, after: { variance: true } });
      return { status: "disputed", match: m.lines };
    }
    await logTransition(tx, ctx, doc(b), "disputed", "submitted", "Re-matched within tolerance");
    const status = await toApproval(tx, ctx, b, "submitted");
    await audit(tx, ctx, { action: "finance.supplier_bill.rematched", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, after: { variance: false, status } });
    return { status, match: m.lines };
  });
}

export async function decideSupplierBill(ctx: AuthContext, id: string, input: { decision: "approved" | "returned"; note?: string | null }) {
  ctx.require("finance.supplier_bill.approve");
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    if (b.status !== "submitted") throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; only a submitted bill can be decided.`);
    const r = await recordDecision(tx, ctx, {
      recordType: "supplier_bill",
      recordId: b.id,
      recordNumber: b.billNumber,
      siteId: b.siteId,
      basis: { amount: b.totalAmount },
      pendingSince: b.submittedAt,
      excludedUserIds: [b.createdBy, b.submittedBy],
      decision: input.decision,
      note: input.note,
      // A-FIN-09: a bill without a receipt or PO always needs a finance approver.
      requireRole: !b.goodsReceiptId && !b.purchaseOrderId ? "finance" : null,
    });
    const now = new Date();
    if (input.decision === "returned") {
      await tx.update(supplierBills).set({ status: "draft", submittedBy: null, submittedAt: null, updatedAt: now }).where(eq(supplierBills.id, b.id));
      await logTransition(tx, ctx, doc(b), "submitted", "draft", input.note ?? null);
    } else if (r.final) {
      await tx.update(supplierBills).set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null, updatedAt: now }).where(eq(supplierBills.id, b.id));
      await logTransition(tx, ctx, doc(b), "submitted", "approved", input.note?.trim() || null);
    }
    await audit(tx, ctx, { action: input.decision === "approved" ? "finance.supplier_bill.approved" : "finance.supplier_bill.returned", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, reason: input.note?.trim() || null, after: { final: r.final, step: r.step?.step ?? 1 } });
    return { approved: input.decision === "approved" && r.final };
  });
}

export async function cancelSupplierBill(ctx: AuthContext, id: string, reason: string) {
  ctx.require("finance.supplier_bill.create");
  const why = requireReason(reason);
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    ctx.requireAt("finance.supplier_bill.create", b.siteId);
    if (!["draft", "submitted", "disputed", "approved"].includes(b.status)) throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; a posted bill is voided, not cancelled.`);
    await tx.update(supplierBills).set({ status: "cancelled", cancelReason: why, updatedAt: new Date() }).where(eq(supplierBills.id, b.id));
    await logTransition(tx, ctx, doc(b), b.status, "cancelled", why);
    await audit(tx, ctx, { action: "finance.supplier_bill.cancelled", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, reason: why });
    return { status: "cancelled" };
  });
}

/** P-05: post (restricted). A supplier credit reduces the open amount of its bill in the same transaction. */
export async function postSupplierBill(ctx: AuthContext, id: string, input: { password?: string | null; idempotencyKey?: string | null } = {}) {
  ctx.require("finance.supplier_bill.post");
  await requireReauthentication(ctx, input.password, "finance.supplier_bill.post");
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const replay = await claimIdempotencyKey<{ status: string }>(tx, ctx.organizationId, input.idempotencyKey, "finance.supplier_bill.post", { id });
      if (replay) return replay.replay;
    }
    const b = await lockBill(tx, ctx, id);
    ctx.requireAt("finance.supplier_bill.post", b.siteId);
    if (b.status !== "approved") throw new DomainError("state", `${label(b)} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; only an approved bill can be posted.`);
    await assertPosterAllowed(tx, ctx, { recordType: "supplier_bill", recordId: b.id, siteId: b.siteId, basis: { amount: b.totalAmount } });
    let target: SupplierBillRow | null = null;
    if (b.billKind === "credit" && b.creditForBillId) {
      target = await lockBill(tx, ctx, b.creditForBillId);
      if (!["posted", "partially_paid"].includes(target.status)) throw new DomainError("state", `Bill ${target.billNumber} is ${BILL_STATUS_LABEL[target.status].toLowerCase()}; post it before its credit.`);
      if (D(b.totalAmount).gt(billOpenAmount(target))) throw new DomainError("validation", `OVER_APPLICATION: bill ${target.billNumber} has only ${money(billOpenAmount(target))} open.`, { code: "OVER_APPLICATION" });
    }
    const terms = b.paymentTermsDays ?? (await getSetting(tx, ctx.organizationId, "finance.bill.default_terms_days"));
    await postFinancial(tx, ctx, { siteId: b.siteId, postingType: "bill_post", documentType: "supplier_bill", documentId: b.id, documentNumber: b.billNumber, postingDate: b.billDate, amount: b.totalAmount, taxAmount: b.taxAmount, currency: b.currency, direction: b.billKind === "credit" ? "debit" : "credit", supplierId: b.supplierId, idempotencyKey: input.idempotencyKey ?? null });
    const now = new Date();
    const status = b.billKind === "credit" ? "paid" : "posted";
    await tx.update(supplierBills).set({ status, dueDate: addDays(b.billDate, terms), paymentTermsDays: terms, postedBy: ctx.userId, postedAt: now, ...(b.billKind === "credit" ? { paidAmount: b.totalAmount } : {}), updatedAt: now }).where(eq(supplierBills.id, b.id));
    await logTransition(tx, ctx, doc(b), "approved", "posted");
    if (target) {
      await logTransition(tx, ctx, doc(b), "posted", "paid", `Applied to bill ${target.billNumber}`);
      const paid = D(target.paidAmount).plus(b.totalAmount);
      const to = settlementState("posted", target.totalAmount, paid);
      await tx.update(supplierBills).set({ paidAmount: m4(paid), status: to, updatedAt: now }).where(eq(supplierBills.id, target.id));
      if (to !== target.status) await logTransition(tx, ctx, doc(target), target.status, to, `Supplier credit ${b.billNumber}`);
    }
    await audit(tx, ctx, { action: "finance.supplier_bill.posted", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, after: { total: b.totalAmount, billDate: b.billDate, dueDate: addDays(b.billDate, terms), kind: b.billKind, creditFor: target?.billNumber ?? null } });
    const result = { status };
    if (input.idempotencyKey) await storeIdempotentResult(tx, ctx.organizationId, input.idempotencyKey, { id }, result);
    return result;
  });
}

/** Reversal of a posted bill with nothing paid (restricted). A replacement is a new bill. */
export async function voidSupplierBill(ctx: AuthContext, id: string, input: { reason: string; password?: string | null }) {
  ctx.require("finance.supplier_bill.void");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.supplier_bill.void");
  return db.transaction(async (tx) => {
    const b = await lockBill(tx, ctx, id);
    ctx.requireAt("finance.supplier_bill.void", b.siteId);
    if (b.billKind === "credit") throw new DomainError("conflict", "A posted supplier credit cannot be reversed here; enter a new bill for the difference.");
    if (b.status !== "posted" || D(b.paidAmount).gt(0)) throw new DomainError("state", "Only a posted bill with nothing paid or credited can be reversed; void its payments first.");
    await reverseDocumentPosting(tx, ctx, "supplier_bill", b.id, reason);
    const now = new Date();
    await tx.update(supplierBills).set({ status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(supplierBills.id, b.id));
    await logTransition(tx, ctx, doc(b), "posted", "voided", reason);
    await audit(tx, ctx, { action: "finance.supplier_bill.reversed", entityType: "supplier_bill", entityId: b.id, entityNumber: b.billNumber, siteId: b.siteId, reason, before: { status: b.status }, after: { status: "voided" } });
    return { status: "voided" };
  });
}

/* ------------------------------------------------------------------ queries */

export async function listSupplierBills(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("finance.supplier_bill.view");
  if (!ctx.allowedSiteIds.length) return [];
  const where = [eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds)];
  if (f.status && BILL_STATUS_LABEL[f.status]) where.push(eq(supplierBills.status, f.status));
  const rows = await db
    .select({ b: supplierBills, supplierName: suppliers.name, receiptNumber: goodsReceipts.receiptNumber })
    .from(supplierBills)
    .innerJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(goodsReceipts, eq(goodsReceipts.id, supplierBills.goodsReceiptId))
    .where(and(...where))
    .orderBy(desc(supplierBills.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r.b, supplierName: r.supplierName, receiptNumber: r.receiptNumber, openAmount: m4(billOpenAmount(r.b)) }));
}

export async function getSupplierBill(ctx: AuthContext, id: string) {
  ctx.require("finance.supplier_bill.view");
  if (!isUuid(id)) throw new DomainError("not_found", "Supplier bill not found in your sites.");
  const [row] = await db
    .select({ b: supplierBills, s: suppliers, gr: goodsReceipts })
    .from(supplierBills)
    .innerJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(goodsReceipts, eq(goodsReceipts.id, supplierBills.goodsReceiptId))
    .where(and(eq(supplierBills.id, id), eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Supplier bill not found in your sites.");
  ctx.requireSite(row.b.siteId);
  const b = row.b;
  const lines = await db.select().from(supplierBillLines).where(eq(supplierBillLines.supplierBillId, b.id)).orderBy(asc(supplierBillLines.lineNo));
  const progress: Progress | null = ["submitted", "approved"].includes(b.status) ? await approvalProgress(db, ctx.organizationId, { recordType: "supplier_bill", recordId: b.id, siteId: b.siteId, basis: { amount: b.totalAmount }, requesterIds: [b.createdBy, b.submittedBy] }) : null;
  const [creditFor] = b.creditForBillId ? await db.select({ id: supplierBills.id, billNumber: supplierBills.billNumber }).from(supplierBills).where(eq(supplierBills.id, b.creditForBillId)).limit(1) : [];
  const credits = await db.select({ id: supplierBills.id, billNumber: supplierBills.billNumber, status: supplierBills.status, total: supplierBills.totalAmount }).from(supplierBills).where(eq(supplierBills.creditForBillId, b.id));
  // W4A supplier returns expecting a credit from this supplier: a dispute can be resolved by entering that credit.
  const source = purchaseOrderMatchSource();
  const expectedSupplierCredits = b.billKind === "bill" && ["draft", "submitted", "disputed", "approved", "posted", "partially_paid"].includes(b.status) && source?.expectedSupplierCredits ? await source.expectedSupplierCredits(db, ctx.organizationId, b.supplierId, ctx.allowedSiteIds) : [];
  return {
    bill: { ...b, openAmount: m4(billOpenAmount(b)) },
    supplier: { id: row.s.id, code: row.s.code, name: row.s.name },
    receipt: row.gr ? { id: row.gr.id, receiptNumber: row.gr.receiptNumber, receivedAt: row.gr.receivedAt } : null,
    lines,
    creditFor: creditFor ?? null,
    credits,
    expectedSupplierCredits,
    progress,
    canApprove: b.status === "submitted" && canDecide(ctx, "supplier_bill", progress, b.submittedAt, [b.createdBy, b.submittedBy], b.siteId) && (!!b.goodsReceiptId || !!b.purchaseOrderId || ctx.hasAnyRole(["finance"])),
    canApproveVariance: b.status === "disputed" && ctx.canAt("finance.supplier_bill.approve", b.siteId) && !ctx.sodConflict(b.createdBy) && !ctx.sodConflict(b.submittedBy),
    posterBlocked: b.status === "approved" && !!progress && !progress.posterMayEqualApprover && progress.approvers.some((u) => ctx.sodConflict(u)),
    decisions: await decisionsOf(db, ctx.organizationId, "supplier_bill", b.id),
    names: Object.fromEntries(await namesOf(db, [b.createdBy, b.submittedBy, b.approvedBy, b.postedBy, b.voidedBy, b.varianceApprovedBy])),
    postings: await postingsOf(db, ctx.organizationId, "supplier_bill", [b.id]),
    history: await transitionsOf(db, "supplier_bill", b.id),
  };
}

/** Everything the bill entry form offers: suppliers, unbilled receipts, non-stock categories, purchase tax codes, bills that can take a credit. */
export async function billFormOptions(ctx: AuthContext) {
  ctx.require("finance.supplier_bill.create");
  const supplierRows = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true))).orderBy(asc(suppliers.name));
  const creditable = ctx.allowedSiteIds.length
    ? await db
        .select({ id: supplierBills.id, billNumber: supplierBills.billNumber, supplierId: supplierBills.supplierId, supplierReference: supplierBills.supplierReference, open: sql<string>`(${supplierBills.totalAmount} - ${supplierBills.paidAmount})::text` })
        .from(supplierBills)
        .where(and(eq(supplierBills.organizationId, ctx.organizationId), inArray(supplierBills.siteId, ctx.allowedSiteIds), inArray(supplierBills.status, ["posted", "partially_paid"]), eq(supplierBills.billKind, "bill")))
        .orderBy(desc(supplierBills.billDate))
        .limit(100)
    : [];
  return {
    suppliers: supplierRows,
    receipts: await billableReceipts(ctx),
    categories: await getSetting(db, ctx.organizationId, "finance.bill.no_po_categories"),
    taxCodes: await taxCodeOptions(db, ctx.organizationId, "purchases"),
    defaultTaxCode: await defaultTaxCode(db, ctx.organizationId, "purchases"),
    creditable,
    poConnected: !!purchaseOrderMatchSource(),
  };
}

/** Posted receipts of the caller's sites with their lines and what is still unbilled (bill form). */
export async function billableReceipts(ctx: AuthContext, q: DbOrTx = db) {
  ctx.require("finance.supplier_bill.create");
  if (!ctx.allowedSiteIds.length) return [];
  const grs = await q
    .select({ g: goodsReceipts, supplierName: suppliers.name })
    .from(goodsReceipts)
    .leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .where(and(eq(goodsReceipts.organizationId, ctx.organizationId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds), eq(goodsReceipts.status, "posted"), sql`${goodsReceipts.supplierId} is not null`))
    .orderBy(desc(goodsReceipts.postedAt))
    .limit(100);
  if (!grs.length) return [];
  const lines = await q
    .select({ l: goodsReceiptLines, code: materials.code, name: materials.name, uom: materials.baseUom })
    .from(goodsReceiptLines)
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .where(inArray(goodsReceiptLines.goodsReceiptId, grs.map((g) => g.g.id)));
  const billed = await q
    .select({ id: supplierBillLines.goodsReceiptLineId, qty: sql<string>`sum(${supplierBillLines.qty})::text` })
    .from(supplierBillLines)
    .innerJoin(supplierBills, eq(supplierBills.id, supplierBillLines.supplierBillId))
    .where(and(inArray(supplierBillLines.goodsReceiptLineId, lines.map((l) => l.l.id)), notInArray(supplierBills.status, ["cancelled", "voided"]), eq(supplierBills.billKind, "bill")))
    .groupBy(supplierBillLines.goodsReceiptLineId);
  return grs
    .map((g) => ({
      id: g.g.id,
      receiptNumber: g.g.receiptNumber,
      supplierId: g.g.supplierId!,
      supplierName: g.supplierName ?? g.g.supplierName,
      receivedAt: g.g.receivedAt,
      lines: lines
        .filter((l) => l.l.goodsReceiptId === g.g.id)
        .map((l) => ({ id: l.l.id, lineNo: l.l.lineNo, material: `${l.code} · ${l.name}`, uom: l.uom, qtyReceived: l.l.qtyBase, qtyUnbilled: m4(D(l.l.qtyBase).minus(billed.find((b) => b.id === l.l.id)?.qty ?? 0)) })),
    }))
    .filter((g) => g.lines.some((l) => D(l.qtyUnbilled).gt(0)));
}
