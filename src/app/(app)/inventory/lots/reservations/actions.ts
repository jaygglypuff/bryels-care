"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { createReservation, releaseReservation } from "@/modules/inventory/reservations";
import { actionError, str } from "../../_kit/action-state";

const Reserve = z
  .object({
    lotId: z.uuid(),
    locationId: z.uuid(),
    qty: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, { message: "Enter a quantity like 24 or 12.5." }),
    demandReference: z.string().trim().min(3, { message: "Say what it is reserved for (at least 3 characters)." }).max(200),
    ttlHours: z.union([z.literal(""), z.string().regex(/^\d{1,4}$/, { message: "Whole hours, e.g. 72." })]),
    idempotencyKey: z.uuid(),
  })
  .strict();

export async function reserveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const i = Reserve.parse({
      lotId: str(fd, "lotId"),
      locationId: str(fd, "locationId"),
      qty: str(fd, "qty"),
      demandReference: str(fd, "demandReference"),
      ttlHours: str(fd, "ttlHours"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    const r = await createReservation(ctx, { ...i, demandType: "manual", ttlHours: i.ttlHours ? Number(i.ttlHours) : null });
    revalidatePath("/inventory/lots/reservations");
    return { ok: true, message: `Reserved (${r.reservationNumber}). Available-to-promise is reduced until it is released or expires.` };
  } catch (e) {
    return actionError(e);
  }
}

export async function releaseReservationAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await releaseReservation(await requireContext(), id, str(fd, "reason"));
    revalidatePath("/inventory/lots/reservations");
    return { ok: true, message: "Released." };
  } catch (e) {
    return actionError(e);
  }
}
