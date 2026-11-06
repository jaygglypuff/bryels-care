"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { generateBatchSheet } from "@/modules/production";

/**
 * The paper backup prints of a batch (US-3-08, ADR-115 §1): the weighing sheet and the batch traveler. Opened from the
 * batch record's ⋯ More menu; the print page offers "Generate" when the batch has none yet. Thin adapter: the service
 * checks permission and site and freezes the dataset as a recorded document.
 */
export async function generateSheetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireContext();
    const batchId = z.string().uuid("Choose a valid option.").parse(fd.get("batchId"));
    const kind = z.enum(["dispensing_sheet", "traveler"]).parse(fd.get("kind"));
    const r = await generateBatchSheet(ctx, { batchId, kind, idempotencyKey: z.string().min(8).max(100).parse(fd.get("idempotencyKey")) });
    target = `/print/${kind === "traveler" ? "traveler" : "dispensing-sheet"}/${batchId}?doc=${r.id}`;
  } catch (e) {
    return toActionState(e);
  }
  redirect(target);
}
