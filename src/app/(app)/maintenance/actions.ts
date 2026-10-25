"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import {
  assignMaintenanceWorkOrder,
  changeMaintenancePlanStatus,
  completeMaintenanceWorkOrder,
  createMaintenancePlan,
  createMaintenanceWorkOrder,
  createPlanWorkOrder,
  issueSparePart,
  registerSparePart,
  removeSparePart,
  transitionMaintenanceWorkOrder,
  updateMaintenancePlan,
} from "@/modules/maintenance";

/* Maintenance server actions (US-6-19): thin adapters; the services validate (zod) and check every rule. */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};
const yes = (fd: FormData, k: string) => fd.get(k) === "yes";

async function inPlace(run: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await run();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function createPlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const trigger = str(fd, "triggerKind");
    const r = await createMaintenancePlan(ctx, {
      equipmentId: str(fd, "equipmentId"),
      title: str(fd, "title"),
      instructions: opt(fd, "instructions"),
      triggerKind: trigger,
      intervalDays: trigger === "time" ? opt(fd, "intervalDays") : null,
      firstDueOn: trigger === "time" ? opt(fd, "firstDueOn") : null,
      usageMetric: trigger === "usage" ? opt(fd, "usageMetric") : null,
      usageInterval: trigger === "usage" ? opt(fd, "usageInterval") : null,
      leadDays: opt(fd, "leadDays"),
      takesEquipmentDown: yes(fd, "takesEquipmentDown"),
      responsibleUserId: opt(fd, "responsibleUserId"),
    });
    id = r.planId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/maintenance");
  redirect(`/maintenance/plans/${id}?created=1`);
}

export async function updatePlanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const input: Record<string, unknown> = { planId: str(fd, "planId"), title: str(fd, "title"), instructions: opt(fd, "instructions"), leadDays: opt(fd, "leadDays"), takesEquipmentDown: yes(fd, "takesEquipmentDown"), responsibleUserId: opt(fd, "responsibleUserId") };
    if (fd.has("intervalDays")) input.intervalDays = opt(fd, "intervalDays");
    if (fd.has("nextDueOn")) input.nextDueOn = opt(fd, "nextDueOn");
    if (fd.has("usageInterval")) input.usageInterval = opt(fd, "usageInterval");
    await updateMaintenancePlan(ctx, input);
    return "Plan saved.";
  });
}

export async function planStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await changeMaintenancePlanStatus(ctx, { planId: str(fd, "planId"), toStatus: str(fd, "toStatus"), reason: opt(fd, "reason") });
    return r.status === "active" ? "Plan resumed." : `Plan ${r.status}.`;
  });
}

export async function planWorkOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createPlanWorkOrder(ctx, { planId: str(fd, "planId"), dueDate: opt(fd, "dueDate"), assignedTo: opt(fd, "assignedTo"), priority: opt(fd, "priority") ?? "normal", idempotencyKey: opt(fd, "idempotencyKey") });
    id = r.workOrderId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/maintenance");
  redirect(`/maintenance/work-orders/${id}?created=1`);
}

export async function createWorkOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createMaintenanceWorkOrder(ctx, {
      equipmentId: str(fd, "equipmentId"),
      kind: str(fd, "kind"),
      title: str(fd, "title"),
      description: opt(fd, "description"),
      priority: opt(fd, "priority") ?? "normal",
      dueDate: opt(fd, "dueDate"),
      assignedTo: opt(fd, "assignedTo"),
      takesEquipmentDown: yes(fd, "takesEquipmentDown"),
      reportedDown: yes(fd, "reportedDown"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.workOrderId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/maintenance");
  redirect(`/maintenance/work-orders/${id}?created=1`);
}

export async function workOrderTransitionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await transitionMaintenanceWorkOrder(ctx, { workOrderId: str(fd, "workOrderId"), to: str(fd, "to"), reason: opt(fd, "reason") });
    if (r.status === "in_progress") return r.equipmentStatus === "maintenance" ? "Work started; the equipment is now in maintenance and cannot be used." : "Work started.";
    if (r.status === "on_hold") return "Work order on hold.";
    return r.equipmentStillDown ? "Work order cancelled. The equipment is still out of use: change its status on the equipment page when it is safe." : "Work order cancelled.";
  });
}

export async function assignWorkOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await assignMaintenanceWorkOrder(ctx, { workOrderId: str(fd, "workOrderId"), assignedTo: opt(fd, "assignedTo"), dueDate: opt(fd, "dueDate"), priority: opt(fd, "priority") ?? undefined });
    return "Assignment saved; the technician was notified.";
  });
}

export async function completeWorkOrderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await completeMaintenanceWorkOrder(ctx, { workOrderId: str(fd, "workOrderId"), workDone: str(fd, "workDone"), result: str(fd, "result"), referenceNumber: opt(fd, "referenceNumber"), performedByExternal: opt(fd, "performedByExternal"), idempotencyKey: opt(fd, "idempotencyKey") });
    return r.equipmentStatus === "in_service" ? "Completed. The service record is written and the equipment is back in service." : `Completed. The equipment stays ${r.equipmentStatus.replace(/_/g, " ")}.`;
  });
}

export async function issuePartAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const [lotId, fromLocationId] = str(fd, "stock").split("|");
    const r = await issueSparePart(ctx, { workOrderId: str(fd, "workOrderId"), lotId, fromLocationId, qty: str(fd, "qty"), idempotencyKey: str(fd, "idempotencyKey") });
    return r.replayed ? "This issue was already posted." : "Spare part issued; the stock movement is posted.";
  });
}

export async function registerSparePartAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const r = await registerSparePart(ctx, { siteId: str(fd, "siteId"), materialId: str(fd, "materialId"), equipmentId: opt(fd, "equipmentId"), minQty: opt(fd, "minQty"), note: opt(fd, "note") });
    return r.created ? "Spare part added to the list." : "Spare part updated.";
  });
}

export async function removeSparePartAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await removeSparePart(ctx, { sparePartId: str(fd, "sparePartId") });
    return "Removed from the spare-parts list.";
  });
}
