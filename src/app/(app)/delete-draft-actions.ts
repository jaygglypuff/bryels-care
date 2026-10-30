"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext, type AuthContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { deleteDraftAdjustment } from "@/modules/inventory";
import { deleteFormulaDraft, deleteInspectionPlanDraft, deleteMaterial, deleteProduct, deleteRoutingDraft, deleteSupplier, deleteWorkInstructionDraft } from "@/modules/masterdata";
import { deletePurchaseOrderDraft, deletePurchaseRequestDraft } from "@/modules/procurement";
import { deleteCustomer, deleteDraftOrder, deleteDraftPriceList, deleteDraftQuote } from "@/modules/sales";

/**
 * "Delete draft" (ADR-075): one thin adapter for every record kind. The service checks the state
 * (never-submitted draft, nothing depends on it), who may delete (creator or editor) and the site,
 * deletes in one transaction and writes the audit event; this action only routes and redirects to
 * the list (or to the parent record that still exists).
 */
type Handler = (ctx: AuthContext, id: string) => Promise<string>;

const HANDLERS: Record<string, Handler> = {
  material: async (ctx, id) => (await deleteMaterial(ctx, id), "/masterdata/materials?deleted=1"),
  product: async (ctx, id) => (await deleteProduct(ctx, id), "/masterdata/products?deleted=1"),
  supplier: async (ctx, id) => (await deleteSupplier(ctx, id), "/masterdata/suppliers?deleted=1"),
  customer: async (ctx, id) => (await deleteCustomer(ctx, id), "/sales/customers?deleted=1"),
  formula_revision: async (ctx, id) => {
    const r = await deleteFormulaDraft(ctx, id);
    return r.formulaId ? `/masterdata/formulas/${r.formulaId}?deleted=1` : "/masterdata/formulas?deleted=1";
  },
  routing_revision: async (ctx, id) => {
    const r = await deleteRoutingDraft(ctx, id);
    return r.routingId ? `/masterdata/routings/${r.routingId}?deleted=1` : "/masterdata/routings?deleted=1";
  },
  work_instruction_revision: async (ctx, id) => {
    const r = await deleteWorkInstructionDraft(ctx, id);
    return r.workInstructionId ? `/masterdata/work-instructions/${r.workInstructionId}?deleted=1` : "/masterdata/work-instructions?deleted=1";
  },
  inspection_plan: async (ctx, id) => {
    const r = await deleteInspectionPlanDraft(ctx, id);
    return r.previousPlanId ? `/masterdata/inspection-plans/${r.previousPlanId}?deleted=1` : "/masterdata/inspection-plans?deleted=1";
  },
  purchase_request: async (ctx, id) => (await deletePurchaseRequestDraft(ctx, { requestId: id }), "/procurement/requests?deleted=1"),
  purchase_order: async (ctx, id) => (await deletePurchaseOrderDraft(ctx, { purchaseOrderId: id }), "/procurement/orders?deleted=1"),
  sales_order: async (ctx, id) => (await deleteDraftOrder(ctx, id), "/sales?deleted=1"),
  quote: async (ctx, id) => (await deleteDraftQuote(ctx, id), "/sales/quotations?deleted=1"),
  price_list: async (ctx, id) => {
    const r = await deleteDraftPriceList(ctx, id);
    return r.previousId ? `/sales/price-lists/${r.previousId}?deleted=1` : "/sales/price-lists?deleted=1";
  },
  stock_adjustment: async (ctx, id) => (await deleteDraftAdjustment(ctx, id), "/inventory/adjustments?deleted=1"),
};

export async function deleteDraftAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const kind = String(fd.get("kind") ?? "");
  const id = String(fd.get("id") ?? "");
  const handler = HANDLERS[kind];
  if (!handler) return { ok: false, message: "This record cannot be deleted here." };
  let target: string;
  try {
    const ctx = await requireContext();
    target = await handler(ctx, id);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/", "layout");
  redirect(target);
}
