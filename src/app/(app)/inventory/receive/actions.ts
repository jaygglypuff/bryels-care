"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { postGoodsReceipt } from "@/modules/inventory/receiving";

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LineSchema = z.object({
  materialId: z.uuid({ message: "Choose a material." }),
  qty: z.string().trim().regex(QTY_RE, { message: "Enter a quantity like 25000 or 12.5." }),
  supplierLotNumber: z.string().trim().min(1, { message: "Enter the supplier's lot number from the container label." }).max(80),
  manufacturedOn: z.union([z.literal(""), z.string().regex(DATE_RE, { message: "Use a valid date." })]).optional(),
  expiresOn: z.string().regex(DATE_RE, { message: "Enter the expiry date." }),
  locationId: z.uuid({ message: "Choose where the material is put away." }),
});

const ReceiptSchema = z.object({
  idempotencyKey: z.uuid({ message: "Reload the page and try again." }),
  supplierName: z.string().trim().min(2, { message: "Enter the supplier name." }).max(200),
  supplierDocumentNumber: z.string().trim().min(1, { message: "Enter the delivery document number (DR / invoice)." }).max(80),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(LineSchema).min(1, { message: "Add at least one line." }).max(50),
});

export async function postReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let receiptId: string;
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
      supplierName: formData.get("supplierName"),
      supplierDocumentNumber: formData.get("supplierDocumentNumber"),
      notes: formData.get("notes") ?? undefined,
      lines,
    });
    if (!parsed.success) {
      // Keys like "supplierName" or "lines.0.qty" so the form can show errors per line.
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
      return { ok: false, message: "Check the highlighted fields.", fieldErrors };
    }
    const r = await postGoodsReceipt(ctx, {
      ...parsed.data,
      lines: parsed.data.lines.map((l) => ({ ...l, manufacturedOn: l.manufacturedOn || null })),
    });
    receiptId = r.receiptId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/inventory");
  redirect(`/inventory/receive/${receiptId}?posted=1`);
}
