"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { addDailyLog, approveProductionOrder, cancelWorkOrder, correctDailyLog, createProductionOrder } from "@/modules/production";

/**
 * Server actions of the production order screens (ADR-074). Thin adapters: read the form, call the
 * service, return ActionState. Rules live in src/modules/production. In-place actions call
 * refreshCurrentPage() so the message and the new state arrive together (ADR-043).
 */

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid option.");

export async function createProductionOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    ({ workOrderId: id } = await createProductionOrder(ctx, {
      productId: str(fd, "productId") ?? "",
      batchSizeKg: str(fd, "batchSizeKg") || null,
      batchCount: str(fd, "batchCount") || null,
      plannedStart: str(fd, "plannedStart") ?? "",
      plannedEnd: str(fd, "plannedEnd") || null,
      productionLineId: str(fd, "productionLineId") || null,
      notes: str(fd, "notes") || null,
      idempotencyKey: str(fd, "idempotencyKey") || null,
    }));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/production/orders");
  redirect(`/production/orders/${id}`);
}

export async function approveProductionOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await approveProductionOrder(ctx, uuid.parse(str(fd, "workOrderId")), { note: str(fd, "note") || null, idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    const b = r.batches.map((x) => x.batchNumber).join(", ");
    return { ok: true, message: `Approved. Materials are set aside${b ? ` and batch ${b} is ready to start` : ""}.${r.shortages.length ? ` Still missing: ${r.shortages.join(" ")}` : ""}` };
  } catch (e) {
    return toActionState(e);
  }
}

function defectsFrom(fd: FormData) {
  const types = fd.getAll("defectType").map(String);
  const qtys = fd.getAll("defectQty").map(String);
  return types.map((t, i) => ({ defectType: t, quantity: (qtys[i] ?? "").trim() })).filter((d) => d.defectType && d.quantity !== "" && d.quantity !== "0");
}

function entryFrom(fd: FormData) {
  return {
    batchId: str(fd, "batchId") || null,
    logDate: str(fd, "logDate") || null,
    shift: str(fd, "shift") || null,
    notes: str(fd, "notes") || null,
    goodQty: str(fd, "goodQty") || null,
    defects: defectsFrom(fd),
  };
}

export async function addDailyLogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await addDailyLog(ctx, { workOrderId: uuid.parse(str(fd, "workOrderId")), ...entryFrom(fd), idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    return { ok: true, message: "Saved to the daily log." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function correctDailyLogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await correctDailyLog(ctx, { logId: uuid.parse(str(fd, "logId")), reason: str(fd, "reason") ?? "", ...entryFrom(fd), idempotencyKey: str(fd, "idempotencyKey") || null });
    refreshCurrentPage();
    return { ok: true, message: "Correction saved. The old entry is kept and no longer counts." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelProductionOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await cancelWorkOrder(ctx, uuid.parse(str(fd, "workOrderId")), str(fd, "reason") ?? "");
    refreshCurrentPage();
    return { ok: true, message: `Production order ${r.workOrderNumber} cancelled. Materials set aside for it are free again.` };
  } catch (e) {
    return toActionState(e);
  }
}
