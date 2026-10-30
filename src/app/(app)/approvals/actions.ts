"use server";
import { requireContext, type AuthContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { refreshActionItems } from "@/modules/action-centre";
import { decideExpenseClaim, approveInvoice, returnInvoice } from "@/modules/finance";
import { approveImport, rejectImport } from "@/modules/imports";
import { approveAdjustment, rejectAdjustment } from "@/modules/inventory";
import { decidePurchaseOrder, decidePurchaseRequest, decideSupplierReturn } from "@/modules/procurement";
import { approveProductionOrder, type ApproveResult } from "@/modules/production";
import { decideChangeControl } from "@/modules/quality";
import { approveCustomerReturn, approveOrder, approvePriceList, approveQuote, approveRequirement, rejectPriceList, rejectRequirement, returnOrderToDraft, returnQuoteToDraft } from "@/modules/sales";
import { INLINE_DECISIONS } from "./inline";

/**
 * Approve / reject from the "To approve" list (ADR-075). Thin adapters over the existing module
 * decisions: each service checks the permission at the record's site, the same-person rules and
 * the approval steps exactly as on the record's own page. Kinds without an entry here are decided
 * on their own page (they need a password, a measured value or a longer form).
 */
type Decide = (ctx: AuthContext, id: string, note: string | null, idempotencyKey: string | null) => Promise<unknown>;

const APPROVE: Record<string, Decide> = {
  "approval.stock_adjustment": (ctx, id, note) => approveAdjustment(ctx, id, note),
  "approval.purchase_request": (ctx, id, note) => decidePurchaseRequest(ctx, { requestId: id, decision: "approve", note }),
  "approval.purchase_order": (ctx, id, note) => decidePurchaseOrder(ctx, { purchaseOrderId: id, decision: "approve", note }),
  "approval.supplier_return": (ctx, id, note) => decideSupplierReturn(ctx, { returnId: id, decision: "approve", note }),
  "approval.sales_order": (ctx, id, note) => approveOrder(ctx, id, { note }),
  "approval.quote": (ctx, id, note) => approveQuote(ctx, id, note),
  "approval.price_list": (ctx, id, note) => approvePriceList(ctx, id, note),
  "approval.customer_requirement": (ctx, id, note) => approveRequirement(ctx, id, note),
  "approval.customer_return": (ctx, id, note) => approveCustomerReturn(ctx, { returnId: id, note }),
  "approval.invoice": (ctx, id, note) => approveInvoice(ctx, id, note),
  "approval.expense_claim": (ctx, id, note) => decideExpenseClaim(ctx, id, { decision: "approved", note }),
  "approval.change_control": (ctx, id, note) => decideChangeControl(ctx, { changeControlId: id, decision: "approved", note }),
  "approval.import_job": (ctx, id, note) => approveImport(ctx, id, note),
  // Approve = plan + release + reserve + create the batches (one transaction, idempotent per form).
  "approval.production_order": (ctx, id, note, key) => approveProductionOrder(ctx, id, { note, idempotencyKey: key ? `to-approve:${key}` : null }),
};

/** Plain result for kinds whose approval does more than change a status. */
function approvedMessage(kind: string, result: unknown): string {
  if (kind === "approval.production_order" && result && typeof result === "object" && "batches" in result) {
    const r = result as ApproveResult;
    const made = r.batches.length ? ` Batch${r.batches.length === 1 ? "" : "es"} ${r.batches.map((b) => b.batchNumber).join(", ")} ready to make.` : "";
    return `Production order ${r.workOrderNumber} approved.${made}${r.shortages.length ? ` Short: ${r.shortages.join(" ")}` : ""}`;
  }
  return "Approved.";
}

const REJECT: Record<string, Decide> = {
  "approval.stock_adjustment": (ctx, id, reason) => rejectAdjustment(ctx, id, reason ?? ""),
  "approval.purchase_request": (ctx, id, reason) => decidePurchaseRequest(ctx, { requestId: id, decision: "reject", note: reason }),
  "approval.purchase_order": (ctx, id, reason) => decidePurchaseOrder(ctx, { purchaseOrderId: id, decision: "return", note: reason }),
  "approval.supplier_return": (ctx, id, reason) => decideSupplierReturn(ctx, { returnId: id, decision: "return", note: reason }),
  "approval.sales_order": (ctx, id, reason) => returnOrderToDraft(ctx, id, reason ?? ""),
  "approval.quote": (ctx, id, reason) => returnQuoteToDraft(ctx, id, reason ?? ""),
  "approval.price_list": (ctx, id, reason) => rejectPriceList(ctx, id, reason ?? ""),
  "approval.customer_requirement": (ctx, id, reason) => rejectRequirement(ctx, id, reason ?? ""),
  "approval.invoice": (ctx, id, reason) => returnInvoice(ctx, id, reason ?? ""),
  "approval.expense_claim": (ctx, id, reason) => decideExpenseClaim(ctx, id, { decision: "rejected", note: reason }),
  "approval.change_control": (ctx, id, reason) => decideChangeControl(ctx, { changeControlId: id, decision: "rejected", note: reason }),
  "approval.import_job": (ctx, id, reason) => rejectImport(ctx, id, reason ?? ""),
};

export async function decideApprovalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const kind = String(fd.get("kind") ?? "");
  const id = String(fd.get("entityId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "").trim() || null;
  const fn = decision === "approve" ? APPROVE[kind] : decision === "reject" ? REJECT[kind] : undefined;
  const label = INLINE_DECISIONS[kind];
  if (!fn || !label) return { ok: false, message: "Open the record to decide this one." };
  if (decision === "reject" && (!note || note.length < 3)) return { ok: false, message: "Say why (at least 3 characters).", fieldErrors: { note: "Say why (at least 3 characters)." } };
  let ctx: AuthContext;
  let result: unknown;
  try {
    ctx = await requireContext();
    result = await fn(ctx, id, note, idempotencyKey);
  } catch (e) {
    return toActionState(e);
  }
  // The decided item leaves the list at once (the sweep would clear it within 5 minutes anyway).
  await refreshActionItems(ctx.organizationId).catch(() => null);
  refreshCurrentPage();
  return { ok: true, message: decision === "approve" ? approvedMessage(kind, result) : `${label.reject}: done.` };
}
