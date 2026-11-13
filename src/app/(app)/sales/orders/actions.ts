"use server";
import { salesNextActors } from "@/modules/sales";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { NewOrderSchema, approveOrder, cancelOrder, cancelOrderLine, changeOrderLine, editOrder, emailOrderConfirmation, issuesToFieldErrors, moveOrderCard, reorderFromOrder, returnOrderToDraft, submitOrder } from "@/modules/sales";
import { customerEmailWords } from "@/lib/send-words";

/**
 * Server actions of the W3D order screens (thin adapters: parse, call the service, return
 * ActionState). In-place actions call refreshCurrentPage() so the response carries the re-rendered
 * page (ADR-043); actions that open another page revalidate and redirect.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid option.");
const key = (fd: FormData) => z.string().min(8).max(100).optional().parse(str(fd, "idempotencyKey") || undefined);

/** Submit opens the order page again with the outcome banner (`?done=confirmed` / `?done=pending_approval`). */
export async function submitOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const orderId = uuid.parse(str(fd, "orderId"));
    const r = await submitOrder(ctx, orderId, { idempotencyKey: key(fd) });
    target = `/sales/${orderId}?done=${r.status}`;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(target);
}

export async function approveOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await approveOrder(ctx, uuid.parse(str(fd, "orderId")), { note: str(fd, "note") || null, idempotencyKey: key(fd) });
    refreshCurrentPage();
    const orderId = uuid.parse(str(fd, "orderId"));
    return r.confirmed ? { ok: true, message: `Order ${r.orderNumber} approved and confirmed.` } : { ok: true, message: "Your approval is recorded.", next: await salesNextActors(ctx, "sales_order", orderId).catch(() => null) };
  } catch (e) {
    return toActionState(e);
  }
}

export async function returnOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await returnOrderToDraft(ctx, uuid.parse(str(fd, "orderId")), (str(fd, "reason") ?? "").slice(0, 300));
    refreshCurrentPage();
    return { ok: true, message: "Returned to draft. The person who submitted it has been notified." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function voidOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelOrder(ctx, uuid.parse(str(fd, "orderId")), (str(fd, "reason") ?? "").trim().slice(0, 300));
    refreshCurrentPage();
    return { ok: true, message: "Order cancelled. Any allocated or reserved stock was released." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function editOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let orderId: string;
  try {
    const ctx = await requireContext();
    orderId = uuid.parse(str(fd, "orderId"));
    let lines: unknown = [];
    try {
      lines = JSON.parse(str(fd, "lines") ?? "[]");
    } catch {
      return { ok: false, message: "The order lines could not be read. Reload the page and try again." };
    }
    const parsed = NewOrderSchema.safeParse({
      customerId: str(fd, "customerId"),
      customerPoNumber: str(fd, "customerPoNumber"),
      requestedDeliveryOn: str(fd, "requestedDeliveryOn"),
      notes: str(fd, "notes"),
      shipToAddressId: str(fd, "shipToAddressId"),
      billToAddressId: str(fd, "billToAddressId"),
      lines,
    });
    if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
    await editOrder(ctx, orderId, parsed.data);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}?done=edited`);
}

export async function reorderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").parse(str(fd, "requestedDeliveryOn"));
    id = (await reorderFromOrder(ctx, uuid.parse(str(fd, "orderId")), { requestedDeliveryOn: date, idempotencyKey: key(fd) })).id;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${id}?done=reordered`);
}

/** ADR-131: "Change how many" / "Cancel this line" on a confirmed order (reason required; the service checks everything). */
export async function changeOrderLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const lineId = uuid.parse(str(fd, "lineId"));
    const reason = str(fd, "reason") ?? "";
    const r = str(fd, "mode") === "cancel" ? await cancelOrderLine(ctx, { lineId, reason, idempotencyKey: key(fd) }) : await changeOrderLine(ctx, { lineId, qty: str(fd, "qty") ?? "", reason, idempotencyKey: key(fd) });
    refreshCurrentPage();
    const freed = Number(r.released) > 0 ? ` ${r.released} set aside were let go.` : "";
    return { ok: true, message: Number(r.after) === 0 ? `${r.productName} is taken off the order.${freed}` : `${r.productName}: now ${r.after} (was ${r.before}).${freed}` };
  } catch (e) {
    return toActionState(e);
  }
}

/** ADR-131: email the order confirmation to the customer (with "Can ship from"). */
export async function emailOrderConfirmationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await emailOrderConfirmation(ctx, uuid.parse(str(fd, "orderId")), { canShipFromText: str(fd, "canShipFromText") ?? "", idempotencyKey: key(fd) });
    refreshCurrentPage();
    return { ok: r.given, message: customerEmailWords("order confirmation", r.outcome, r.to) };
  } catch (e) {
    return toActionState(e);
  }
}

/** Board drop (client calls this directly; the board wraps the result in startTransition, ADR-043 rule 5). */
export async function boardMoveOrderAction(input: { orderId: string; toColumn: string; idempotencyKey: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireContext();
    const r = await moveOrderCard(ctx, input);
    refreshCurrentPage();
    return r;
  } catch (e) {
    const s = toActionState(e);
    return { ok: false, message: s?.message ?? "The order was not moved." };
  }
}
