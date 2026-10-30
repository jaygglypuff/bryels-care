"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { createReceiptDraft, postReceipt, receiveAndPost, updateReceiptDraft } from "@/modules/inventory/receiving";
import { DISCREPANCY_KINDS } from "@/modules/inventory/receiving-state";
import { receiveAgainstPurchaseOrder } from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // PO receiving hooks (src/modules/wiring.ts); cheap and idempotent

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = z.union([z.literal(""), z.string().regex(DATE_RE, { message: "Use a valid date." })]).optional();

const LineSchema = z
  .object({
    lineId: z.union([z.literal(""), z.uuid()]).optional(),
    materialId: z.uuid({ message: "Choose a material." }),
    qty: z.string().trim().regex(QTY_RE, { message: "Enter a quantity like 25000 or 12.5." }),
    uom: z.string().trim().max(8).optional(),
    supplierLotNumber: z.string().trim().min(1, { message: "Enter the supplier's lot number from the container label." }).max(80),
    manufacturedOn: optDate,
    expiresOn: z.string().regex(DATE_RE, { message: "Enter the expiry date." }),
    retestOn: optDate,
    containerCount: z.union([z.literal(""), z.string().regex(/^\d{1,5}$/, { message: "Whole number of containers." })]).optional(),
    storageConditionsConfirmed: z.boolean().optional(),
    locationId: z.uuid({ message: "Choose where the material is put away." }),
    discrepancyKind: z.union([z.literal(""), z.enum(DISCREPANCY_KINDS)]).optional(),
    discrepancyNote: z.string().trim().max(1000).optional(),
    /** S6: PO mode; "" = an item not on the order. */
    purchaseOrderLineId: z.union([z.literal(""), z.uuid()]).optional(),
  })
  .strict();

const ReceiptSchema = z
  .object({
    idempotencyKey: z.uuid({ message: "Reload the page and try again." }),
    receiptId: z.union([z.literal(""), z.uuid()]).optional(),
    /** S6 (ADR-077): the tablet form also receives against a purchase order (supplier comes from the PO). */
    purchaseOrderId: z.union([z.literal(""), z.uuid()]).optional(),
    intent: z.enum(["draft", "post"]),
    supplierName: z.string().trim().max(200).optional(),
    supplierDocumentNumber: z.string().trim().min(1, { message: "Enter the delivery document number (DR / invoice)." }).max(80),
    unplannedReasonCode: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(1000).optional(),
    lines: z.array(LineSchema).min(1, { message: "Add at least one line." }).max(50),
  })
  .strict()
  .refine((d) => !!d.purchaseOrderId || (d.supplierName ?? "").length >= 2, { message: "Enter the supplier name.", path: ["supplierName"] });

/** Saves a receipt draft or posts the receipt (one step from the phone form, or edit-then-post from a draft). */
export async function saveReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    let lines: unknown = [];
    try {
      lines = JSON.parse(String(formData.get("lines") ?? "[]"));
    } catch {
      return { ok: false, message: "The lines could not be read. Reload the page and try again." };
    }
    const parsed = ReceiptSchema.safeParse({
      idempotencyKey: formData.get("idempotencyKey"),
      receiptId: formData.get("receiptId") ?? "",
      purchaseOrderId: formData.get("purchaseOrderId") ?? "",
      intent: formData.get("intent") === "draft" ? "draft" : "post",
      supplierName: formData.get("supplierName") ?? undefined,
      supplierDocumentNumber: formData.get("supplierDocumentNumber"),
      unplannedReasonCode: formData.get("unplannedReasonCode") ?? undefined,
      notes: formData.get("notes") ?? undefined,
      lines,
    });
    if (!parsed.success) {
      // Keys like "supplierName" or "lines.0.qty" so the form can show errors per line.
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
      return { ok: false, message: "Check the highlighted fields.", fieldErrors };
    }
    const d = parsed.data;
    const header = {
      supplierName: d.supplierName ?? "",
      supplierDocumentNumber: d.supplierDocumentNumber,
      unplannedReasonCode: d.unplannedReasonCode || null,
      notes: d.notes || null,
      lines: d.lines.map((l) => ({
        lineId: l.lineId || null,
        materialId: l.materialId,
        qty: l.qty,
        uom: l.uom || null,
        supplierLotNumber: l.supplierLotNumber,
        manufacturedOn: l.manufacturedOn || null,
        expiresOn: l.expiresOn,
        retestOn: l.retestOn || null,
        containerCount: l.containerCount ? Number(l.containerCount) : null,
        storageConditionsConfirmed: !!l.storageConditionsConfirmed,
        locationId: l.locationId,
        discrepancyKind: l.discrepancyKind || null,
        discrepancyNote: l.discrepancyNote || null,
      })),
    };
    if (d.purchaseOrderId && !d.receiptId) {
      const r = await receiveAgainstPurchaseOrder(ctx, {
        purchaseOrderId: d.purchaseOrderId,
        supplierDocumentNumber: d.supplierDocumentNumber,
        notes: d.notes || null,
        idempotencyKey: d.idempotencyKey,
        intent: d.intent,
        lines: header.lines.map((l, i) => ({ ...l, purchaseOrderLineId: d.lines[i].purchaseOrderLineId || null })),
      });
      target = `/inventory/receive/${r.receiptId}?${r.posted ? "posted" : "saved"}=1`;
    } else if (d.receiptId) {
      await updateReceiptDraft(ctx, d.receiptId, header);
      if (d.intent === "post") await postReceipt(ctx, { receiptId: d.receiptId });
      target = `/inventory/receive/${d.receiptId}?${d.intent === "post" ? "posted" : "saved"}=1`;
    } else if (d.intent === "post") {
      const r = await receiveAndPost(ctx, { idempotencyKey: d.idempotencyKey, ...header });
      target = `/inventory/receive/${r.receiptId}?posted=1`;
    } else {
      const r = await createReceiptDraft(ctx, { idempotencyKey: d.idempotencyKey, ...header });
      target = `/inventory/receive/${r.receiptId}?saved=1`;
    }
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  revalidatePath("/inventory/receipts");
  redirect(target);
}
