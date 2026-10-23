"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import type { ActionState } from "@/lib/errors";
import { COUNT_KINDS } from "@/db/schema";
import {
  approveCount,
  cancelCount,
  createCount,
  findLotForCount,
  postCount,
  recordCount,
  recordRecount,
  rejectCountLines,
  releaseCount,
  submitCount,
} from "@/modules/inventory/counts";
import { actionError, str } from "../_kit/action-state";

const QTY = z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/, { message: "Enter the counted quantity, e.g. 0, 24 or 12.5." });

const Plan = z
  .object({
    countKind: z.enum(COUNT_KINDS),
    isBlind: z.boolean(),
    scheduledFor: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    locationIds: z.array(z.uuid()).min(1, { message: "Choose at least one location." }),
    counterUserIds: z.array(z.uuid()),
    notes: z.string().max(500),
  })
  .strict();

export async function planCountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const input = Plan.parse({
      countKind: str(fd, "countKind"),
      isBlind: fd.get("isBlind") === "on",
      scheduledFor: str(fd, "scheduledFor"),
      locationIds: fd.getAll("locationIds").map(String),
      counterUserIds: fd.getAll("counterUserIds").map(String),
      notes: str(fd, "notes"),
    });
    id = (await createCount(ctx, input)).id;
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/inventory/counts");
  redirect(`/inventory/counts/${id}`);
}

const done = (id: string, message: string): ActionState => {
  revalidatePath(`/inventory/counts/${id}`);
  revalidatePath("/inventory/counts");
  return { ok: true, message };
};

export async function releaseCountAction(id: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await releaseCount(ctx, id);
    return done(id, `Released: ${r.lines} line(s) snapshotted; the locations are frozen.`);
  } catch (e) {
    return actionError(e);
  }
}

export async function cancelCountAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelCount(ctx, id, str(fd, "reason"));
    return done(id, "Count cancelled; the locations are no longer frozen.");
  } catch (e) {
    return actionError(e);
  }
}

export async function recordCountAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const qty = QTY.parse(str(fd, "qty"));
    const locationId = z.uuid({ message: "Choose the location you are counting." }).parse(str(fd, "locationId"));
    const lotCode = str(fd, "lotCode");
    const unlabelled = str(fd, "unlabelled");
    let lotId: string | null = null;
    if (lotCode) {
      const lot = await findLotForCount(ctx, id, lotCode);
      if (!lot) return { ok: false, message: `No lot ${lotCode} at this site. If the item has no label, describe it instead.`, fieldErrors: { lotCode: "Lot not found." } };
      lotId = lot.id;
    } else if (!unlabelled) {
      return { ok: false, message: "Scan the lot label, or describe the unlabelled item.", fieldErrors: { lotCode: "Scan or type the lot." } };
    }
    const r = await recordCount(ctx, { countId: id, locationId, lotId, unlabelledDescription: lotId ? null : unlabelled, qty, idempotencyKey: str(fd, "idempotencyKey") });
    return done(id, r.previous ? `Updated: your new count is saved; the earlier count (${r.previous.qty}) is kept in the history.` : "Count saved.");
  } catch (e) {
    return actionError(e);
  }
}

export async function submitCountAction(id: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await submitCount(ctx, id);
    return done(id, r.recounts ? `Submitted. ${r.recounts} line(s) need a blind recount by a different counter.` : "Submitted for variance review.");
  } catch (e) {
    return actionError(e);
  }
}

export async function recountAction(id: string, lineId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await recordRecount(ctx, { lineId, qty: QTY.parse(str(fd, "qty")), idempotencyKey: str(fd, "idempotencyKey") || undefined });
    return done(id, "Recount saved; the first count is kept.");
  } catch (e) {
    return actionError(e);
  }
}

export async function approveCountAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const lines: Record<string, { reasonCode: string; note?: string }> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("reason_") && typeof v === "string" && v) {
        const lineId = k.slice(7);
        lines[lineId] = { reasonCode: v, note: str(fd, `note_${lineId}`) || undefined };
      }
    }
    const r = await approveCount(ctx, id, { lines, note: str(fd, "note") || null });
    return done(id, r.status === "pending_approval" ? "Approved (step 1). A second approval is needed above the threshold." : "Variances approved. Post the count to adjust stock.");
  } catch (e) {
    return actionError(e);
  }
}

export async function rejectLinesAction(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await rejectCountLines(ctx, id, { lineIds: fd.getAll("lineIds").map(String), note: str(fd, "reason") });
    return done(id, `${r.lines} line(s) sent back for a blind recount.`);
  } catch (e) {
    return actionError(e);
  }
}

export async function postCountAction(id: string, idempotencyKey: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await postCount(ctx, id, idempotencyKey);
    return done(id, `Posted: ${r.movements} adjustment movement(s); the locations are unfrozen.`);
  } catch (e) {
    return actionError(e);
  }
}
