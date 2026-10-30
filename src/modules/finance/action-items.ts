import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fmtMoney } from "@/lib/qty";
import { businessDate } from "./shared";

/** ₱12,768.00 for pesos; other currencies keep their code ("USD 1,200.00"). */
const money = (v: string, currency: unknown) => (String(currency ?? "PHP") === "PHP" ? fmtMoney(v) : `${currency} ${fmtMoney(v).slice(1)}`);

/**
 * Finance conditions for the action centre (US-5-06 queue; registered in src/modules/wiring.ts): invoices
 * waiting for approval, overdue invoices (R-09: issued or partly paid past the due date), supplier bills in
 * dispute and expense claims waiting for approval. Each returns what needs action now; an item clears as soon
 * as its record stops matching. Visibility per item is the kind's permission at the item's site.
 */

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const at = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export async function invoicesToApprove(org: string) {
  const rows = await run(sql`
    select i.id, i.site_id, i.total_amount, i.currency, coalesce(i.submitted_at, i.created_at) as at, c.name as customer, s.shipment_number, s.delivery_receipt_number
    from invoices i join customers c on c.id = i.customer_id join shipments s on s.id = i.shipment_id
    where i.organization_id = ${org}::uuid and i.status = 'submitted'`);
  return rows.map((r) => ({
    kind: "approval.invoice",
    siteId: String(r.site_id),
    entityType: "invoice",
    entityId: String(r.id),
    recordNumber: String(r.shipment_number ?? r.delivery_receipt_number ?? ""),
    title: `Invoice for ${r.customer} waits for approval`,
    detail: `${money(String(r.total_amount), r.currency)}`,
    link: `/finance/invoices/${r.id}`,
    openedAt: at(r.at),
  }));
}

export async function overdueInvoices(org: string, now: Date) {
  const today = businessDate(now);
  const rows = await run(sql`
    select i.id, i.site_id, i.invoice_number, i.due_date::text as due, i.total_amount - i.paid_amount - i.credited_amount as open, i.currency, c.name as customer
    from invoices i join customers c on c.id = i.customer_id
    where i.organization_id = ${org}::uuid and i.status in ('issued','partially_paid') and i.due_date < ${today}::date`);
  return rows.map((r) => ({
    kind: "overdue_invoice",
    siteId: String(r.site_id),
    entityType: "invoice",
    entityId: String(r.id),
    recordNumber: String(r.invoice_number),
    title: `Invoice ${r.invoice_number} (${r.customer}) is overdue`,
    detail: `${money(String(r.open), r.currency)} open, due ${r.due}`,
    link: `/finance/invoices/${r.id}`,
    openedAt: at(`${r.due}T00:00:00+08:00`),
  }));
}

export async function disputedBills(org: string) {
  const rows = await run(sql`
    select b.id, b.site_id, b.bill_number, b.supplier_reference, b.total_amount, b.currency, b.updated_at as at, s.name as supplier
    from supplier_bills b join suppliers s on s.id = b.supplier_id
    where b.organization_id = ${org}::uuid and b.status = 'disputed'`);
  return rows.map((r) => ({
    kind: "disputed_bill",
    siteId: String(r.site_id),
    entityType: "supplier_bill",
    entityId: String(r.id),
    recordNumber: String(r.bill_number),
    title: `Bill ${r.bill_number} from ${r.supplier} is in dispute`,
    detail: `Supplier ref. ${r.supplier_reference} · ${money(String(r.total_amount), r.currency)}`,
    link: `/finance/bills/${r.id}`,
    openedAt: at(r.at),
  }));
}

export async function expenseClaimsToApprove(org: string) {
  const rows = await run(sql`
    select e.id, e.site_id, e.claim_number, e.amount, e.currency, coalesce(e.submitted_at, e.created_at) as at, u.display_name as claimant
    from expense_claims e join users u on u.id = e.claimant_user_id
    where e.organization_id = ${org}::uuid and e.status = 'submitted'`);
  return rows.map((r) => ({
    kind: "approval.expense_claim",
    siteId: String(r.site_id),
    entityType: "expense_claim",
    entityId: String(r.id),
    recordNumber: String(r.claim_number),
    title: `Expense claim ${r.claim_number} (${r.claimant}) waits for approval`,
    detail: `${money(String(r.amount), r.currency)}`,
    link: `/finance/expenses/${r.id}`,
    openedAt: at(r.at),
  }));
}
