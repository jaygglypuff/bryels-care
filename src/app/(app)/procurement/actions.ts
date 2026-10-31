"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  acceptReorderSuggestion,
  addSupplierReturnLine,
  cancelPurchaseOrder,
  cancelPurchaseRequest,
  cancelSupplierReturn,
  closePurchaseOrder,
  computeReorderSuggestions,
  createPurchaseOrder,
  createPurchaseRequest,
  createSupplierReturn,
  decideAslChange,
  decideForecastOverride,
  decidePurchaseOrder,
  decidePurchaseRequest,
  decideSupplierReturn,
  dismissReorderSuggestion,
  postSupplierReturn,
  proposeAslChange,
  proposeSupplierMaterial,
  receiveAgainstPurchaseOrder,
  recordSupplierConfirmation,
  regeneratePoDocument,
  removeSupplierReturnLine,
  saveReorderPolicy,
  sendPurchaseOrder,
  shortClosePoLine,
  submitForecastOverride,
  submitPurchaseOrder,
  submitPurchaseRequest,
  submitSupplierReturn,
  updateSupplierTerms,
  updateSupplierMaterialPack,
  withdrawAslChange,
} from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import type { DiscrepancyKind } from "@/modules/inventory";
import { normalizeUnit, parseQtyText, toBaseQty } from "@/lib/units";
import { DomainError } from "@/lib/errors";

/*
 * Procurement server actions (Wave 4 W4A). Thin adapters: read the form, call the service with the
 * caller's AuthContext, then redirect (create) or re-render the current page in the response
 * (ADR-043 `refreshCurrentPage`). Every rule is in src/modules/procurement.
 */

registerAppHooks(); // PO receiving hooks (src/modules/wiring.ts); cheap and idempotent

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

/** Rows named `lines.<n>.<field>`; rows whose `key` field is blank are skipped. */
function rows(fd: FormData, key: string): Record<string, string>[] {
  const out = new Map<number, Record<string, string>>();
  for (const [k, v] of fd.entries()) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
    if (!m || typeof v !== "string") continue;
    const i = Number(m[1]);
    out.set(i, { ...(out.get(i) ?? {}), [m[2]]: v });
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r).filter((r) => (r[key] ?? "").trim() !== "");
}

/**
 * Friendly quantity box (src/ui/qty-unit-input.tsx): "20 kg" typed in the box wins over the unit picker.
 * Only splits the text; the service converts and refuses units that do not fit the item (V-UOM).
 */
function qtyAndUnit(qty: string | undefined, uom: string | undefined): { qty: string; uom: string | null } {
  const p = parseQtyText(qty);
  if (!p) return { qty: qty ?? "", uom: uom || null };
  const typed = p.unit ? normalizeUnit(p.unit) ?? p.unit : null;
  return { qty: p.qty, uom: typed ?? (uom || null) };
}

/** Friendly amount ("25 kg", or 25 + picker kg) → base-unit text for services that take base quantities. */
function baseText(fd: FormData, field: string): string | null {
  const text = opt(fd, field);
  if (text === null) return null;
  const base = opt(fd, "baseUom");
  if (!base) return text;
  const r = toBaseQty(text, opt(fd, `${field}Unit`), base);
  if (!r.ok) throw new DomainError("validation", r.message, { field });
  return r.qtyBase.toString();
}

async function inPlace(fn: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await fn();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

/* ------------------------------------------------------------------ approved-supplier list */

export async function proposePairAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await proposeSupplierMaterial(ctx, { supplierId: str(fd, "supplierId"), materialId: str(fd, "materialId"), supplierPartNumber: opt(fd, "supplierPartNumber"), note: str(fd, "note"), auditDate: opt(fd, "auditDate") });
    return "Proposed. QA decides on the approved list.";
  });
}

export async function proposeChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await proposeAslChange(ctx, { supplierMaterialId: str(fd, "supplierMaterialId"), action: str(fd, "action") === "suspend" ? "suspend" : "approve", note: str(fd, "note"), auditDate: opt(fd, "auditDate") });
    return "Proposal sent to QA.";
  });
}

export async function decideChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await decideAslChange(ctx, { changeId: str(fd, "changeId"), decision: str(fd, "decision") === "rejected" ? "rejected" : "approved", note: opt(fd, "note") });
    return `${r.label}: ${r.isApproved ? "on the approved list" : "not approved"}.`;
  });
}

export async function withdrawChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await withdrawAslChange(ctx, { changeId: str(fd, "changeId") });
    return "Proposal withdrawn.";
  });
}

export async function packAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateSupplierMaterialPack(ctx, { supplierMaterialId: str(fd, "supplierMaterialId"), brand: opt(fd, "brand"), packQty: opt(fd, "packQty"), packUom: opt(fd, "packUom") });
    return "Brand and pack size saved.";
  });
}

export async function termsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateSupplierTerms(ctx, {
      supplierMaterialId: str(fd, "supplierMaterialId"),
      supplierPartNumber: opt(fd, "supplierPartNumber"),
      leadTimeDays: opt(fd, "leadTimeDays"),
      moqQty: opt(fd, "moqQty"),
      moqUom: opt(fd, "moqUom"),
      unitPrice: opt(fd, "unitPrice"),
      priceUom: opt(fd, "priceUom"),
      currency: opt(fd, "currency"),
      priceEffectiveFrom: opt(fd, "priceEffectiveFrom"),
    });
    return "Terms saved.";
  });
}

/* ------------------------------------------------------------------ purchase requests */

export async function createRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createPurchaseRequest(ctx, {
      neededByDate: opt(fd, "neededByDate"),
      justification: opt(fd, "justification"),
      idempotencyKey: opt(fd, "idempotencyKey"),
      lines: rows(fd, "materialId").map((l) => ({ materialId: l.materialId, ...qtyAndUnit(l.qty, l.uom), estimatedUnitAmount: l.estimatedUnitAmount || null, suggestedSupplierId: l.suggestedSupplierId || null, note: l.note || null })),
    });
    id = r.requestId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/procurement/requests");
  redirect(`/procurement/requests/${id}`);
}

export async function submitRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitPurchaseRequest(ctx, { requestId: str(fd, "requestId") });
    return "Submitted for approval.";
  });
}

export async function decideRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const d = str(fd, "decision");
    const r = await decidePurchaseRequest(ctx, { requestId: str(fd, "requestId"), decision: d === "reject" ? "reject" : d === "return" ? "return" : "approve", note: opt(fd, "note") });
    return r.status === "approved" ? "Approved." : r.status === "submitted" ? "Step approved; the next approver is notified." : `Request ${r.status}.`;
  });
}

export async function cancelRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelPurchaseRequest(ctx, { requestId: str(fd, "requestId"), reason: str(fd, "reason") });
    return "Request cancelled.";
  });
}

/* ------------------------------------------------------------------ purchase orders */

export async function createOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  let sent: "1" | "0" | null = null;
  try {
    const ctx = await requireContext();
    const r = await createPurchaseOrder(ctx, {
      supplierId: str(fd, "supplierId"),
      shipToWarehouseId: opt(fd, "shipToWarehouseId"),
      paymentTermsDays: opt(fd, "paymentTermsDays"),
      taxAmount: opt(fd, "taxAmount"),
      notes: opt(fd, "notes"),
      isUrgent: fd.get("isUrgent") === "yes",
      urgentReason: opt(fd, "urgentReason"),
      idempotencyKey: opt(fd, "idempotencyKey"),
      lines: rows(fd, "qty").map((l) => ({ materialId: l.materialId ?? "", ...qtyAndUnit(l.qty, l.uom), unitAmount: l.unitAmount || null, expectedDate: l.expectedDate || null, purchaseRequestLineId: l.purchaseRequestLineId || null })),
    });
    id = r.purchaseOrderId;
    // "Save and send for approval" (grade-5 wizard): the draft is saved first; if sending fails the draft stays
    // and the order page says so (its button shows the reason).
    if (fd.get("intent") === "submit") {
      try {
        await submitPurchaseOrder(ctx, { purchaseOrderId: id });
        sent = "1";
      } catch {
        sent = "0";
      }
    }
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/procurement/orders");
  redirect(`/procurement/orders/${id}${sent ? `?sent=${sent}` : "?saved=1"}`);
}

export async function submitOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await submitPurchaseOrder(ctx, { purchaseOrderId: str(fd, "purchaseOrderId") });
    return `Submitted: ${r.steps} approval step(s).`;
  });
}

export async function decideOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await decidePurchaseOrder(ctx, { purchaseOrderId: str(fd, "purchaseOrderId"), decision: str(fd, "decision") === "return" ? "return" : "approve", note: opt(fd, "note") });
    return r.status === "approved" ? "Approved. Procurement can send it." : r.status === "submitted" ? "Step approved; the next approver is notified." : "Returned to draft.";
  });
}

export async function sendOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await sendPurchaseOrder(ctx, { purchaseOrderId: str(fd, "purchaseOrderId"), email: fd.get("email") === "yes", idempotencyKey: opt(fd, "idempotencyKey") });
    const mail =
      r.sendResult === "captured" || r.sendResult === "sent"
        ? `Emailed to ${r.emailedTo}.`
        : r.sendResult === "not_configured"
          ? "Email is not set up: print the PO and send it by hand."
          : r.sendResult === "failed"
            ? "The email failed: print the PO and send it by hand."
            : "Print the PO and send it to the supplier.";
    return `Sent. Document ${r.documentNumber} recorded. ${mail}`;
  });
}

export async function regenerateDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await regeneratePoDocument(ctx, { purchaseOrderId: str(fd, "purchaseOrderId") });
    return `Document ${r.documentNumber} recorded.`;
  });
}

export async function confirmOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await recordSupplierConfirmation(ctx, { purchaseOrderId: str(fd, "purchaseOrderId"), supplierReference: opt(fd, "supplierReference"), promisedDate: opt(fd, "promisedDate") });
    return "Supplier confirmation recorded.";
  });
}

export async function shortCloseLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await shortClosePoLine(ctx, { lineId: str(fd, "lineId"), reason: str(fd, "reason") });
    return "Line short-closed.";
  });
}

export async function closeOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await closePurchaseOrder(ctx, { purchaseOrderId: str(fd, "purchaseOrderId"), reason: opt(fd, "reason") });
    return "Purchase order closed.";
  });
}

export async function cancelOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelPurchaseOrder(ctx, { purchaseOrderId: str(fd, "purchaseOrderId"), reason: str(fd, "reason") });
    return "Purchase order cancelled.";
  });
}

/** Receipt against a PO (W01 with a PO): post now, or save a draft (e.g. an over-delivery that needs approval). */
export async function receivePoAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const r = await receiveAgainstPurchaseOrder(ctx, {
      purchaseOrderId: str(fd, "purchaseOrderId"),
      supplierDocumentNumber: str(fd, "supplierDocumentNumber"),
      notes: opt(fd, "notes"),
      idempotencyKey: str(fd, "idempotencyKey"),
      intent: str(fd, "intent") === "draft" ? "draft" : "post",
      lines: rows(fd, "qty").map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId || null,
        materialId: l.materialId ?? "",
        qty: l.qty,
        uom: l.uom || null,
        supplierLotNumber: l.supplierLotNumber ?? "",
        brand: l.brand || null,
        manufacturedOn: l.manufacturedOn || null,
        expiresOn: l.expiresOn ?? "",
        containerCount: l.containerCount ? Number(l.containerCount) : null,
        storageConditionsConfirmed: l.storageConditionsConfirmed === "yes",
        locationId: l.locationId ?? "",
        discrepancyKind: (l.discrepancyKind || null) as DiscrepancyKind | null,
        discrepancyNote: l.discrepancyNote || null,
      })),
    });
    target = `/inventory/receive/${r.receiptId}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/procurement/expected");
  redirect(target);
}

/* ------------------------------------------------------------------ supplier returns */

export async function createReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createSupplierReturn(ctx, { supplierId: str(fd, "supplierId"), goodsReceiptId: opt(fd, "goodsReceiptId"), reasonCode: str(fd, "reasonCode"), reasonNote: opt(fd, "reasonNote"), supplierRmaReference: opt(fd, "supplierRmaReference"), idempotencyKey: opt(fd, "idempotencyKey") });
    id = r.returnId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/procurement/returns");
  redirect(`/procurement/returns/${id}`);
}

export async function addReturnLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const [lotId, locationId] = str(fd, "lotLocation").split("|");
    const r = await addSupplierReturnLine(ctx, { returnId: str(fd, "returnId"), lotId: lotId || null, lotCode: opt(fd, "lotCode"), locationId: locationId || str(fd, "locationId"), ...qtyAndUnit(str(fd, "qty"), opt(fd, "uom") ?? undefined), creditExpectedAmount: opt(fd, "creditExpectedAmount") });
    return `Line ${r.lineNo}: lot ${r.lotNumber}.`;
  });
}

export async function removeReturnLineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await removeSupplierReturnLine(ctx, { returnId: str(fd, "returnId"), lineId: str(fd, "lineId") });
    return "Line removed.";
  });
}

export async function submitReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitSupplierReturn(ctx, { returnId: str(fd, "returnId") });
    return "Submitted for approval.";
  });
}

export async function decideReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await decideSupplierReturn(ctx, { returnId: str(fd, "returnId"), decision: str(fd, "decision") === "return" ? "return" : "approve", note: opt(fd, "note") });
    return r.status === "approved" ? "Approved. Post it when the goods leave." : r.status === "submitted" ? "Step approved; the next approver is notified." : "Returned to draft.";
  });
}

export async function postReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await postSupplierReturn(ctx, { returnId: str(fd, "returnId"), idempotencyKey: str(fd, "idempotencyKey") });
    return `Posted: ${r.movements} stock issue(s) recorded.`;
  });
}

export async function cancelReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelSupplierReturn(ctx, { returnId: str(fd, "returnId"), reason: str(fd, "reason") });
    return "Return cancelled.";
  });
}

/* ------------------------------------------------------------------ reorder and forecast */

export async function recomputeReorderAction(_p: ActionState): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    ctx.require("procurement.reorder_suggestion.approve");
    const r = await computeReorderSuggestions(ctx, { siteId: ctx.currentSiteId });
    return `${r.created} suggestion(s) from ${r.policies} polic${r.policies === 1 ? "y" : "ies"}.`;
  });
}

export async function savePolicyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await saveReorderPolicy(ctx, { materialId: str(fd, "materialId"), minStockBase: baseText(fd, "minStockBase") ?? "", safetyStockBase: baseText(fd, "safetyStockBase"), preferredSupplierId: opt(fd, "preferredSupplierId"), isActive: fd.get("isActive") !== "no" });
    return "Minimum saved.";
  });
}

export async function acceptSuggestionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await acceptReorderSuggestion(ctx, { suggestionId: str(fd, "suggestionId"), qty: baseText(fd, "qty"), note: opt(fd, "note"), idempotencyKey: opt(fd, "idempotencyKey") });
    id = r.requestId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/procurement/requests/${id}`);
}

export async function dismissSuggestionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await dismissReorderSuggestion(ctx, { suggestionId: str(fd, "suggestionId"), note: str(fd, "note") });
    return "Hidden from the list.";
  });
}

export async function submitOverrideAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitForecastOverride(ctx, { siteId: str(fd, "siteId"), productId: str(fd, "productId"), periodStart: str(fd, "periodStart"), overrideQty: str(fd, "overrideQty"), reason: str(fd, "reason") });
    return "Override submitted; a second person approves it before planning uses it.";
  });
}

export async function decideOverrideAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await decideForecastOverride(ctx, { overrideId: str(fd, "overrideId"), decision: str(fd, "decision") === "rejected" ? "rejected" : "approved", note: opt(fd, "note") });
    return "Decision recorded.";
  });
}
