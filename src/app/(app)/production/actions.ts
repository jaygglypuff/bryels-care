"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { completeBatch, completeStep, createBatch, recordDispense, startBatch } from "@/modules/production";

const uuid = z.string().uuid("Choose a valid option.");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : null));
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
    return { ok: true, message: `Batch ${r.batchNumber} started. Begin with step 1.` };
  } catch (e) {
    return toActionState(e);
  }
}

const DispenseSchema = z.object({
  batchId: uuid,
  batchMaterialId: uuid,
  lotLocation: z.string().regex(/^[0-9a-f-]{36}\|[0-9a-f-]{36}$/i, "Choose the lot you are weighing from."),
  actualQtyG: decimalStr("the actual weight in grams"),
  scaleCode: optText(40),
  checkerId: z.string().uuid("Choose the checker."),
  exceptionReason: optText(500),
  idempotencyKey: z.string().min(8).max(100),
});

export async function dispenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const input = DispenseSchema.parse({
      batchId: str(fd, "batchId"),
      batchMaterialId: str(fd, "batchMaterialId"),
      lotLocation: str(fd, "lotLocation"),
      actualQtyG: str(fd, "actualQtyG"),
      scaleCode: str(fd, "scaleCode"),
      checkerId: str(fd, "checkerId"),
      exceptionReason: str(fd, "exceptionReason"),
      idempotencyKey: str(fd, "idempotencyKey"),
    });
    const [lotId, fromLocationId] = input.lotLocation.split("|");
    const r = await recordDispense(ctx, { ...input, lotId, fromLocationId });
    revalidatePath(`/production/${input.batchId}`);
    return {
      ok: true,
      message: r.withinTolerance ? `${r.materialName} weighed and posted.` : `${r.materialName} recorded as an exception (outside tolerance). QA will see the flag.`,
    };
  } catch (e) {
    return toActionState(e);
  }
}

const StepSchema = z.object({
  batchId: uuid,
  stepNo: z.coerce.number().int().min(1).max(99),
  checkerId: z.string().uuid("Choose the checker."),
  readings: optText(500),
});

export async function completeStepAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const input = StepSchema.parse({ batchId: str(fd, "batchId"), stepNo: str(fd, "stepNo"), checkerId: str(fd, "checkerId"), readings: str(fd, "readings") });
    const r = await completeStep(ctx, input);
    revalidatePath(`/production/${input.batchId}`);
    revalidatePath("/production");
    return { ok: true, message: `Step ${r.stepNo} of ${r.total} (${r.name}) completed.` };
  } catch (e) {
    return toActionState(e);
  }
}

const CompleteSchema = z.object({
  batchId: uuid,
  actualUnits: z.string().trim().regex(/^\d+$/, "Enter the number of finished units as a whole number."),
  remarks: optText(1000),
  idempotencyKey: z.string().min(8).max(100),
});

export async function completeBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const input = CompleteSchema.parse({ batchId: str(fd, "batchId"), actualUnits: str(fd, "actualUnits"), remarks: str(fd, "remarks"), idempotencyKey: str(fd, "idempotencyKey") });
    const r = await completeBatch(ctx, input);
    revalidatePath(`/production/${input.batchId}`);
    revalidatePath("/production");
    return { ok: true, message: `Batch completed. Output lot ${r.lotNumber} is in quarantine awaiting QA.` };
  } catch (e) {
    return toActionState(e);
  }
}
