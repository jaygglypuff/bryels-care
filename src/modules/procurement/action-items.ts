import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Candidate } from "@/modules/action-centre";
import { getSetting } from "@/lib/settings";

/**
 * Action-centre sources of the procurement module (US-5-06 plug-in, registered in src/modules/wiring.ts):
 * approvals waiting (PO, PR, supplier return, ASL proposal), late purchase orders (past the promised or
 * expected date + `procurement.purchase_order.late_grace_days`) and over-deliveries waiting for
 * procurement's CX-QTY decision. Each item clears when its record stops matching.
 */

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const d = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export async function poApprovalCandidates(org: string): Promise<Candidate[]> {
  return (await run(sql`select id, site_id, po_number, coalesce(submitted_at, created_at) as at from purchase_orders where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
    kind: "approval.purchase_order", siteId: String(r.site_id), entityType: "purchase_order", entityId: String(r.id), recordNumber: String(r.po_number),
    title: `Purchase order ${r.po_number} waits for approval`, detail: null, link: `/procurement/orders/${r.id}`, openedAt: d(r.at),
  }));
}

export async function prApprovalCandidates(org: string): Promise<Candidate[]> {
  return (await run(sql`select id, site_id, request_number, coalesce(submitted_at, created_at) as at from purchase_requests where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
    kind: "approval.purchase_request", siteId: String(r.site_id), entityType: "purchase_request", entityId: String(r.id), recordNumber: String(r.request_number),
    title: `Purchase request ${r.request_number} waits for approval`, detail: null, link: `/procurement/requests/${r.id}`, openedAt: d(r.at),
  }));
}

export async function srApprovalCandidates(org: string): Promise<Candidate[]> {
  return (await run(sql`select id, site_id, return_number, coalesce(submitted_at, created_at) as at from supplier_returns where organization_id = ${org}::uuid and status = 'submitted'`)).map((r) => ({
    kind: "approval.supplier_return", siteId: String(r.site_id), entityType: "supplier_return", entityId: String(r.id), recordNumber: String(r.return_number),
    title: `Supplier return ${r.return_number} waits for approval`, detail: null, link: `/procurement/returns/${r.id}`, openedAt: d(r.at),
  }));
}

export async function aslApprovalCandidates(org: string): Promise<Candidate[]> {
  return (
    await run(sql`select c.id, c.action, c.proposed_at as at, s.id as supplier_id, s.code as supplier_code, m.code as material_code
      from supplier_material_changes c join supplier_materials sm on sm.id = c.supplier_material_id
      join suppliers s on s.id = sm.supplier_id join materials m on m.id = sm.material_id
     where c.organization_id = ${org}::uuid and c.status = 'pending'`)
  ).map((r) => ({
    kind: "approval.asl_change", siteId: null, entityType: "supplier_material_change", entityId: String(r.id), recordNumber: `${r.supplier_code} × ${r.material_code}`,
    title: `${r.action === "suspend" ? "Suspension" : "Approved-list entry"} ${r.supplier_code} × ${r.material_code} waits for QA`, detail: null, link: `/procurement/suppliers/${r.supplier_id}`, openedAt: d(r.at),
  }));
}

export async function latePoCandidates(org: string, now: Date): Promise<Candidate[]> {
  const grace = await getSetting(db, org, "procurement.purchase_order.late_grace_days");
  return (
    await run(sql`select po.id, po.site_id, po.po_number, s.name as supplier, coalesce(po.promised_date, po.expected_date) as due
      from purchase_orders po join suppliers s on s.id = po.supplier_id
     where po.organization_id = ${org}::uuid and po.status in ('sent', 'partially_received')
       and coalesce(po.promised_date, po.expected_date) is not null
       and coalesce(po.promised_date, po.expected_date) + ${grace}::int < ${today(now)}::date`)
  ).map((r) => ({
    kind: "late_purchase_order", siteId: String(r.site_id), entityType: "purchase_order", entityId: String(r.id), recordNumber: String(r.po_number),
    title: `Purchase order ${r.po_number} from ${r.supplier} is late`, detail: `Due ${String(r.due).slice(0, 10)}; chase the supplier or short-close.`, link: `/procurement/orders/${r.id}`, openedAt: d(r.due),
  }));
}

export async function overDeliveryCandidates(org: string): Promise<Candidate[]> {
  return (
    await run(sql`select g.id, g.site_id, g.supplier_name, min(l.discrepancy_recorded_at) as at, count(*)::int as n
      from goods_receipt_lines l join goods_receipts g on g.id = l.goods_receipt_id
     where g.organization_id = ${org}::uuid and g.status = 'draft' and l.discrepancy_kind in ('over', 'wrong_item') and l.discrepancy_approved_by is null
     group by g.id, g.site_id, g.supplier_name`)
  ).map((r) => ({
    kind: "over_delivery", siteId: String(r.site_id), entityType: "goods_receipt", entityId: String(r.id), recordNumber: null,
    title: `Delivery from ${r.supplier_name} has ${r.n} line(s) over the PO or not on it`, detail: "Approve the discrepancy (CX-QTY) or correct the receipt before it posts.", link: `/inventory/receive/${r.id}`, openedAt: d(r.at ?? new Date()),
  }));
}
