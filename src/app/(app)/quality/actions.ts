"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState, type ActionState } from "@/lib/errors";
import { decideBatch, decideLot } from "@/modules/quality/dispositions";
import { recordTestResult } from "@/modules/quality/tests";
import { MIN_REASON_LENGTH } from "@/modules/quality/rules";

const reason = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, `Give a reason of at least ${MIN_REASON_LENGTH} characters.`)
  .max(1000, "Reason is too long (max 1,000 characters).");

/** Like toActionState, but maps a DomainError's details.field onto the form field. */
function fail(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) {
    return { ...s, fieldErrors: { [e.details.field]: e.message } };
  }
  return s;
}

const LotDecisionSchema = z.object({
  lotId: z.string().min(1),
  decision: z.enum(["release", "release_from_hold", "hold", "reject"], { message: "Choose a decision." }),
  reason,
});

export async function decideLotAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const input = LotDecisionSchema.parse({ lotId: fd.get("lotId"), decision: fd.get("decision") ?? undefined, reason: fd.get("reason") ?? "" });
    const r = await decideLot(ctx, input);
    revalidatePath("/quality");
    revalidatePath(`/quality/lots/${input.lotId}`);
    const verb = { released: "released", on_hold: "placed on hold", rejected: "rejected" }[r.toStatus] ?? r.toStatus;
    return { ok: true, message: `Lot ${r.lotNumber} ${verb}.${r.movedTo ? ` Stock moved to ${r.movedTo}.` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

const BatchDecisionSchema = z.object({
  batchId: z.string().min(1),
  decision: z.enum(["release", "reject"], { message: "Choose a decision." }),
  reason,
});

export async function decideBatchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const input = BatchDecisionSchema.parse({ batchId: fd.get("batchId"), decision: fd.get("decision") ?? undefined, reason: fd.get("reason") ?? "" });
    const r = await decideBatch(ctx, input);
    revalidatePath("/quality");
    revalidatePath(`/quality/batches/${input.batchId}`);
    return {
      ok: true,
      message: `Batch ${r.batchNumber} ${r.toStatus}.${r.lotNumber ? ` Lot ${r.lotNumber} is ${r.toStatus}${r.movedTo ? ` and was moved to ${r.movedTo}` : ""}.` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

const TestResultSchema = z.object({
  batchId: z.string().min(1),
  testName: z.string().trim().min(1, "Enter the test name.").max(120),
  specification: z.string().trim().min(1, "Enter the specification.").max(200),
  result: z.string().trim().min(1, "Enter the result.").max(200),
  passed: z.enum(["pass", "fail"], { message: "Choose pass or fail." }),
});

export async function recordTestResultAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const input = TestResultSchema.parse({
      batchId: fd.get("batchId"),
      testName: fd.get("testName") ?? "",
      specification: fd.get("specification") ?? "",
      result: fd.get("result") ?? "",
      passed: fd.get("passed") ?? undefined,
    });
    const row = await recordTestResult(ctx, { ...input, passed: input.passed === "pass" });
    revalidatePath("/quality");
    revalidatePath(`/quality/batches/${input.batchId}`);
    return { ok: true, message: `Recorded ${row.testName}: ${row.result} (${row.passed ? "pass" : "fail"}).` };
  } catch (e) {
    return fail(e);
  }
}
