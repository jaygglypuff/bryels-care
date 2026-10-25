/**
 * Wave 4 W4B fictional demo data (operational finance, ADR-020). Runs inside the ALLOW_DEMO_SEED-guarded
 * seed after every earlier wave. Nothing here is a real rate, customer or supplier:
 *
 * - account finance2@bryels-care.test "Ben Ocampo" (finance, organization-wide; password demo1234): the
 *   second finance person needed for separation of duties (approver ≠ submitter, poster ≠ approver);
 * - tax configuration: FICT-OUT (sales) approved by a second person and FICT-IN (purchases) still pending
 *   review, both flagged FICTIONAL; the default sales tax code is left empty, so quotes, orders and
 *   invoices show no tax line until the company's accountant configures one;
 * - with `documents` (demo; skipped inside vitest, whose tests build their own): invoices on the
 *   dispatched shipments in several states (draft, submitted, approved, issued, partially paid, paid), a
 *   payment applied, a credit note from the W3F customer return, a supplier bill in dispute, a posted
 *   non-stock bill, expense claims (waiting for approval, posted) and a locked accounting period two
 *   months back. Every posted figure has its `financial_postings` row, applications and transition rows,
 *   so the projections reconcile with the ledger.
 */
import Decimal from "decimal.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

const manilaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const addDays = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const atDay = (date: string, hour = 10) => new Date(`${date}T${String(hour - 8).padStart(2, "0")}:00:00Z`);
const m4 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

export async function seedW4b(db: Db, a: { passwordHash: string; documents: boolean }) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const today = manilaDay(new Date());
  const yyyy = today.slice(0, 4);
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const [financeRole] = await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, "finance"))).limit(1);
  let finance2 = await user("finance2@bryels-care.test");
  if (!finance2 && financeRole) {
    const [u] = await db.insert(s.users).values({ organizationId: O, email: "finance2@bryels-care.test", displayName: "Ben Ocampo", passwordHash: a.passwordHash }).returning();
    await db.insert(s.userSiteAssignments).values({ userId: u.id, roleId: financeRole.id, isOrganizationWide: true });
    finance2 = u.id;
  }
  const finance = await user("finance@bryels-care.test");
  if (!finance || !finance2) return;

  // Tax configuration: FICTIONAL placeholders only (US-6-14). One reviewed, one pending accountant review.
  const existingTax = await db.select({ id: s.taxConfigurations.id }).from(s.taxConfigurations).where(eq(s.taxConfigurations.organizationId, O)).limit(1);
  if (!existingTax.length) {
    await db.insert(s.taxConfigurations).values([
      {
        organizationId: O, code: "FICT-OUT", versionNo: 1, name: "Fictional output tax (demo placeholder)", kind: "vat_output", ratePct: "12", inclusive: false, appliesTo: "sales", rounding: "line",
        effectiveFrom: `${yyyy}-01-01`, status: "approved", isFictional: true, sourceNote: "FICTIONAL demo value. Not a real rate: the company's accountant enters and reviews the real configuration.",
        proposedBy: finance, proposedAt: atDay(`${yyyy}-01-02`), reviewedBy: finance2, reviewedAt: atDay(`${yyyy}-01-03`), reviewNote: "FICTIONAL placeholder approved for the demo only; pending the accountant's review.",
      },
      {
        organizationId: O, code: "FICT-IN", versionNo: 1, name: "Fictional input tax (demo placeholder)", kind: "vat_input", ratePct: "12", inclusive: false, appliesTo: "purchases", rounding: "line",
        effectiveFrom: `${yyyy}-01-01`, status: "proposed", isFictional: true, sourceNote: "FICTIONAL demo value awaiting the accountant's review (not effective).", proposedBy: finance, proposedAt: atDay(`${yyyy}-01-02`),
      },
    ]);
  }
  if (!a.documents) return;
  if ((await db.select({ id: s.invoices.id }).from(s.invoices).where(eq(s.invoices.organizationId, O)).limit(1)).length) return;

  const sales = (await user("sales@bryels-care.test"))!;
  const manager = (await user("manager.nfd@bryels-care.test"))!;
  const operator = (await user("operator.nfd@bryels-care.test"))!;
  const warehouse = (await user("warehouse.nfd@bryels-care.test"))!;
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));

  /* ---------------------------------------------------------------- helpers */
  const periodCache = new Map<string, string>();
  const period = async (date: string) => {
    const code = date.slice(0, 7);
    const hit = periodCache.get(code);
    if (hit) return hit;
    const [y, m] = code.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    await db.insert(s.accountingPeriods).values({ organizationId: O, periodCode: code, periodStart: `${code}-01`, periodEnd: `${code}-${String(last).padStart(2, "0")}` }).onConflictDoNothing();
    const [p] = await db.select().from(s.accountingPeriods).where(and(eq(s.accountingPeriods.organizationId, O), eq(s.accountingPeriods.periodCode, code)));
    periodCache.set(code, p.id);
    return p.id;
  };
  const yy = yyyy.slice(2);
  const nextNo = async (type: string, prefix: string, width: number, pattern: "YYYY" | "YY") => {
    const rows = await db.execute<{ value: string }>(sql`
      INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
      VALUES (gen_random_uuid(), ${O}, ${type}, ${prefix}, ${width}, ${yy}, 2)
      ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
      RETURNING (next_value - 1)::text AS value`);
    return `${prefix}-${pattern === "YYYY" ? yyyy : yy}-${String(rows[0].value).padStart(width, "0")}`;
  };
  const transitions = async (documentType: string, documentId: string, siteId: string | null, steps: [string | null, string, string, Date, string?][]) => {
    for (const [from, to, actor, at, reason] of steps) {
      await db.insert(s.financeStateTransitions).values({ organizationId: O, siteId, documentType, documentId, fromState: from, toState: to, actorId: actor, reason: reason ?? null, occurredAt: at, correlationId: uuidv7() });
    }
  };
  const posting = async (p: { siteId: string | null; type: string; docType: string; docId: string; number: string; date: string; amount: string; tax?: string; direction: "debit" | "credit"; customerId?: string | null; supplierId?: string | null; userId?: string | null; by: string }) => {
    await db.insert(s.financialPostings).values({
      organizationId: O, siteId: p.siteId, postingType: p.type, documentType: p.docType, documentId: p.docId, documentNumber: p.number, accountingPeriodId: await period(p.date), postingDate: p.date,
      amount: p.amount, taxAmount: p.tax ?? "0", currency: "PHP", direction: p.direction, customerId: p.customerId ?? null, supplierId: p.supplierId ?? null, counterpartyUserId: p.userId ?? null,
      correlationId: uuidv7(), postedBy: p.by, postedAt: atDay(p.date, 15),
    });
  };
  const decision = (recordType: string, recordId: string, siteId: string | null, step: number, by: string, at: Date) =>
    db.insert(s.approvalDecisions).values({ organizationId: O, siteId, recordType, recordId, step, cycle: 1, decision: "approved", decidedBy: by, decidedAt: at });
  const auditRow = (action: string, entityType: string, entityId: string, entityNumber: string | null, actor: string, siteId: string | null, at: Date, after?: object) =>
    db.insert(s.auditEvents).values({ organizationId: O, siteId, actorId: actor, action, entityType, entityId, entityNumber, after: after ?? null, occurredAt: at });

  /* ---------------------------------------------------------------- invoices (US-6-10) */
  const candidates = await db
    .select({ sh: s.shipments, o: s.salesOrders, c: s.customers })
    .from(s.shipments)
    .innerJoin(s.salesOrders, eq(s.salesOrders.id, s.shipments.salesOrderId))
    .innerJoin(s.customers, eq(s.customers.id, s.salesOrders.customerId))
    .where(and(eq(s.shipments.organizationId, O), inArray(s.shipments.status, ["dispatched", "delivered"]), sql`${s.shipments.dispatchedAt} is not null`))
    .orderBy(asc(s.shipments.dispatchedAt));
  const [ret] = await db.select().from(s.customerReturns).where(and(eq(s.customerReturns.organizationId, O), inArray(s.customerReturns.status, ["approved", "received", "inspected", "closed"]))).limit(1);
  // Oldest shipments get the posted states (so overdue items appear); the returned shipment gets the credit note.
  const plan = ["partially_paid", "issued", "paid", "issued_credit", "approved", "submitted", "draft"] as const;
  const ordered = ret ? [...candidates.filter((c) => c.sh.id !== ret.shipmentId), ...candidates.filter((c) => c.sh.id === ret.shipmentId)] : candidates;
  const picks: { row: (typeof candidates)[number]; state: (typeof plan)[number] }[] = [];
  const creditRow = ret ? candidates.find((c) => c.sh.id === ret.shipmentId) : undefined;
  // Shipments whose invoice would already be past due come first, so the demo shows overdue receivables.
  const dueBy = (c: (typeof candidates)[number]) => addDays(manilaDay(c.sh.dispatchedAt!), c.c.paymentTermsDays ?? 30);
  const others = ordered.filter((c) => c !== creditRow).sort((x, y) => Number(dueBy(y) < today) - Number(dueBy(x) < today));
  for (const st of plan) {
    if (st === "issued_credit") {
      if (creditRow) picks.push({ row: creditRow, state: st });
      continue;
    }
    const next = others.shift();
    if (next) picks.push({ row: next, state: st });
  }

  const invoiceIds: Record<string, string> = {};
  for (const { row, state } of picks) {
    const { sh, o, c } = row;
    const lines = await db
      .select({ l: s.salesOrderLines, sku: s.products.skuCode, name: s.products.name })
      .from(s.salesOrderLines)
      .innerJoin(s.products, eq(s.products.id, s.salesOrderLines.productId))
      .where(eq(s.salesOrderLines.salesOrderId, o.id))
      .orderBy(asc(s.salesOrderLines.lineNo));
    const viaLines = await db.execute<{ id: string; qty: string }>(sql`select sales_order_line_id as id, sum(qty_base)::text as qty from shipment_lines where shipment_id = ${sh.id} and stock_movement_id is not null group by sales_order_line_id`);
    const qtyByLine = new Map<string, Decimal>();
    if (viaLines.length) for (const r of viaLines) qtyByLine.set(r.id, new Decimal(r.qty));
    else {
      const byProduct = await db.execute<{ product_id: string; qty: string }>(sql`
        select l.product_id, sum(m.qty_base)::text as qty from stock_movements m join inventory_lots l on l.id = m.lot_id
        where m.source_document_type = 'shipment' and m.source_document_id = ${sh.id} and m.movement_type = 'shipment'
          and not exists (select 1 from stock_movements r where r.reversal_of_id = m.id) group by l.product_id`);
      for (const r of byProduct) {
        const line = lines.find((x) => x.l.productId === r.product_id);
        if (line) qtyByLine.set(line.l.id, (qtyByLine.get(line.l.id) ?? new Decimal(0)).plus(r.qty));
      }
    }
    const billed = lines.filter((x) => (qtyByLine.get(x.l.id) ?? new Decimal(0)).gt(0));
    if (!billed.length) continue;
    const lineVals = billed.map((x) => new Decimal(qtyByLine.get(x.l.id)!).times(x.l.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    const total = lineVals.reduce((acc, v) => acc.plus(v), new Decimal(0));
    const shipDay = manilaDay(sh.dispatchedAt!);
    const posted = ["partially_paid", "issued", "paid", "issued_credit"].includes(state);
    const terms = c.paymentTermsDays ?? 30;
    const issueDate = posted ? shipDay : null;
    const number = posted ? await nextNo("INV", "INV", 6, "YYYY") : null;
    const invId = uuidv7();
    invoiceIds[state] = invId;
    const created = atDay(shipDay, 11);
    await db.insert(s.invoices).values({
      id: invId, organizationId: O, siteId: sh.siteId, invoiceNumber: number, status: "draft", customerId: c.id, salesOrderId: o.id, shipmentId: sh.id, billToText: c.shipToAddress, customerPoNumber: o.customerPoNumber,
      currency: "PHP", paymentTermsDays: terms, issueDate, dueDate: issueDate ? addDays(issueDate, terms) : null, subtotalAmount: m4(total), taxAmount: "0", totalAmount: m4(total),
      notes: "Fictional demo invoice.", createdBy: sales, createdAt: created,
    });
    await db.insert(s.invoiceLines).values(billed.map((x, i) => ({ invoiceId: invId, lineNo: i + 1, salesOrderLineId: x.l.id, productId: x.l.productId, description: `${x.sku} · ${x.name}`, qty: qtyByLine.get(x.l.id)!.toString(), uom: "pcs", unitAmount: x.l.unitPrice, lineAmount: m4(lineVals[i]), taxAmount: "0", totalAmount: m4(lineVals[i]), currency: "PHP" })));
    const steps: [string | null, string, string, Date, string?][] = [[null, "draft", sales, created]];
    if (state !== "draft") steps.push(["draft", "submitted", sales, atDay(shipDay, 12)]);
    if (["approved", ...["partially_paid", "issued", "paid", "issued_credit"]].includes(state)) {
      steps.push(["submitted", "approved", finance, atDay(shipDay, 13)]);
      await decision("invoice", invId, sh.siteId, 1, finance, atDay(shipDay, 13));
    }
    if (posted) {
      steps.push(["approved", "issued", finance, atDay(shipDay, 15)]);
      await posting({ siteId: sh.siteId, type: "invoice_issue", docType: "invoice", docId: invId, number: number!, date: issueDate!, amount: m4(total), direction: "debit", customerId: c.id, by: finance });
      await auditRow("finance.invoice.posted", "invoice", invId, number, finance, sh.siteId, atDay(shipDay, 15), { invoiceNumber: number, total: m4(total), fictional: true });
    }
    await db
      .update(s.invoices)
      .set({
        status: posted ? "issued" : state,
        submittedBy: state !== "draft" ? sales : null,
        submittedAt: state !== "draft" ? atDay(shipDay, 12) : null,
        approvedBy: steps.some((x) => x[1] === "approved") ? finance : null,
        approvedAt: steps.some((x) => x[1] === "approved") ? atDay(shipDay, 13) : null,
        postedBy: posted ? finance : null,
        postedAt: posted ? atDay(shipDay, 15) : null,
      })
      .where(eq(s.invoices.id, invId));
    await transitions("invoice", invId, sh.siteId, steps);
    if (posted && o.status === "shipped") {
      const [openShipments] = await db.execute<{ n: number }>(sql`select count(*)::int as n from shipments x where x.sales_order_id = ${o.id} and x.status in ('dispatched','delivered') and not exists (select 1 from invoices i where i.shipment_id = x.id and i.status in ('issued','partially_paid','paid','closed'))`);
      if (Number(openShipments.n) === 0) {
        await db.update(s.salesOrders).set({ status: "invoiced", statusChangedAt: atDay(shipDay, 15), statusChangedBy: finance }).where(eq(s.salesOrders.id, o.id));
        await db.insert(s.salesOrderStateTransitions).values({ organizationId: O, siteId: o.siteId, salesOrderId: o.id, fromState: "shipped", toState: "invoiced", actorId: finance, occurredAt: atDay(shipDay, 15), correlationId: uuidv7() });
      }
    }

    // Payments (R-06): full payment, or about half, recorded by finance after finance2 approved it.
    if (state === "paid" || state === "partially_paid") {
      const amount = state === "paid" ? total : total.div(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const paidOn = addDays(issueDate!, state === "paid" ? 12 : 5) > today ? today : addDays(issueDate!, state === "paid" ? 12 : 5);
      const payId = uuidv7();
      const payNo = await nextNo("PAY", "PAY", 6, "YY");
      await db.insert(s.paymentRecords).values({
        id: payId, organizationId: O, siteId: sh.siteId, paymentNumber: payNo, direction: "inbound", status: "recorded", customerId: c.id, method: state === "paid" ? "bank_transfer" : "cash",
        reference: state === "paid" ? "Fictional deposit slip 0042" : "OR-DEMO-117", bankReference: state === "paid" ? "DEMO-BANK-REF-8831" : null, paidOn, amount: m4(amount), appliedAmount: m4(amount), currency: "PHP",
        applicationPlan: [{ documentType: "invoice", documentId: invId, amount: m4(amount) }], notes: "Fictional demo payment.", createdBy: finance, submittedBy: finance, submittedAt: atDay(paidOn, 9),
        approvedBy: finance2, approvedAt: atDay(paidOn, 10), postedBy: finance, postedAt: atDay(paidOn, 11), createdAt: atDay(paidOn, 9),
      });
      await decision("payment_record", payId, sh.siteId, 1, finance2, atDay(paidOn, 10));
      await transitions("payment_record", payId, sh.siteId, [[null, "draft", finance, atDay(paidOn, 9)], ["draft", "submitted", finance, atDay(paidOn, 9)], ["submitted", "approved", finance2, atDay(paidOn, 10)], ["approved", "recorded", finance, atDay(paidOn, 11)]]);
      await posting({ siteId: sh.siteId, type: "payment", docType: "payment_record", docId: payId, number: payNo, date: paidOn, amount: m4(amount), direction: "debit", customerId: c.id, by: finance });
      await db.insert(s.paymentApplications).values({ organizationId: O, siteId: sh.siteId, paymentRecordId: payId, invoiceId: invId, appliedAmount: m4(amount), currency: "PHP", appliedOn: paidOn, createdBy: finance, createdAt: atDay(paidOn, 11) });
      const to = amount.gte(total) ? "paid" : "partially_paid";
      await db.update(s.invoices).set({ paidAmount: m4(amount), status: to }).where(eq(s.invoices.id, invId));
      await transitions("invoice", invId, sh.siteId, [["issued", to, finance, atDay(paidOn, 11), `Payment ${payNo}`]]);
      await auditRow("finance.payment_record.posted", "payment_record", payId, payNo, finance, sh.siteId, atDay(paidOn, 11), { amount: m4(amount), invoiceNumber: number, fictional: true });
    }

    // Credit note from the W3F customer return (R-07): returned qty × invoice unit price, issued and applied.
    if (state === "issued_credit" && ret) {
      const retLines = await db.select().from(s.customerReturnLines).where(eq(s.customerReturnLines.customerReturnId, ret.id));
      let credit = new Decimal(0);
      for (const r of retLines) {
        const l = billed.find((x) => x.l.productId === r.productId);
        if (l) credit = credit.plus(new Decimal(r.qtyBase).times(l.l.unitPrice));
      }
      credit = Decimal.min(credit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), total);
      if (credit.gt(0)) {
        const cnId = uuidv7();
        const cnNo = await nextNo("CN", "CN", 5, "YYYY");
        const cnDay = manilaDay(ret.receivedAt ?? new Date()) < issueDate! ? issueDate! : manilaDay(ret.receivedAt ?? new Date());
        await db.insert(s.creditNotes).values({
          id: cnId, organizationId: O, siteId: sh.siteId, creditNoteNumber: cnNo, status: "applied", invoiceId: invId, customerId: c.id, customerReturnId: ret.id, reasonCode: "goods_returned", reason: `Customer return ${ret.returnNumber} (fictional)`,
          amount: m4(credit), taxAmount: "0", currency: "PHP", issueDate: cnDay, createdBy: sales, submittedBy: sales, submittedAt: atDay(cnDay, 9), approvedBy: finance, approvedAt: atDay(cnDay, 10), postedBy: finance, postedAt: atDay(cnDay, 11), createdAt: atDay(cnDay, 9),
        });
        await decision("credit_note", cnId, sh.siteId, 1, finance, atDay(cnDay, 10));
        await transitions("credit_note", cnId, sh.siteId, [[null, "draft", sales, atDay(cnDay, 9)], ["draft", "submitted", sales, atDay(cnDay, 9)], ["submitted", "approved", finance, atDay(cnDay, 10)], ["approved", "issued", finance, atDay(cnDay, 11)], ["issued", "applied", finance, atDay(cnDay, 11)]]);
        await posting({ siteId: sh.siteId, type: "credit_note", docType: "credit_note", docId: cnId, number: cnNo, date: cnDay, amount: m4(credit), direction: "credit", customerId: c.id, by: finance });
        const to = credit.gte(total) ? "paid" : "partially_paid";
        await db.update(s.invoices).set({ creditedAmount: m4(credit), status: to }).where(eq(s.invoices.id, invId));
        await transitions("invoice", invId, sh.siteId, [["issued", to, finance, atDay(cnDay, 11), `Credit note ${cnNo}`]]);
        await auditRow("finance.credit_note.posted", "credit_note", cnId, cnNo, finance, sh.siteId, atDay(cnDay, 11), { amount: m4(credit), invoiceNumber: number, fictional: true });
      } else {
        await db.update(s.invoices).set({ status: "issued" }).where(eq(s.invoices.id, invId));
      }
    } else if (state === "issued_credit") {
      await db.update(s.invoices).set({ status: "issued" }).where(eq(s.invoices.id, invId));
    }
  }

  /* ---------------------------------------------------------------- supplier bills (US-6-11) */
  const [gr] = await db
    .select({ g: s.goodsReceipts, supplierName: s.suppliers.name, terms: s.suppliers.paymentTermsDays })
    .from(s.goodsReceipts)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.goodsReceipts.supplierId))
    .where(and(eq(s.goodsReceipts.organizationId, O), eq(s.goodsReceipts.siteId, nfd.id), eq(s.goodsReceipts.status, "posted")))
    .orderBy(asc(s.goodsReceipts.postedAt))
    .limit(1);
  if (gr) {
    const [line] = await db.select({ l: s.goodsReceiptLines, code: s.materials.code, name: s.materials.name, uom: s.materials.baseUom }).from(s.goodsReceiptLines).innerJoin(s.materials, eq(s.materials.id, s.goodsReceiptLines.materialId)).where(eq(s.goodsReceiptLines.goodsReceiptId, gr.g.id)).limit(1);
    if (line) {
      // Billed 10 % more than received: the three-way match parks the bill in dispute (P-02/P-03).
      const qty = new Decimal(line.l.qtyBase).times("1.1").toDecimalPlaces(0);
      const unit = new Decimal("0.18");
      const amount = qty.times(unit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const billId = uuidv7();
      const billNo = await nextNo("BILL", "BILL", 5, "YY");
      const billDate = manilaDay(gr.g.postedAt ?? new Date());
      await db.insert(s.supplierBills).values({
        id: billId, organizationId: O, siteId: nfd.id, billNumber: billNo, status: "disputed", supplierId: gr.g.supplierId!, supplierReference: "SI-DEMO-55021", goodsReceiptId: gr.g.id, billDate, paymentTermsDays: gr.terms,
        currency: "PHP", subtotalAmount: m4(amount), totalAmount: m4(amount), notes: "Fictional demo bill: the supplier billed more than was received.", createdBy: finance2, submittedBy: finance2, submittedAt: atDay(today, 9),
        matchSummary: { at: new Date().toISOString(), variance: true, tolerances: { qtyPct: 0, pricePct: 2, priceAmount: 100 }, poSource: false, lines: [{ lineNo: 1, result: "qty_variance" }] },
      });
      await db.insert(s.supplierBillLines).values({
        supplierBillId: billId, lineNo: 1, chargeKind: "goods", materialId: line.l.materialId, goodsReceiptLineId: line.l.id, description: `${line.code} · ${line.name}`, qty: qty.toString(), uom: line.uom, unitAmount: m4(unit), lineAmount: m4(amount), currency: "PHP",
        matchResult: "qty_variance", matchDetail: { receivedQty: line.l.qtyBase, billedElsewhere: "0", billQty: qty.toString() },
      });
      await transitions("supplier_bill", billId, nfd.id, [[null, "draft", finance2, atDay(today, 8)], ["draft", "disputed", finance2, atDay(today, 9), "Three-way match variance beyond tolerance"]]);
    }
    // A posted non-stock bill (A-FIN-09 category "services"), dated last week.
    const billDate = addDays(today, -7);
    const svcId = uuidv7();
    const svcNo = await nextNo("BILL", "BILL", 5, "YY");
    const terms = gr.terms ?? 30;
    await db.insert(s.supplierBills).values({
      id: svcId, organizationId: O, siteId: nfd.id, billNumber: svcNo, status: "posted", supplierId: gr.g.supplierId!, supplierReference: "SVC-DEMO-0907", categoryCode: "services", billDate, dueDate: addDays(billDate, terms), paymentTermsDays: terms,
      currency: "PHP", subtotalAmount: "3500.0000", totalAmount: "3500.0000", notes: "Fictional demo: tank cleaning service, no PO.", createdBy: finance2, submittedBy: finance2, submittedAt: atDay(billDate, 9), approvedBy: finance, approvedAt: atDay(billDate, 10), postedBy: finance, postedAt: atDay(billDate, 11),
    });
    await db.insert(s.supplierBillLines).values({ supplierBillId: svcId, lineNo: 1, chargeKind: "other", description: "Tank cleaning service (fictional)", qty: "1", unitAmount: "3500.0000", lineAmount: "3500.0000", currency: "PHP", matchResult: "no_po", matchDetail: { note: "Non-stock category services (A-FIN-09)." } });
    await decision("supplier_bill", svcId, nfd.id, 1, finance, atDay(billDate, 10));
    await transitions("supplier_bill", svcId, nfd.id, [[null, "draft", finance2, atDay(billDate, 8)], ["draft", "submitted", finance2, atDay(billDate, 9)], ["submitted", "approved", finance, atDay(billDate, 10)], ["approved", "posted", finance, atDay(billDate, 11)]]);
    await posting({ siteId: nfd.id, type: "bill_post", docType: "supplier_bill", docId: svcId, number: svcNo, date: billDate, amount: "3500.0000", direction: "credit", supplierId: gr.g.supplierId, by: finance });
  }

  /* ---------------------------------------------------------------- expense claims (US-6-12) */
  const exp1 = uuidv7();
  const exp1No = await nextNo("EXP", "EXP", 5, "YY");
  await db.insert(s.expenseClaims).values({ id: exp1, organizationId: O, siteId: nfd.id, claimNumber: exp1No, status: "submitted", claimantUserId: operator, categoryCode: "travel", description: "Fictional: tricycle fares to the supplier for a sample pick-up", expenseDate: addDays(today, -2), amount: "350.0000", currency: "PHP", submittedAt: atDay(addDays(today, -1), 9), createdAt: atDay(addDays(today, -1), 8) });
  await transitions("expense_claim", exp1, nfd.id, [[null, "draft", operator, atDay(addDays(today, -1), 8)], ["draft", "submitted", operator, atDay(addDays(today, -1), 9)]]);
  const exp2 = uuidv7();
  const exp2No = await nextNo("EXP", "EXP", 5, "YY");
  const e2Day = addDays(today, -6);
  await db.insert(s.expenseClaims).values({ id: exp2, organizationId: O, siteId: nfd.id, claimNumber: exp2No, status: "posted", claimantUserId: warehouse, categoryCode: "supplies", description: "Fictional: pallet wrap and marker pens", expenseDate: addDays(e2Day, -1), amount: "480.0000", currency: "PHP", submittedAt: atDay(e2Day, 9), approvedBy: manager, approvedAt: atDay(e2Day, 11), postedBy: finance, postedAt: atDay(e2Day, 14), createdAt: atDay(e2Day, 8) });
  await decision("expense_claim", exp2, nfd.id, 1, manager, atDay(e2Day, 11));
  await transitions("expense_claim", exp2, nfd.id, [[null, "draft", warehouse, atDay(e2Day, 8)], ["draft", "submitted", warehouse, atDay(e2Day, 9)], ["submitted", "approved", manager, atDay(e2Day, 11)], ["approved", "posted", finance, atDay(e2Day, 14)]]);
  await posting({ siteId: nfd.id, type: "expense", docType: "expense_claim", docId: exp2, number: exp2No, date: e2Day, amount: "480.0000", direction: "debit", userId: warehouse, by: finance });

  /* ---------------------------------------------------------------- a locked period (US-6-13) */
  const [y, m] = today.split("-").map(Number);
  const twoBack = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
  const pid = await period(twoBack);
  await db.update(s.accountingPeriods).set({ status: "locked", lockedBy: finance, lockedAt: atDay(addDays(twoBack, 40), 17), lockReason: "Month-end close after the accountant export (fictional demo)" }).where(eq(s.accountingPeriods.id, pid));
  await auditRow("finance.accounting_period.locked", "accounting_period", pid, twoBack.slice(0, 7), finance, null, atDay(addDays(twoBack, 40), 17), { status: "locked", fictional: true });
  console.log(`W4B seed: ${picks.length} invoices, tax placeholders, bills, expense claims, period ${twoBack.slice(0, 7)} locked.`);
}
