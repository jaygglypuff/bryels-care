"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { createBox, findContainerByNumber, mergeBoxes, repackBox, setBoxStatus, splitBox } from "@/modules/inventory/containers";
import { CONTAINER_KINDS } from "@/db/schema";
import { actionError, str } from "../_kit/action-state";

const QTY = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, { message: "Enter a quantity like 24 or 12.5." });

const NewBox = z
  .object({
    lotId: z.uuid({ message: "Choose the lot." }),
    locationId: z.uuid({ message: "Choose where the stock is." }),
    qty: QTY,
    containerKind: z.enum(CONTAINER_KINDS),
    isPartial: z.boolean(),
    notes: z.string().max(300).optional(),
    idempotencyKey: z.uuid({ message: "Reload the page and try again." }),
  })
  .strict();

export async function createBoxAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const input = NewBox.parse({
      lotId: str(fd, "lotId"),
      locationId: str(fd, "locationId"),
      qty: str(fd, "qty"),
      containerKind: str(fd, "containerKind") || "box",
      isPartial: fd.get("isPartial") === "on",
      notes: str(fd, "notes") || undefined,
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    id = (await createBox(ctx, input)).id;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/containers");
  redirect(`/inventory/containers/${id}?created=1`);
}

export async function splitAction(containerId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  let msg: string;
  try {
    const ctx = await requireContext();
    const parts = str(fd, "quantities")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (parts.length === 0) return { ok: false, message: "Enter the quantity of each new box, e.g. 60, 40.", fieldErrors: { quantities: "Enter at least one quantity." } };
    for (const p of parts) QTY.parse(p);
    const lotId = str(fd, "lotId") || undefined;
    const r = await splitBox(ctx, { containerId, children: parts.map((qty) => ({ qty, lotId })), idempotencyKey: str(fd, "idempotencyKey") });
    msg = `Split into ${r.children.map((c) => c.containerNumber).join(", ")}. Print the new box labels.`;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath(`/inventory/containers/${containerId}`);
  return { ok: true, message: msg };
}

export async function mergeAction(containerId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const codes = str(fd, "others")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (codes.length === 0) return { ok: false, message: "Scan the other box or boxes to merge with.", fieldErrors: { others: "Scan at least one more box." } };
    const ids = [containerId];
    for (const c of codes) {
      const hit = await findContainerByNumber(ctx, c);
      if (!hit) return { ok: false, message: `No box ${c} in your sites.` };
      ids.push(hit.id);
    }
    target = (await mergeBoxes(ctx, { containerIds: ids, idempotencyKey: str(fd, "idempotencyKey") })).id;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/containers");
  redirect(`/inventory/containers/${target}?merged=1`);
}

export async function repackAction(containerId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const toCode = str(fd, "toBox");
    let toContainerId: string | null = null;
    if (toCode) {
      const hit = await findContainerByNumber(ctx, toCode);
      if (!hit) return { ok: false, message: `No box ${toCode} in your sites.`, fieldErrors: { toBox: "Box not found." } };
      toContainerId = hit.id;
    }
    target = (
      await repackBox(ctx, {
        fromContainerId: containerId,
        toContainerId,
        lotId: str(fd, "lotId") || undefined,
        qty: QTY.parse(str(fd, "qty")),
        reason: str(fd, "reason"),
        idempotencyKey: str(fd, "idempotencyKey"),
      })
    ).id;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/containers");
  redirect(`/inventory/containers/${target}?repacked=1`);
}

export async function boxStatusAction(containerId: string, to: "sealed" | "open" | "void", _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await setBoxStatus(ctx, containerId, to, str(fd, "reason") || undefined);
  } catch (e) {
    return actionError(e);
  }
  revalidatePath(`/inventory/containers/${containerId}`);
  return { ok: true, message: to === "sealed" ? "Box sealed." : to === "open" ? "Box reopened." : "Box voided." };
}
