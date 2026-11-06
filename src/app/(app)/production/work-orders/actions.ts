"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  approveProductionPlan,
  buildProductionPlan,
  closeProductionPlan,
  convertPlanLine,
  createWorkOrder,
  editWorkOrder,
  setMinStock,
} from "@/modules/production";

/**
 * Server actions of the W2A planning screens (thin adapters: parse the form, call the service,
 * return ActionState). Business rules live in src/modules/production. Actions that stay on the
 * page call refreshCurrentPage() on success, so their response carries the re-rendered page and
 * the message and the new state commit together (ADR-043); actions that open another page
 * revalidate and redirect.
 */

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid option.");
const key = z.string().min(8).max(100);

function woFields(fd: FormData) {
  return {
    productId: str(fd, "productId") ?? "",
    formulaId: str(fd, "formulaId") || null,
    batchSizeKg: str(fd, "batchSizeKg") || null,
    batchCount: str(fd, "batchCount") ?? "",
    plannedStart: str(fd, "plannedStart") ?? "",
    plannedEnd: str(fd, "plannedEnd") ?? "",
    productionLineId: str(fd, "productionLineId") || null,
    priority: str(fd, "priority") || "5",
    assignedSupervisorId: str(fd, "assignedSupervisorId") || null,
    targetUnits: str(fd, "targetUnits") || null,
    notes: str(fd, "notes") || null,
  } as unknown as Parameters<typeof createWorkOrder>[1];
}

export async function createWorkOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    ({ workOrderId: id } = await createWorkOrder(ctx, { ...woFields(fd), idempotencyKey: key.parse(str(fd, "idempotencyKey")) }));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/production/orders");
  redirect(`/production/orders/${id}`);
}

export async function editWorkOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "workOrderId"));
    const r = await editWorkOrder(ctx, id, woFields(fd));
    refreshCurrentPage();
    return { ok: true, message: `Work order ${r.workOrderNumber} saved.` };
  } catch (e) {
    return toActionState(e);
  }
}

// The old order view's commands (plan, release, top-up, create batch, cancel) were removed with the view (ADR-105): the
// production order page does each of them (Approve, Plan the batch, Set aside new stock, Cancel), see orders/actions.ts.

export async function buildPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    ({ planId: id } = await buildProductionPlan(ctx, { periodStart: str(fd, "periodStart") ?? "", periodEnd: str(fd, "periodEnd") ?? "", notes: str(fd, "notes") || null, idempotencyKey: str(fd, "idempotencyKey") || null }));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/production/plan");
  redirect(`/production/plan/${id}`);
}

export async function planCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const planId = uuid.parse(str(fd, "planId"));
    const command = z.enum(["approve", "close", "convert"]).parse(str(fd, "command"));
    let message: string;
    if (command === "approve") message = `Plan ${(await approveProductionPlan(ctx, planId, str(fd, "note") || null)).planNumber} approved.`;
    else if (command === "close") message = `Plan ${(await closeProductionPlan(ctx, planId)).planNumber} closed.`;
    else {
      const r = await convertPlanLine(ctx, { planLineId: uuid.parse(str(fd, "planLineId")), plannedStart: str(fd, "plannedStart") || null, idempotencyKey: str(fd, "idempotencyKey") || null });
      message = `Work order ${r.workOrderNumber} created (${r.batchCount} batch${r.batchCount === 1 ? "" : "es"}). Plan and release it from the work order.`;
    }
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function minStockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setMinStock(ctx, { productId: str(fd, "productId") ?? "", minStockUnits: str(fd, "minStockUnits") ?? "" });
    refreshCurrentPage();
    return { ok: true, message: "Minimum stock saved." };
  } catch (e) {
    return toActionState(e);
  }
}
