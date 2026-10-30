/**
 * ADR-080 §1 (V2-1): the production order status read model, one test per mapping row, and the
 * V2-2 next-action table (one primary button per state; one button per batch on multi-batch orders).
 */
import { describe, expect, it } from "vitest";
import {
  batchStatusView,
  isLate,
  piecesText,
  productionOrderStatus,
  progressSteps,
  shortDay,
  workOrderStatusesFor,
  type BatchFact,
} from "@/modules/production/production-order-status";
import { productionOrderActions, type ActionCan } from "@/modules/production/production-order-next";

const NOW = new Date("2026-10-30T02:00:00Z"); // Fri 30 Oct 2026, 10:00 in Manila
const SOAP_STEPS = [
  { stepNo: 1, name: "Start check", stepKind: "line_clearance" },
  { stepNo: 2, name: "Weigh", stepKind: "dispensing" },
  { stepNo: 3, name: "Mix and pour", stepKind: "process" },
  { stepNo: 4, name: "Set in mould", stepKind: "curing" },
  { stepNo: 5, name: "Cut", stepKind: "cutting" },
  { stepNo: 6, name: "Cure", stepKind: "curing" },
  { stepNo: 7, name: "Wrap and label", stepKind: "packaging" },
  { stepNo: 8, name: "Finish", stepKind: "transfer" },
];
const done = (stepNo: number) => ({ stepNo, name: SOAP_STEPS[stepNo - 1].name, kind: SOAP_STEPS[stepNo - 1].stepKind, status: "completed", earliestCompletionAt: null });
let n = 0;
const batch = (status: string, extra: Partial<BatchFact> = {}): BatchFact => ({ id: `b${++n}`, batchNumber: `AS-2611-0${n}`, status, startedAt: ["draft", "planned", "materials_staged"].includes(status) ? null : "2026-10-20T01:00:00Z", plannedSteps: SOAP_STEPS, ...extra });
const st = (wo: string, bs: BatchFact[] = []) => productionOrderStatus(wo, bs, NOW);

describe("status mapping (ADR-080 §1), one row each", () => {
  it("draft and planned work orders are Draft", () => {
    expect(st("draft").status).toBe("draft");
    expect(st("planned").status).toBe("draft");
    expect(st("draft").label).toBe("Draft");
  });

  it("cancelled is Cancelled whatever the batches", () => {
    expect(st("cancelled", [batch("rejected", { startedAt: null })]).status).toBe("cancelled");
  });

  it("released with a planned batch and nothing taken is Approved without subtitle", () => {
    const v = st("released", [batch("planned")]);
    expect([v.status, v.subtitle]).toEqual(["approved", null]);
  });

  it("released with a planned batch and at least one material taken is Approved · Getting materials", () => {
    expect(st("released", [batch("planned", { materialsTaken: 1, materialsTotal: 6 })]).subtitle).toBe("Getting materials");
  });

  it("materials_staged is Approved · Materials ready", () => {
    expect(st("released", [batch("materials_staged")])).toMatchObject({ status: "approved", subtitle: "Materials ready" });
  });

  it("in_process with an open curing step not over is In progress · Curing until <date> (Curing is not a status)", () => {
    const v = st("in_progress", [batch("in_process", { stepRecords: [done(1), done(2), done(3), done(4), done(5), { stepNo: 6, name: "Cure", kind: "curing", status: "in_progress", earliestCompletionAt: "2026-11-28T02:00:00Z" }] })]);
    expect(v.status).toBe("in_progress");
    expect(v.subtitle).toBe("Curing until Sat 28 Nov");
    expect(v.stepNote).toBe("Step 6 of 8 · Curing until Sat 28 Nov");
  });

  it("a hold step ending today shows the time: Resting until 14:00", () => {
    const v = st("in_progress", [batch("in_process", { stepRecords: [{ stepNo: 4, name: "Rest", kind: "hold", status: "in_progress", earliestCompletionAt: "2026-10-30T06:00:00Z" }] })]);
    expect(v.subtitle).toBe("Resting until 14:00");
  });

  it("an open curing step whose time is over shows Curing time over", () => {
    const v = st("in_progress", [batch("in_process", { stepRecords: [{ stepNo: 4, name: "Set in mould", kind: "curing", status: "in_progress", earliestCompletionAt: "2026-10-29T02:00:00Z" }] })]);
    expect(v).toMatchObject({ status: "in_progress", subtitle: "Curing time over" });
  });

  it("in_process otherwise shows the current step name, or the next step not done", () => {
    expect(st("in_progress", [batch("in_process", { stepRecords: [done(1), { stepNo: 2, name: "Weigh", kind: "dispensing", status: "in_progress", earliestCompletionAt: null }] })]).subtitle).toBe("Weigh");
    expect(st("in_progress", [batch("in_process", { stepRecords: [done(1), done(2)] })]).subtitle).toBe("Mix and pour");
    expect(st("in_progress", [batch("in_process", { stepRecords: [done(1), done(2), { stepNo: 3, name: "Mix and pour", kind: "process", status: "awaiting_check", earliestCompletionAt: null }] })]).subtitle).toBe("Mix and pour · waiting for a check");
  });

  it("in_process with every step done is In progress · Ready to finish", () => {
    expect(st("in_progress", [batch("in_process", { stepRecords: SOAP_STEPS.map((s) => done(s.stepNo)) })])).toMatchObject({ status: "in_progress", subtitle: "Ready to finish" });
  });

  it("rework_approved is In progress · Redo", () => {
    expect(st("in_progress", [batch("rework_approved")])).toMatchObject({ status: "in_progress", subtitle: "Redo" });
  });

  it("awaiting_qc and quarantined are Quality check, NOT Done, even when the work order is completed", () => {
    expect(st("completed", [batch("awaiting_qc")]).status).toBe("quality_check");
    expect(st("completed", [batch("quarantined")]).status).toBe("quality_check");
    expect(st("in_progress", [batch("quarantined")]).subtitle).toBeNull();
  });

  it("a finished lot on hold (QA said Not yet) is Quality check · On hold in amber", () => {
    expect(st("completed", [batch("quarantined", { lotStatus: "on_hold" })])).toMatchObject({ status: "quality_check", subtitle: "On hold", warn: true });
  });

  it("every live batch passed (released, or closed without rejection) is Done", () => {
    expect(st("completed", [batch("released")]).status).toBe("done");
    expect(st("closed", [batch("closed")])).toMatchObject({ status: "done", warning: null });
  });

  it("some batches failed: Done with a warning; every batch failed: Failed (never 'Done · Failed')", () => {
    expect(st("completed", [batch("closed"), batch("rejected")])).toMatchObject({ status: "done", warning: "1 of 2 batches failed" });
    expect(st("closed", [batch("closed", { everRejected: true })]).status).toBe("failed");
    expect(st("completed", [batch("rejected")]).label).toBe("Failed");
  });

  it("a batch abandoned before it started does not count", () => {
    const v = st("released", [batch("rejected", { startedAt: null }), batch("planned")]);
    expect(v.status).toBe("approved");
    expect(v.batchesTotal).toBe(1);
  });

  it("legacy orders without batches: released → Approved, in_progress → In progress, completed/closed → Done", () => {
    expect(st("released").status).toBe("approved");
    expect(st("in_progress").status).toBe("in_progress");
    expect(st("completed").status).toBe("done");
    expect(st("closed").status).toBe("done");
  });

  it("multi-batch: the least advanced undecided batch wins and the order says 1 of 2 done", () => {
    const v = st("in_progress", [batch("closed"), batch("in_process", { stepRecords: [done(1)] })]);
    expect(v).toMatchObject({ status: "in_progress", batchesNote: "1 of 2 done", batchesDone: 1, batchesTotal: 2 });
    const w = st("in_progress", [batch("quarantined"), batch("planned")]);
    expect(w.status).toBe("approved");
    expect(w.batchesNote).toBe("0 of 2 done");
  });

  it("rejects unknown states", () => {
    expect(() => st("bogus")).toThrow();
    expect(() => batchStatusView(batch("bogus"))).toThrow();
  });
});

describe("strip, filters, late, pieces", () => {
  it("the strip has 5 steps; Failed and Cancelled show no strip", () => {
    expect(progressSteps("quality_check")!.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
    expect(progressSteps("done")!.every((s) => s.state === "done")).toBe(true);
    expect(progressSteps("failed")).toBeNull();
    expect(progressSteps("cancelled")).toBeNull();
  });

  it("the SQL pre-filter of each status contains every work order status that can map to it", () => {
    expect(workOrderStatusesFor("quality_check")).toContain("completed");
    expect(workOrderStatusesFor("open")).toContain("completed");
    expect(workOrderStatusesFor("open")).not.toContain("cancelled");
  });

  it("late = needed-by before today and not Done or Cancelled", () => {
    expect(isLate("2026-10-29", "in_progress", "2026-10-30")).toBe(true);
    expect(isLate("2026-10-29", "quality_check", "2026-10-30")).toBe(true);
    expect(isLate("2026-10-30", "in_progress", "2026-10-30")).toBe(false);
    expect(isLate("2026-10-29", "done", "2026-10-30")).toBe(false);
    expect(isLate("2026-10-29", "cancelled", "2026-10-30")).toBe(false);
    expect(isLate(null, "draft", "2026-10-30")).toBe(false);
  });

  it("quantities in pieces first", () => {
    expect(piecesText("247", "Soap", 2)).toBe("247 bars · 2 batches");
    expect(piecesText("1", "Lotion", 1)).toBe("1 piece · 1 batch");
    expect(piecesText(null, "Soap", 1)).toBe("1 batch");
    expect(shortDay("2026-11-28T02:00:00Z")).toBe("Sat 28 Nov");
  });
});

describe("next action table (V2-2): one primary button per state", () => {
  const all: ActionCan = { can: () => true, userId: "u-me" };
  const none: ActionCan = { can: () => false, userId: "u-me" };
  const approver = { can: true, sodConflict: false };
  const act = (wo: string, bs: BatchFact[], u: ActionCan = all, ap = approver) => productionOrderActions(productionOrderStatus(wo, bs, NOW), { siteId: "s1", cancelReason: "Customer cancelled" }, u, ap);
  const label = (a: ReturnType<typeof act>["primary"]) => (a.kind === "link" || a.kind === "approve" ? a.label : a.kind);

  const rows: [string, string, BatchFact[], string][] = [
    ["Draft", "draft", [], "Approve"],
    ["Approved", "released", [batch("planned")], "Get materials"],
    ["Approved · Getting materials", "released", [batch("planned", { materialsTaken: 2 })], "Get materials"],
    ["Approved · Materials ready", "released", [batch("materials_staged")], "Start"],
    ["In progress · Weigh", "in_progress", [batch("in_process", { stepRecords: [done(1)] })], "Weigh"],
    ["In progress · Mix and pour", "in_progress", [batch("in_process", { stepRecords: [done(1), done(2)] })], "Mix and pour"],
    ["In progress · Curing until", "in_progress", [batch("in_process", { stepRecords: [{ stepNo: 6, name: "Cure", kind: "curing", status: "in_progress", earliestCompletionAt: "2026-11-28T02:00:00Z" }] })], "wait"],
    ["In progress · Curing time over", "in_progress", [batch("in_process", { stepRecords: [{ stepNo: 6, name: "Cure", kind: "curing", status: "in_progress", earliestCompletionAt: "2026-10-01T02:00:00Z" }] })], "Curing finished"],
    ["In progress · waiting for a check (by someone else)", "in_progress", [batch("in_process", { stepRecords: [{ stepNo: 3, name: "Mix and pour", kind: "process", status: "awaiting_check", earliestCompletionAt: null, conductedBy: "u-other" }] })], "Check Mix and pour"],
    ["In progress · Ready to finish", "in_progress", [batch("in_process", { stepRecords: SOAP_STEPS.map((s) => done(s.stepNo)) })], "Finish"],
    ["In progress · Redo", "in_progress", [batch("rework_approved")], "Redo"],
    ["Quality check", "completed", [batch("quarantined")], "Check quality"],
    ["Quality check · On hold", "completed", [batch("quarantined", { lotStatus: "on_hold" })], "Check quality"],
    ["Done", "closed", [batch("closed")], "none"],
    ["Failed", "closed", [batch("rejected")], "none"],
    ["Cancelled", "cancelled", [], "none"],
  ];
  it.each(rows)("%s → %s", (_name, wo, bs, expected) => {
    const r = act(wo, bs);
    expect(label(r.primary)).toBe(expected);
    expect(r.perBatch).toEqual([]); // single batch: no per-batch buttons
  });

  it("the person who did a step cannot check it: wait for another person", () => {
    const r = act("in_progress", [batch("in_process", { stepRecords: [{ stepNo: 3, name: "Mix and pour", kind: "process", status: "awaiting_check", earliestCompletionAt: null, conductedBy: "u-me" }] })]);
    expect(r.primary).toMatchObject({ kind: "wait", title: "Waiting for a check", who: { permission: "production.process_step_record.approve" } });
  });

  it("without the permission every link becomes a wait with who can help (role escalation is never offered)", () => {
    for (const [, wo, bs] of rows) {
      const r = act(wo, bs, none, { can: false, sodConflict: false });
      expect(["wait", "none"]).toContain(r.primary.kind);
    }
    expect(act("released", [batch("planned")], none).primary).toMatchObject({ kind: "wait", who: { permission: "inventory.movement.post", siteId: "s1" } });
  });

  it("stage G3: Finish opens the Finish screen and Check quality the one-page check of that batch", () => {
    const fin = act("in_progress", [batch("in_process", { stepRecords: SOAP_STEPS.map((s) => done(s.stepNo)) })]).primary;
    expect(fin).toMatchObject({ kind: "link", label: "Finish" });
    expect(fin.kind === "link" && fin.href).toMatch(/^\/production\/[^/]+\/finish$/);
    const qb = batch("quarantined");
    expect(act("completed", [qb]).primary).toMatchObject({ kind: "link", label: "Check quality", href: `/quality/check/${qb.id}` });
    expect(act("completed", [batch("quarantined", { lotStatus: "on_hold" })]).primary).toMatchObject({ kind: "link", href: expect.stringMatching(/^\/quality\/check\//) });
  });

  it("draft: separation of duties makes the creator wait for another approver", () => {
    expect(act("draft", [], all, { can: true, sodConflict: true }).primary).toMatchObject({ kind: "wait", title: "Another person approves" });
  });

  it("multi-batch: one button per batch; the primary is the batch the user can act on that is furthest along", () => {
    const curing = batch("in_process", { stepRecords: [{ stepNo: 6, name: "Cure", kind: "curing", status: "in_progress", earliestCompletionAt: "2026-11-28T02:00:00Z" }] });
    const weigh = batch("in_process", { stepRecords: [done(1)] });
    const r = act("in_progress", [curing, weigh, batch("planned")]);
    expect(r.perBatch).toHaveLength(3);
    expect(r.perBatch.map((p) => label(p.action as never))).toEqual(["wait", "Weigh", "Get materials"]);
    expect(r.primary).toMatchObject({ kind: "link", label: "Weigh", batchId: weigh.id });
    const q = act("in_progress", [batch("quarantined"), weigh]);
    expect(label(q.primary)).toBe("Check quality");
  });
});
