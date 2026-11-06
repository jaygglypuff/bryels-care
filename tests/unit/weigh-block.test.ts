/**
 * Live check 2026-11-06 finding 2: the weigh card blamed the role when the batch was simply not started. The read
 * model returns a reason code (state before role) and the card shows the right sentence and one button; before
 * Save it names who checks ("After you save, Jun or Dino checks it").
 */
import { describe, expect, it } from "vitest";
import { checkerAfterSave, type NextActors } from "@/lib/next-actors-words";
import { weighBlockCode, weighBlockWords, type WeighBlockFacts } from "@/modules/production/weigh-block";

const base: WeighBlockFacts = { canCreate: true, batchStatus: "in_process", batchNumber: "B-26-0004", hasStep: true, stepDone: false, earlierStep: null };

describe("weighBlockCode", () => {
  it("a batch not started is a state problem, for an operator and for anyone else alike", () => {
    expect(weighBlockCode({ ...base, batchStatus: "materials_staged" })).toBe("not_started");
    expect(weighBlockCode({ ...base, batchStatus: "materials_staged", canCreate: false })).toBe("not_started");
    expect(weighBlockCode({ ...base, batchStatus: "planned" })).toBe("not_picked");
  });
  it("the role is blamed only when the batch is ready to weigh", () => {
    expect(weighBlockCode({ ...base, canCreate: false })).toBe("no_permission");
    expect(weighBlockCode(base)).toBeNull();
  });
  it("an earlier step, a finished step and a batch past weighing have their own reasons", () => {
    expect(weighBlockCode({ ...base, earlierStep: { stepNo: 1, name: "Check the area is clean" } })).toBe("earlier_step");
    expect(weighBlockCode({ ...base, stepDone: true })).toBe("step_done");
    expect(weighBlockCode({ ...base, batchStatus: "awaiting_qc" })).toBe("past_weighing");
    expect(weighBlockCode({ ...base, hasStep: false })).toBe("no_step");
  });
});

describe("weighBlockWords", () => {
  const f = { batchNumber: "B-26-0004", earlierStep: null, firstStepName: "Check the area is clean" };
  it("not started: start the batch with the clean-area check on step 1, one button", () => {
    const w = weighBlockWords("not_started", f);
    expect(w.sentence).toBe("Start the batch first: do the clean-area check on step 1.");
    expect(w.button).toEqual({ label: "Go to step 1", target: "first_step" });
    expect(w.sentence).not.toMatch(/role/i);
  });
  it("materials not taken yet: get the materials first", () => {
    const w = weighBlockWords("not_picked", f);
    expect(w.sentence).toBe("Start the batch first: get the materials, then do the clean-area check on step 1.");
    expect(w.button?.target).toBe("materials");
  });
  it("only the role case says 'Your role cannot weigh'", () => {
    expect(weighBlockWords("no_permission", f).sentence).toBe("Your role cannot weigh. Ask an operator.");
    expect(weighBlockWords("no_permission", f).button).toBeNull();
  });
});

describe("checkerAfterSave", () => {
  const n = (people: { name: string; role: string }[]): NextActors => ({
    kind: "weighing_check",
    does: "checks this weighing",
    doBase: "check this weighing",
    where: "on their Home",
    people: people.map((p, i) => ({ userId: String(i), ...p })),
    roleWords: "an operator",
    viewer: { can: false, selfApproval: false, note: null },
    stepNo: null,
    stepsTotal: null,
  });
  it("names the checkers by first name", () => {
    expect(checkerAfterSave(n([{ name: "Jun Dela Cruz", role: "operator" }, { name: "Dino Reyes", role: "site manager" }]))).toBe("After you save, Jun or Dino checks it.");
  });
  it("says so when nobody else can check", () => {
    expect(checkerAfterSave(n([]))).toBe("After you save, an operator checks it. Nobody else here can check it yet.");
  });
});
