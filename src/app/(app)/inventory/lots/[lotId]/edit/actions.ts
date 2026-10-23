"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { editLotAttributes } from "@/modules/inventory/lots-admin";
import { actionError, str } from "../../../_kit/action-state";

export async function editLotAction(lotId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await editLotAttributes(ctx, lotId, {
      manufacturedOn: str(fd, "manufacturedOn") || null,
      expiresOn: str(fd, "expiresOn") || null,
      supplierLotNumber: str(fd, "supplierLotNumber") || null,
      reason: str(fd, "reason"),
    });
  } catch (e) {
    return actionError(e);
  }
  revalidatePath(`/inventory/${lotId}`);
  redirect(`/inventory/${lotId}?edited=1`);
}
