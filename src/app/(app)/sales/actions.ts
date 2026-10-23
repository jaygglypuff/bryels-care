"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import {
  CustomerSchema,
  DeliverySchema,
  DispatchSchema,
  NewOrderSchema,
  allocateOrder,
  cancelOrder,
  confirmOrder,
  createCustomer,
  createOrder,
  describeShortfall,
  dispatchOrder,
  issuesToFieldErrors,
  recordDelivery,
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

export async function confirmOrderAction(orderId: string, _: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await confirmOrder(ctx, orderId);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}?done=confirmed`);
}

export async function cancelOrderAction(orderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const reason = (s(fd, "reason") ?? "").trim();
  if (reason.length < 3) return { ok: false, message: "Give a reason for cancelling.", fieldErrors: { reason: "Required." } };
  try {
    await cancelOrder(ctx, orderId, reason.slice(0, 300));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}?done=cancelled`);
}

export async function allocateAction(orderId: string, _: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  let r: Awaited<ReturnType<typeof allocateOrder>>;
  try {
    r = await allocateOrder(ctx, orderId);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  revalidatePath(`/sales/${orderId}`);
  if (r.fullyAllocated) redirect(`/sales/${orderId}?done=allocated`);
  // Partial allocation is saved; the order stays confirmed and the shortfall is reported.
  return { ok: false, message: describeShortfall(r, `Partly allocated (${r.created.length} pick line${r.created.length === 1 ? "" : "s"} added).`) };
}

export async function dispatchAction(orderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = DispatchSchema.safeParse({
    carrier: s(fd, "carrier"),
    driverName: s(fd, "driverName"),
    vehiclePlate: s(fd, "vehiclePlate"),
    packageCount: s(fd, "packageCount"),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  try {
    await dispatchOrder(ctx, orderId, { ...parsed.data, vehiclePlate: parsed.data.vehiclePlate.toUpperCase() });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales");
  redirect(`/sales/${orderId}?done=dispatched`);
}

export async function recordDeliveryAction(shipmentId: string, orderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = DeliverySchema.safeParse({ receivedByName: s(fd, "receivedByName"), deliveredAt: s(fd, "deliveredAt") });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  const deliveredAt = new Date(`${parsed.data.deliveredAt}:00+08:00`);
  if (Number.isNaN(deliveredAt.getTime())) return { ok: false, message: "Enter a valid date and time.", fieldErrors: { deliveredAt: "Invalid date." } };
  try {
    await recordDelivery(ctx, shipmentId, { receivedByName: parsed.data.receivedByName, deliveredAt });
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath(`/sales/${orderId}`);
  redirect(`/sales/${orderId}?done=delivered`);
}

export async function createCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = CustomerSchema.safeParse({
    code: s(fd, "code"),
    name: s(fd, "name"),
    contactName: s(fd, "contactName"),
    phone: s(fd, "phone"),
    email: s(fd, "email"),
    shipToAddress: s(fd, "shipToAddress"),
    minShelfLifeDays: s(fd, "minShelfLifeDays"),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  let id: string;
  try {
    id = (await createCustomer(ctx, parsed.data)).id;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/customers");
  redirect(`/sales/customers/${id}`);
}
