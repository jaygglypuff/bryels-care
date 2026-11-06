/**
 * ADR-110 C0 "How work flows": the 16 stages exactly as the C0 table of docs/END_TO_END_FLOW.md (stage words, order,
 * one button each), plain count words, the oldest-age words and the red rule (a count waits on nobody).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_COUNT_DEFS, FLOW_STAGES, ageWords, countWords, isFlowCountKey, stageRow, type FlowCount } from "@/modules/analytics/work-flow-stages";
import { PERMISSIONS } from "@/lib/permissions";
import { salesOrderSteps } from "@/ui/record-steps";

const C0 = [
  "Ask to buy",
  "Order from the supplier",
  "Delivery coming",
  "Receive and label",
  "QA check of deliveries",
  "Put away",
  "Customer orders",
  "Make it",
  "Get materials · weigh · steps · pack · finish",
  "QA OK of batches",
  "Set aside",
  "Get from shelf",
  "Second check of the box",
  "Send out",
  "Proof of delivery",
  "Invoice",
];

const count = (over: Partial<FlowCount>): FlowCount => ({ key: "pr_waiting", count: 0, capped: false, oldestAt: null, untold: 0, words: "", itemIds: [], ...over });

describe("How work flows: the 16 stages", () => {
  it("are the C0 table's stages, in order, numbered 1–16", () => {
    expect(FLOW_STAGES.map((s) => s.title)).toEqual(C0);
    expect(FLOW_STAGES.map((s) => s.n)).toEqual(C0.map((_, i) => i + 1));
  });

  it("the C0 table in the docs names the same stage words", () => {
    const doc = readFileSync(join(__dirname, "../../docs/END_TO_END_FLOW.md"), "utf8");
    for (const [i, t] of C0.entries()) expect(doc, t).toContain(`| ${i + 1} | ${t} |`);
  });

  it("each stage has who, one button to a screen and at least one count; count keys are unique", () => {
    for (const s of FLOW_STAGES) {
      expect(s.who.length, s.key).toBeGreaterThan(1);
      expect(s.button.href.startsWith("/"), s.key).toBe(true);
      expect(s.button.label.length, s.key).toBeGreaterThan(2);
      expect(s.counts.length, s.key).toBeGreaterThan(0);
    }
    const keys = FLOW_STAGES.flatMap((s) => s.counts.map((c) => c.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(FLOW_COUNT_DEFS.size).toBe(keys.length);
    expect(isFlowCountKey("so_to_pick")).toBe(true);
    expect(isFlowCountKey("anything")).toBe(false);
  });

  it("every count names real view permissions", () => {
    const all = new Set<string>(PERMISSIONS);
    for (const d of FLOW_COUNT_DEFS.values()) for (const p of d.permissions) expect(all.has(p), `${d.key} ${p}`).toBe(true);
  });

  it("the customer order stepper shows the order part of the same road", () => {
    const labels = salesOrderSteps("draft").map((s) => s.label);
    for (const t of ["Set aside", "Get from shelf", "Second check of the box", "Send out", "Proof of delivery", "Invoice"]) expect(labels).toContain(t);
  });
});

describe("How work flows: words and the red rule", () => {
  it("count words are plain plurals", () => {
    const d = FLOW_COUNT_DEFS.get("pr_waiting")!;
    expect(countWords(d, 1)).toBe("1 request waiting for approval");
    expect(countWords(d, 3)).toBe("3 requests waiting for approval");
    expect(countWords(d, 1200)).toBe("1,200 requests waiting for approval");
  });

  it("age words: today, 1 day, n days; never negative", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    expect(ageWords(null, now)).toBeNull();
    expect(ageWords(new Date("2026-11-06T02:00:00Z"), now)).toBe("today");
    expect(ageWords(new Date("2026-11-05T09:00:00Z"), now)).toBe("1 day");
    expect(ageWords(new Date("2026-10-30T10:00:00Z"), now)).toBe("7 days");
    expect(ageWords(new Date("2026-11-08T10:00:00Z"), now)).toBe("today");
  });

  it("a stage is red only when an item waits that nobody was told about", () => {
    const s = FLOW_STAGES[4];
    expect(stageRow(s, [count({ count: 2, untold: 0, itemIds: ["a", "b"] })]).waitsOnNobody).toBe(false);
    expect(stageRow(s, [count({ count: 2, untold: 1, itemIds: ["a", "b"] })]).waitsOnNobody).toBe(true);
    expect(stageRow(s, [count({ count: 0 })]).waitsOnNobody).toBe(false);
  });

  it("the stage total counts a record once; the oldest is the oldest of all counts", () => {
    const a = new Date("2026-11-01T00:00:00Z");
    const b = new Date("2026-11-03T00:00:00Z");
    const row = stageRow(FLOW_STAGES[6], [count({ key: "so_confirmed", count: 2, itemIds: ["x", "y"], oldestAt: b }), count({ key: "so_short", count: 1, itemIds: ["x"], oldestAt: a })]);
    expect(row.total).toBe(2);
    expect(row.oldestAt).toEqual(a);
  });
});
