"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import {
  approveMaterialSubstitution,
  approveProductionPlan,
  buildProductionPlan,
  cancelWorkOrder,
  closeProductionPlan,
  convertPlanLine,
  createBatchFromWorkOrder,
  createWorkOrder,
  editWorkOrder,
  generateBatchSheet,
  moveBoardCard,
  planWorkOrder,
  releaseWorkOrder,
  reserveWorkOrderShortages,
  setMinStock,
  stageMaterial,
} from "@/modules/production";

/**
 * Server actions of the W2A planning screens (thin adapters: parse the form, call the service,
 * return ActionState). Business rules live in src/modules/production. Every page here is
 * force-dynamic; actions that stay on the page return their message and the client refreshes
 * (router.refresh) instead of revalidating inside the action response.
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
  revalidatePath("/production/work-orders");
  redirect(`/production/work-orders/${id}`);
}

export async function editWorkOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "workOrderId"));
    const r = await editWorkOrder(ctx, id, woFields(fd));
    return { ok: true, message: `Work order ${r.workOrderNumber} saved.` };
  } catch (e) {
    return toActionState(e);
  }
}

/** One action for the state buttons on the work order detail (plan, release, top-up, create batch). */
export async function workOrderCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let goTo: string | null = null;
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "workOrderId"));
    const command = z.enum(["plan", "release", "top_up", "create_batch"]).parse(str(fd, "command"));
    let message: string;
    if (command === "plan") {
      const r = await planWorkOrder(ctx, id);
      message = `Planned with ${r.formulaRevision} and ${r.routingRevision}.`;
    } else if (command === "release") {
      const r = await releaseWorkOrder(ctx, id, { note: str(fd, "note") || null, idempotencyKey: str(fd, "idempotencyKey") || null });
      message = `Released. ${r.reservations.length} reservation${r.reservations.length === 1 ? "" : "s"} made${r.shortages.length ? `; short: ${r.shortages.map((s) => s.materialName).join(", ")}` : ""}.`;
    } else if (command === "top_up") {
      const r = await reserveWorkOrderShortages(ctx, id);
      message = r.reservations.length ? `${r.reservations.length} more reservation${r.reservations.length === 1 ? "" : "s"} made.` : r.shortages.length ? "No more eligible stock to reserve yet." : "Everything is already reserved.";
    } else {
      const r = await createBatchFromWorkOrder(ctx, { workOrderId: id, plannedStartOn: str(fd, "plannedStartOn") || null, idempotencyKey: str(fd, "idempotencyKey") || null });
      message = `Batch ${r.batchNumber} created.`;
      goTo = `/production/staging/${r.batchId}`;
    }
    if (!goTo) return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
  redirect(goTo ?? "/production/work-orders");
}

export async function cancelWorkOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "workOrderId"));
    const r = await cancelWorkOrder(ctx, id, str(fd, "reason") ?? "");
    return { ok: true, message: `Work order ${r.workOrderNumber} cancelled; ${r.reservationsEnded} reservation${r.reservationsEnded === 1 ? "" : "s"} ended.` };
  } catch (e) {
    return toActionState(e);
  }
}

export type BoardMoveResult = { ok: boolean; message: string };

/** Board drop (also used by the "Move to" menu). Refusals come back as an explanation for the dialog. */
export async function boardMoveAction(input: { kind: "work_order" | "batch"; id: string; toColumn: string; idempotencyKey: string }): Promise<BoardMoveResult> {
  try {
    const ctx = await requireContext();
    const r = await moveBoardCard(ctx, input);
    return { ok: true, message: r.message };
  } catch (e) {
    const s = toActionState(e);
    return { ok: false, message: s?.message ?? "The move was not made." };
  }
}

export type StageResult = { ok: boolean; message: string; fieldErrors?: Record<string, string>; batchStaged?: boolean };

export async function stageMaterialAction(input: { batchId: string; lotCode: string; toLocationCode: string; qty?: string; idempotencyKey: string }): Promise<StageResult> {
  try {
    const ctx = await requireContext();
    const r = await stageMaterial(ctx, { ...input, qty: input.qty || null });
    return { ok: true, batchStaged: r.batchStaged, message: `Staged ${r.qty} ${r.baseUom} of ${r.materialName} (lot ${r.lotNumber}) at ${r.toLocation}.${r.batchStaged ? " All ingredients are staged: the batch is ready to start." : ""}` };
  } catch (e) {
    const s = toActionState(e);
    return { ok: false, message: s?.message ?? "Not staged.", fieldErrors: s?.fieldErrors };
  }
}

export async function substitutionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await approveMaterialSubstitution(ctx, {
      batchId,
      batchMaterialId: uuid.parse(str(fd, "batchMaterialId")),
      substituteLotCode: str(fd, "substituteLotCode") ?? "",
      reason: str(fd, "reason") ?? "",
      idempotencyKey: str(fd, "idempotencyKey") || null,
    });
    return { ok: true, message: `Substitution approved: lot ${r.lotNumber} at ${r.locationCode} is now reserved (${r.qty}).` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function generateSheetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const kind = z.enum(["dispensing_sheet", "traveler"]).parse(str(fd, "kind"));
    const r = await generateBatchSheet(ctx, { batchId, kind, idempotencyKey: key.parse(str(fd, "idempotencyKey")) });
    target = `/print/${kind === "traveler" ? "traveler" : "dispensing-sheet"}/${batchId}?doc=${r.id}`;
  } catch (e) {
    return toActionState(e);
  }
  redirect(target);
}

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
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function minStockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setMinStock(ctx, { productId: str(fd, "productId") ?? "", minStockUnits: str(fd, "minStockUnits") ?? "" });
    return { ok: true, message: "Minimum stock saved." };
  } catch (e) {
    return toActionState(e);
  }
}
