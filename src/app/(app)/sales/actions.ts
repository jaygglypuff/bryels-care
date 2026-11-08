"use server";
import { plainShortfall, plainShortfallState } from "./shortfall-words";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import {
  NewOrderSchema,
  allocateOrder,
  createOrder,
  describeShortfall,
  issuesToFieldErrors,
} from "@/modules/sales";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function createOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let lines: unknown = [];
  try {
    lines = JSON.parse(s(fd, "lines") ?? "[]");
  } catch {
    return { ok: false, message: "The order lines could not be read. Reload the page and try again." };
  }
  const parsed = NewOrderSchema.safeParse({
    customerId: s(fd, "customerId"),
    customerPoNumber: s(fd, "customerPoNumber"),
    requestedDeliveryOn: s(fd, "requestedDeliveryOn"),
    notes: s(fd, "notes"),
    shipToAddressId: s(fd, "shipToAddressId"), // W3D
    billToAddressId: s(fd, "billToAddressId"), // W3D
    lines,
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  let orderId: string;
  try {
    const order = await createOrder(ctx, parsed.data);
    orderId = order.id;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}`);
}

/** ADR-131 (B-owner problem 13): the set-aside button as a form with a confirm step (the order id comes in the form). */
export async function allocateFormAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  return allocateAction(String(fd.get("orderId") ?? ""), prev);
}

export async function allocateAction(orderId: string, _: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  let r: Awaited<ReturnType<typeof allocateOrder>>;
  try {
    r = await allocateOrder(ctx, orderId);
  } catch (e) {
    return plainShortfallState(toActionState(e));
  }
  revalidatePath("/sales");
  revalidatePath(`/sales/${orderId}`);
  if (r.fullyAllocated) redirect(`/sales/${orderId}?done=allocated`);
  // Partial allocation is saved; the order stays confirmed and the shortfall is reported.
  return { ok: false, message: plainShortfall(describeShortfall(r, `Part of the stock is set aside (${r.created.length} shelf place${r.created.length === 1 ? "" : "s"}).`)) };
}
