"use server";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { generateBmr } from "@/modules/production";

/** Generates (numbers, renders, hashes) the BMR of a batch and shows it ready to print. */
export async function generateBmrAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const batchId = String(f.get("batchId") ?? "");
  let documentId: string;
  try {
    const ctx = await requireContext();
    const r = await generateBmr(ctx, { batchId, idempotencyKey: String(f.get("idempotencyKey") ?? "") });
    documentId = r.documentId;
  } catch (e) {
    return toActionState(e);
  }
  redirect(`/print/bmr/${batchId}?doc=${documentId}`);
}
