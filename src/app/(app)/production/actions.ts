"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { createBatch, startBatch } from "@/modules/production";

const uuid = z.string().uuid("Choose a valid option.");
const decimalStr = (label: string) => z.string().trim().regex(/^\d+(\.\d+)?$/, `Enter ${label} as a number, for example 17.6.`);
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

const CreateSchema = z.object({
  formulaRevisionId: uuid,
  plannedSizeKg: decimalStr("the batch size in kg"),
  plannedStartOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the planned start date."),
  idempotencyKey: z.string().min(8).max(100),
});

export async function createBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let batchId: string;
  try {
    const ctx = await requireContext();
    const input = CreateSchema.parse({
      formulaRevisionId: str(fd, "formulaRevisionId"),
      plannedSizeKg: str(fd, "plannedSizeKg"),
      plannedStartOn: str(fd, "plannedStartOn"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    ({ batchId } = await createBatch(ctx, input));
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/production");
  redirect(`/production/${batchId}`);
}

export async function startBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const batchId = uuid.parse(str(fd, "batchId"));
    const r = await startBatch(ctx, batchId);
    revalidatePath(`/production/${batchId}`);
    revalidatePath("/production");
    return { ok: true, message: `Materials confirmed for batch ${r.batchNumber}. Sign the weighing-area line clearance to start it.` };
  } catch (e) {
    return toActionState(e);
  }
}

// Batch execution actions (weighing, steps, packaging, yield, transfer) live in ./[batchId]/actions.ts (W2B).
