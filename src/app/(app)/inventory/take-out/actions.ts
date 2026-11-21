"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { approveTakeout, cancelTakeout, countWhatIsLeft, createTakeout, rejectTakeout, takeoutSourcesFor, takeoutSourcesForLabel, undoTakeout, type CountLeftResult, type SourceView, type TakeoutResult } from "@/modules/inventory";
import { actionError, str } from "../_kit/action-state";

/**
 * Server actions of "Take a few out", "Count what's left" and the take-out page (ADR-138). Thin adapters: parse,
 * call the inventory service (which checks permission, site, stock and limits), return the result in words.
 */

export type Lookup = { ok: true; sources: SourceView[] } | { ok: false; message: string };

/** A scanned or typed box / lot label → where the pieces can come from. */
export async function takeoutLookupAction(raw: string): Promise<Lookup> {
  try {
    const ctx = await requireContext();
    return await takeoutSourcesForLabel(ctx, String(raw ?? ""));
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Could not look it up. Try again." };
  }
}

/** A tapped product → its sources in the order to use them. */
export async function takeoutProductAction(productId: string): Promise<Lookup> {
  try {
    const ctx = await requireContext();
    const sources = await takeoutSourcesFor(ctx, String(productId ?? ""));
    if (!sources.length) return { ok: false, message: "No free pieces of this product here (released, in date, not set aside)." };
    return { ok: true, sources };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Could not look it up. Try again." };
  }
}

const TakeoutSchema = z
  .object({
    idempotencyKey: z.string().min(8, "The form is not ready yet. Wait a moment and try again.").max(80),
    purpose: z.string().max(40),
    channel: z.string().max(40).nullish(),
    platformOrderRef: z.string().max(80).nullish(),
    customerId: z.string().max(40).nullish(),
    recipientName: z.string().max(140).nullish(),
    note: z.string().max(600).nullish(),
    lines: z.array(z.object({ containerId: z.string().max(40).nullish(), lotId: z.string().max(40).nullish(), locationId: z.string().max(40).nullish(), productId: z.string().max(40).nullish(), pieces: z.string().max(12) }).strict()).min(1, "Add at least one product.").max(30),
  })
  .strict();

export type TakeoutOutcome = { ok: true; result: TakeoutResult } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function createTakeoutAction(input: z.input<typeof TakeoutSchema>): Promise<TakeoutOutcome> {
  try {
    const ctx = await requireContext();
    const result = await createTakeout(ctx, TakeoutSchema.parse(input));
    revalidatePath("/inventory");
    return { ok: true, result };
  } catch (e) {
    const s = actionError(e);
    return { ok: false, message: s?.message ?? "Nothing was saved.", fieldErrors: s?.fieldErrors };
  }
}

export async function undoTakeoutAction(id: string, reason: string): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await requireContext();
    const r = await undoTakeout(ctx, String(id), String(reason ?? ""));
    revalidatePath("/inventory");
    return { ok: true, message: `Undone. ${r.lines === 1 ? "The pieces are" : "All pieces are"} back in stock.` };
  } catch (e) {
    return { ok: false, message: actionError(e)?.message ?? "Undo failed." };
  }
}

export type CountOutcome = { ok: true; result: CountLeftResult } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function countLeftAction(input: { containerId?: string | null; lotId?: string | null; locationId?: string | null; counted: string; reasonCode?: string | null; note?: string | null; idempotencyKey: string }): Promise<CountOutcome> {
  try {
    const ctx = await requireContext();
    const result = await countWhatIsLeft(ctx, input);
    revalidatePath("/inventory");
    return { ok: true, result };
  } catch (e) {
    const s = actionError(e);
    return { ok: false, message: s?.message ?? "Nothing was saved.", fieldErrors: s?.fieldErrors };
  }
}

/* ---------------------------------------------------------------- take-out page (form actions, in place) */

export async function decideTakeoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = str(fd, "takeoutId");
    if (str(fd, "decision") === "approve") {
      const r = await approveTakeout(ctx, id, str(fd, "note") || null);
      refreshCurrentPage();
      return { ok: true, message: r.status === "posted" ? "OK given. The pieces are taken out of stock." : "Your OK is saved. It waits for the next OK." };
    }
    await rejectTakeout(ctx, id, str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Said no. Nothing left the stock." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function cancelTakeoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await cancelTakeout(ctx, str(fd, "takeoutId"), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Cancelled. Nothing left the stock." };
  } catch (e) {
    return toActionState(e);
  }
}

export async function undoTakeoutFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await undoTakeout(ctx, str(fd, "takeoutId"), str(fd, "reason"));
    refreshCurrentPage();
    return { ok: true, message: "Undone. The pieces are back in stock." };
  } catch (e) {
    return toActionState(e);
  }
}
