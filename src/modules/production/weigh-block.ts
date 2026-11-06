/**
 * Why the weigh card cannot save (live check 2026-11-06, finding 2). The card used to blame the role whenever
 * `canWeigh` was false, also when the batch was simply not started. The read model (getWeighView) now returns one
 * reason code, and this pure helper gives the sentence and the one button. Pure (unit tested in
 * tests/unit/weigh-block.test.ts).
 */
export type WeighBlockCode = "no_permission" | "not_picked" | "not_started" | "past_weighing" | "no_step" | "step_done" | "earlier_step";

export type WeighBlockFacts = {
  canCreate: boolean;
  batchStatus: string;
  batchNumber: string;
  hasStep: boolean;
  stepDone: boolean;
  /** The step before weighing that is not done yet ("Check the area is clean"), when the batch is in process. */
  earlierStep: { stepNo: number; name: string } | null;
};

export function weighBlockCode(f: WeighBlockFacts): WeighBlockCode | null {
  // State first: a batch that is not started blocks everyone, whatever their role.
  if (f.batchStatus === "planned") return "not_picked";
  if (f.batchStatus === "materials_staged") return "not_started";
  if (f.batchStatus !== "in_process") return "past_weighing";
  if (!f.hasStep) return "no_step";
  if (f.stepDone) return "step_done";
  if (f.earlierStep) return "earlier_step";
  if (!f.canCreate) return "no_permission";
  return null;
}

export type WeighBlockWords = { sentence: string; button: { label: string; target: "materials" | "first_step" | "earlier_step" } | null };

/** The sentence above the pale Save button, and the one button that fixes it (null when nobody here can fix it). */
export function weighBlockWords(code: WeighBlockCode, f: Pick<WeighBlockFacts, "batchNumber" | "earlierStep"> & { firstStepName: string | null }): WeighBlockWords {
  const first = f.firstStepName ? `the ${f.firstStepName.toLowerCase().startsWith("check") ? "clean-area check" : `"${f.firstStepName}"`} on step 1` : "step 1";
  switch (code) {
    case "not_picked":
      return { sentence: `Start the batch first: get the materials, then do ${first}.`, button: { label: "Get materials", target: "materials" } };
    case "not_started":
      return { sentence: `Start the batch first: do ${first}.`, button: { label: "Go to step 1", target: "first_step" } };
    case "earlier_step":
      return { sentence: `Finish step ${f.earlierStep!.stepNo} "${f.earlierStep!.name}" first.`, button: { label: `Go to step ${f.earlierStep!.stepNo}`, target: "earlier_step" } };
    case "past_weighing":
      return { sentence: `Batch ${f.batchNumber} is past weighing.`, button: null };
    case "no_step":
      return { sentence: "This batch has no weighing step.", button: null };
    case "step_done":
      return { sentence: "The weighing step is done.", button: null };
    case "no_permission":
      return { sentence: "Your role cannot weigh. Ask an operator.", button: null };
  }
}
