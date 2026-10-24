"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { approveAdjustment, cancelAdjustment, createAdjustment, postAdjustment, rejectAdjustment, submitAdjustment } from "@/modules/inventory/adjustments";
import { actionError, str } from "../_kit/action-state";

const Line = z
  .object({
    lotId: z.uuid({ message: "Choose the lot." }),
    locationId: z.uuid({ message: "Choose the location." }),
    direction: z.enum(["increase", "decrease"]),
    qty: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, { message: "Enter a quantity like 12 or 12.5." }),
    unitCost: z.union([z.literal(""), z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, { message: "Enter the unit cost as a number." })]),
    note: z.string().max(300),
  })
  .strict();

const Draft = z
  .object({
    reasonCode: z.string().trim().min(1, { message: "Choose a reason." }).max(40),
    reasonNote: z.string().max(500),
    lines: z.array(Line).min(1, { message: "Add at least one line." }).max(100),
    idempotencyKey: z.uuid(),
  })
  .strict();

export async function createAdjustmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const n = Number(str(fd, "lineCount") || "0");
    const lines = [];
    for (let i = 0; i < Math.min(n, 100); i++) {
      if (!str(fd, `lotId_${i}`) && !str(fd, `qty_${i}`)) continue;
      lines.push({
        lotId: str(fd, `lotId_${i}`),
        locationId: str(fd, `locationId_${i}`),
        direction: str(fd, `direction_${i}`),
        qty: str(fd, `qty_${i}`),
        unitCost: str(fd, `unitCost_${i}`),
        note: str(fd, `note_${i}`),
      });
    }
    const input = Draft.parse({ reasonCode: str(fd, "reasonCode"), reasonNote: str(fd, "reasonNote"), lines, idempotencyKey: str(fd, "idempotencyKey") });
    id = (await createAdjustment(ctx, { ...input, lines: input.lines.map((l) => ({ ...l, unitCost: l.unitCost || null, note: l.note || null })) })).id;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/adjustments");
  redirect(`/inventory/adjustments/${id}`);
}

const done = (id: string, message: string): ActionState => {
  revalidatePath(`/inventory/adjustments/${id}`);
  revalidatePath("/inventory/adjustments");
  return { ok: true, message };
};

export async function submitAdjustmentAction(id: string): Promise<ActionState> {
  try {
    const r = await submitAdjustment(await requireContext(), id);
    return done(id, r.requiresSecondApproval ? "Submitted. Above the threshold: a site manager and then the owner must approve." : "Submitted for approval.");
  } catch (e) {
    return actionError(e);
  }
}

export async function approveAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const r = await approveAdjustment(await requireContext(), id, str(fd, "reason") || null);
    return done(id, r.awaitingSecondStep ? "Approved (step 1). Waiting for the second approval." : "Approved. It can now be posted.");
  } catch (e) {
    return actionError(e);
  }
}

export async function rejectAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await rejectAdjustment(await requireContext(), id, str(fd, "reason"));
    return done(id, "Rejected.");
  } catch (e) {
    return actionError(e);
  }
}

export async function cancelAdjustmentAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await cancelAdjustment(await requireContext(), id, str(fd, "reason"));
    return done(id, "Cancelled.");
  } catch (e) {
    return actionError(e);
  }
}

export async function postAdjustmentAction(id: string, key: string): Promise<ActionState> {
  try {
    const r = await postAdjustment(await requireContext(), id, key);
    revalidatePath("/inventory");
    return done(id, `Posted ${r.movements.length} adjustment movement(s).`);
  } catch (e) {
    return actionError(e);
  }
}
