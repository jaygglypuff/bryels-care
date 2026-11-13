"use server";
import { salesNextActors } from "@/modules/sales";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { QuoteSchema, approveQuote, convertQuote, createQuote, editQuote, emailQuoteToCustomer, issuesToFieldErrors, markQuoteGiven, recordQuoteDecision, returnQuoteToDraft, submitQuote, voidQuote } from "@/modules/sales";
import { customerEmailWords } from "@/lib/send-words";

/** Quotation actions (US-4-04): thin adapters over src/modules/sales/quotations.ts. */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid option.");

export async function saveQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    let lines: unknown = [];
    try {
      lines = JSON.parse(str(fd, "lines") ?? "[]");
    } catch {
      return { ok: false, message: "The lines could not be read. Reload the page and try again." };
    }
    const parsed = QuoteSchema.safeParse({ customerId: str(fd, "customerId"), validUntil: str(fd, "validUntil"), shipToAddressId: str(fd, "shipToAddressId"), notesCustomer: str(fd, "notesCustomer"), notesInternal: str(fd, "notesInternal"), lines });
    if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
    const existing = str(fd, "quoteId");
    if (existing) {
      id = uuid.parse(existing);
      await editQuote(ctx, id, parsed.data);
    } else {
      id = (await createQuote(ctx, { ...parsed.data, idempotencyKey: str(fd, "idempotencyKey") || null })).id;
    }
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/quotations");
  redirect(`/sales/quotations/${id}?saved=1`);
}

export async function quoteCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "quoteId"));
    const cmd = z.enum(["submit", "approve", "return", "accept", "reject", "void", "email", "given"]).parse(str(fd, "command"));
    const reason = str(fd, "reason") ?? "";
    let message: string;
    switch (cmd) {
      case "submit": {
        const r = await submitQuote(ctx, id, { idempotencyKey: str(fd, "idempotencyKey") || null });
        message = r.status === "sent" ? "Ready. Next: email it to the customer or print it." : "The discount needs approval.";
        break;
      }
      case "email": {
        // ADR-131: "Sent" only when the email really went out.
        const r = await emailQuoteToCustomer(ctx, id, { idempotencyKey: str(fd, "idempotencyKey") || null });
        refreshCurrentPage();
        return { ok: r.given, message: customerEmailWords("price offer", r.outcome, r.to) };
      }
      case "given":
        await markQuoteGiven(ctx, id);
        message = "Saved: the customer has the printed price offer.";
        break;
      case "approve": {
        const r = await approveQuote(ctx, id, str(fd, "note") || null);
        message = r.sent ? "Approved and issued." : "Your approval is recorded.";
        break;
      }
      case "return":
        await returnQuoteToDraft(ctx, id, reason);
        message = "Returned to draft.";
        break;
      case "accept":
        await recordQuoteDecision(ctx, id, "accepted");
        message = "Marked as accepted. Convert it to an order when the PO arrives.";
        break;
      case "reject":
        await recordQuoteDecision(ctx, id, "rejected", reason);
        message = "Marked as rejected by the customer.";
        break;
      default:
        await voidQuote(ctx, id, reason);
        message = "Quotation voided.";
    }
    refreshCurrentPage();
    // Who approves next, by name and role (ADR-109).
    return { ok: true, message, next: cmd === "submit" || cmd === "approve" ? await salesNextActors(ctx, "quote", id).catch(() => null) : null };
  } catch (e) {
    return toActionState(e);
  }
}

export async function convertQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let orderId: string;
  try {
    const ctx = await requireContext();
    const r = await convertQuote(ctx, uuid.parse(str(fd, "quoteId")), {
      requestedDeliveryOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").parse(str(fd, "requestedDeliveryOn")),
      customerPoNumber: str(fd, "customerPoNumber")?.trim() || null,
      idempotencyKey: str(fd, "idempotencyKey") || null,
    });
    orderId = r.orderId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}?done=fromquote`);
}
