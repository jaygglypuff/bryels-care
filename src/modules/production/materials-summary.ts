/**
 * The one-line summary at the top of Get materials (UX re-audit 2026-11-01 N1). "Every line is taken" is said only
 * when every line really is ticked Taken or Not needed. A batch that went past getting materials without this list
 * being ticked (an older batch, a batch made without a production order whose materials were checked another way)
 * says so, and its lines read "Not ticked", never "Not yet" (nothing is left to do here). Pure, unit-tested in
 * tests/unit/materials-summary.test.ts.
 */
export type MaterialsSummary =
  | { kind: "open"; title: null; text: null; lineWord: "Not yet" }
  | { kind: "all_taken"; title: "Materials ready"; text: string; lineWord: "Not yet" }
  | { kind: "past_without_list"; title: string; text: string; lineWord: "Not ticked" };

export function materialsSummary(batchStatus: string, progress: { lines: number; taken: number; notNeeded: number }): MaterialsSummary {
  const ready = batchStatus !== "planned" && batchStatus !== "draft";
  if (!ready) return { kind: "open", title: null, text: null, lineWord: "Not yet" };
  const done = progress.taken + progress.notNeeded;
  if (done >= progress.lines) return { kind: "all_taken", title: "Materials ready", text: "Every line is taken.", lineWord: "Not yet" };
  const started = batchStatus !== "materials_staged";
  return {
    kind: "past_without_list",
    title: started ? "Getting materials is over for this batch" : "Materials ready",
    text: `This batch ${started ? "went on" : "was made ready"} without ticking this list (${done} of ${progress.lines} lines ticked). Nothing is left to do here.`,
    lineWord: "Not ticked",
  };
}
