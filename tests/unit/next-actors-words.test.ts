import { describe, expect, it } from "vitest";
import { type NextActors, nextActorsSentence, peopleWords, personRole, roleCodesWords, waitingForNames } from "@/lib/next-actors-words";

const p = (name: string, role: string) => ({ userId: name, name, role });
const base: NextActors = {
  kind: "weighing_check",
  does: "checks this weighing",
  doBase: "check this weighing",
  where: "on their Home",
  people: [p("Rhea Mendoza", "operator"), p("Dino Reyes", "site manager")],
  roleWords: "an operator or the site manager",
  viewer: { can: false, selfApproval: false, note: null },
  stepNo: null,
  stepsTotal: null,
};

describe("who approves next, in words (docs/NEXT_APPROVER.md)", () => {
  it("names first names and role words", () => {
    expect(nextActorsSentence(base)).toBe("Next: Rhea (operator) or Dino (site manager) checks this weighing — they will see it on their Home.");
  });
  it("shows at most three names, then 'or N others'", () => {
    const five = [p("Ana A", "owner"), p("Ben B", "QA"), p("Cora C", "planner"), p("Dan D", "QA"), p("Eve E", "QA")];
    expect(peopleWords(five)).toBe("Ana (owner), Ben (QA), Cora (planner) or 2 others");
    expect(peopleWords(five.slice(0, 4))).toBe("Ana (owner), Ben (QA), Cora (planner) or 1 other");
    expect(waitingForNames({ ...base, people: five })).toBe("Ana, Ben, Cora or 2 others");
  });
  it("keeps full names when two shown people share a first name", () => {
    expect(peopleWords([p("Tess Navarro", "purchasing"), p("Tess Ocampo", "IT")])).toBe("Tess Navarro (purchasing) or Tess Ocampo (IT)");
  });
  it("says the step of a record with approval steps", () => {
    expect(nextActorsSentence({ ...base, does: "approves it", where: "in To approve", people: [p("Dino Reyes", "site manager")], stepNo: 1, stepsTotal: 2 })).toBe("Next: Dino (site manager) approves it (step 1 of 2) — they will see it in To approve.");
  });
  it("ADR-091: a top role reads that they may approve their own record", () => {
    const own = { ...base, viewer: { can: true, selfApproval: true, note: "You can approve this yourself because you are the owner." }, people: [] };
    expect(nextActorsSentence(own)).toBe("You can approve this yourself because you are the owner.");
    expect(nextActorsSentence({ ...own, people: [p("Dino Reyes", "site manager")] })).toBe("You can approve this yourself because you are the owner. Dino (site manager) can do it too.");
  });
  it("tells a viewer who can act, and who else can", () => {
    expect(nextActorsSentence({ ...base, viewer: { can: true, selfApproval: false, note: null }, people: [p("Jun Dela Cruz", "operator")] })).toBe("You can check this weighing now. So can Jun (operator).");
  });
  it("nobody holds the role yet: role words and how to fix it", () => {
    expect(nextActorsSentence({ ...base, people: [] })).toMatch(/^Next: an operator or the site manager checks this weighing\. Nobody can do it yet: an administrator/);
  });
  it("role words", () => {
    expect(personRole("production_operator")).toBe("operator");
    expect(personRole("custom_x", "Line Lead")).toBe("line lead");
    expect(roleCodesWords(["site_manager", "owner_director"], "x")).toBe("a site manager or the owner");
    expect(roleCodesWords([], "QA")).toBe("QA");
  });
});
