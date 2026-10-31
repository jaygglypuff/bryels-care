/**
 * One path for production work (owner complaint 2026-10-31: the operator landed on the OLD batch
 * workspace on "Step 6 of 7 Packaging and labeling"). Every "do work" link of a batch that is being made
 * opens a production flow screen (flow-paths.ts), never `/production/<batchId>` (now the read-only
 * batch record). Checked twice: by calling the next-action builders for every state, with and without a
 * production order, and grep-style over the modules and screens that build work links.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { batchNextAction, type ActionCan } from "@/modules/production/production-order-next";
import { batchStatusView, type BatchFact } from "@/modules/production/production-order-status";
import { nextBatchScreen, type BatchFlowFacts } from "@/modules/production/flow-facts";
import { NO_ORDER_SEGMENT, continueHref, flowHref, isOldWorkspaceHref } from "@/modules/production/flow-paths";
import { batchScanHref } from "@/modules/inventory/lookup";

const NOW = new Date("2026-10-30T02:00:00Z");
const STEPS = [
  { stepNo: 1, name: "Start check", stepKind: "line_clearance" },
  { stepNo: 2, name: "Weigh", stepKind: "dispensing" },
  { stepNo: 3, name: "Mix and pour", stepKind: "process" },
  { stepNo: 4, name: "Cure", stepKind: "curing" },
  { stepNo: 5, name: "Before wrapping check", stepKind: "line_clearance" },
  { stepNo: 6, name: "Packaging and labeling", stepKind: "packaging" },
  { stepNo: 7, name: "Finish", stepKind: "transfer" },
];
const BATCH = "0195f0a2-1111-7000-8000-000000000001";
const ORDER = "0195f0a2-2222-7000-8000-000000000002";
const done = (n: number) => ({ stepNo: n, name: STEPS[n - 1].name, kind: STEPS[n - 1].stepKind, status: "completed", earliestCompletionAt: null, conductedBy: "u-doer" });
const open = (n: number, status = "in_progress", extra: Record<string, unknown> = {}) => ({ stepNo: n, name: STEPS[n - 1].name, kind: STEPS[n - 1].stepKind, status, earliestCompletionAt: null, conductedBy: "u-doer", ...extra });

/** Every in-progress situation the operator Home, My work and the order page can show. */
const CASES: { name: string; fact: Partial<BatchFact> & { status: string } }[] = [
  { name: "materials not taken (planned)", fact: { status: "planned" } },
  { name: "materials ready (start check)", fact: { status: "materials_staged" } },
  { name: "start check waiting for its second check", fact: { status: "materials_staged", stepRecords: [open(1, "awaiting_check")] } },
  { name: "weighing", fact: { status: "in_process", stepRecords: [done(1), open(2)] } },
  { name: "mix step", fact: { status: "in_process", stepRecords: [done(1), done(2)] } },
  { name: "mix step waiting for a check", fact: { status: "in_process", stepRecords: [done(1), done(2), open(3, "awaiting_check")] } },
  { name: "curing, not over", fact: { status: "in_process", stepRecords: [done(1), done(2), done(3), open(4, "in_progress", { earliestCompletionAt: "2026-11-28T02:00:00Z" })] } },
  { name: "curing, over", fact: { status: "in_process", stepRecords: [done(1), done(2), done(3), open(4, "in_progress", { earliestCompletionAt: "2026-10-29T02:00:00Z" })] } },
  { name: "step 6 packaging and labeling", fact: { status: "in_process", stepRecords: [done(1), done(2), done(3), done(4), done(5)] } },
  { name: "packaging waiting for a check", fact: { status: "in_process", stepRecords: [done(1), done(2), done(3), done(4), done(5), open(6, "awaiting_check")] } },
  { name: "finish", fact: { status: "in_process", stepRecords: [done(1), done(2), done(3), done(4), done(5), done(6)] } },
  { name: "redo (rework approved)", fact: { status: "rework_approved", stepRecords: STEPS.map((s) => done(s.stepNo)) } },
  { name: "quality check", fact: { status: "awaiting_qc", stepRecords: STEPS.map((s) => done(s.stepNo)) } },
];

const ALL: ActionCan = { can: () => true, userId: "u-checker" };
const DOER: ActionCan = { can: () => true, userId: "u-doer" };

function expectFlowHref(href: string, order: string | null) {
  expect(isOldWorkspaceHref(href), href).toBe(false);
  expect(href, href).toMatch(
    new RegExp(`^(/production/orders/${order ?? NO_ORDER_SEGMENT}/(materials|weigh|step/\\d+)\\?batch=${BATCH}|/production/${BATCH}/finish|/quality/check/${BATCH})$`),
  );
}

describe("next action of a batch (order page, My work, Home) never opens the old batch workspace", () => {
  for (const order of [ORDER, null]) {
    for (const c of CASES) {
      it(`${c.name} · ${order ? "with an order" : "without an order"}`, () => {
        const fact: BatchFact = { id: BATCH, batchNumber: "AS-1", startedAt: c.fact.status === "planned" ? null : "2026-10-20T01:00:00Z", plannedSteps: STEPS, ...c.fact };
        const view = { ...batchStatusView(fact, NOW), id: BATCH, batchNumber: "AS-1" };
        for (const u of [ALL, DOER]) {
          const a = batchNextAction(view, "s1", u, order);
          if (a.kind === "link") expectFlowHref(a.href, order);
        }
      });
    }
  }

  it("Start goes to the Start check step; its second check goes to the same step for the checker, and is a wait for the doer", () => {
    const staged = { ...batchStatusView({ id: BATCH, batchNumber: "AS-1", status: "materials_staged", startedAt: null, plannedSteps: STEPS }, NOW), id: BATCH, batchNumber: "AS-1" };
    expect(batchNextAction(staged, "s1", ALL, ORDER)).toMatchObject({ kind: "link", label: "Start", href: flowHref({ batchId: BATCH, workOrderId: ORDER }, "step/1") });
    const waiting = { ...batchStatusView({ id: BATCH, batchNumber: "AS-1", status: "materials_staged", startedAt: null, plannedSteps: STEPS, stepRecords: [open(1, "awaiting_check")] }, NOW), id: BATCH, batchNumber: "AS-1" };
    expect(batchNextAction(waiting, "s1", ALL, ORDER)).toMatchObject({ kind: "link", label: "Check Start check", href: flowHref({ batchId: BATCH, workOrderId: ORDER }, "step/1") });
    expect(batchNextAction(waiting, "s1", DOER, ORDER)).toMatchObject({ kind: "wait", who: { permission: "production.line_clearance.approve" } });
  });

  it("the packaging step and its check open step 6 of the flow (the screen of the owner's complaint)", () => {
    const pk = { ...batchStatusView({ id: BATCH, batchNumber: "AS-1", status: "in_process", startedAt: "2026-10-20T01:00:00Z", plannedSteps: STEPS, stepRecords: [done(1), done(2), done(3), done(4), done(5)] }, NOW), id: BATCH, batchNumber: "AS-1" };
    expect(batchNextAction(pk, "s1", ALL, null)).toMatchObject({ kind: "link", label: "Packaging and labeling", href: `/production/orders/${NO_ORDER_SEGMENT}/step/6?batch=${BATCH}` });
  });

  it("without the permission the action is a wait, never a link (role escalation is not offered)", () => {
    const none: ActionCan = { can: () => false, userId: "u-x" };
    for (const c of CASES) {
      const fact: BatchFact = { id: BATCH, batchNumber: "AS-1", startedAt: null, plannedSteps: STEPS, ...c.fact };
      const a = batchNextAction({ ...batchStatusView(fact, NOW), id: BATCH, batchNumber: "AS-1" }, "s1", none, ORDER);
      expect(a.kind, c.name).not.toBe("link");
    }
  });
});

describe("next screen of a batch (flow facts) never opens the old batch workspace", () => {
  const facts = (status: string, currentStep: BatchFlowFacts["currentStep"], workOrderId: string | null): BatchFlowFacts => ({
    batchId: BATCH,
    batchNumber: "AS-1",
    workOrderId,
    status,
    pick: { lines: 3, taken: status === "planned" ? 0 : 3, notNeeded: 0, complete: status !== "planned" },
    currentStep,
    readyAt: null,
  });
  const step = (n: number, status: "pending" | "in_progress" | "awaiting_check" = "pending") => ({ stepNo: n, name: STEPS[n - 1].name, kind: STEPS[n - 1].stepKind, status, index: n, total: STEPS.length, startedAt: null, readyAt: null, waiting: false, waitingLabel: null });
  for (const order of [ORDER, null]) {
    it(`every status · ${order ? "with an order" : "without an order"}`, () => {
      const rows: [string, BatchFlowFacts["currentStep"]][] = [
        ["planned", step(1)],
        ["materials_staged", step(1)],
        ["materials_staged", null],
        ["in_process", step(2, "in_progress")],
        ["in_process", step(3, "awaiting_check")],
        ["in_process", step(6)],
        ["in_process", step(7)],
        ["in_process", null],
        ["rework_approved", null],
        ["awaiting_qc", null],
        ["quarantined", null],
      ];
      for (const [status, cur] of rows) {
        const s = nextBatchScreen(facts(status, cur, order), NOW, STEPS);
        expect(s.href, `${status} ${cur?.stepNo ?? "-"}`).not.toBeNull();
        expectFlowHref(s.href!, order);
      }
    });
  }
});

describe("callers that only know the batch go through 'continue' (a redirect to the next flow screen)", () => {
  it("continueHref and the scanner use the flow, not the old workspace, while the batch is being made", () => {
    expect(continueHref({ batchId: BATCH, workOrderId: ORDER })).toBe(`/production/orders/${ORDER}/continue?batch=${BATCH}`);
    expect(continueHref({ batchId: BATCH, workOrderId: null })).toBe(`/production/orders/${NO_ORDER_SEGMENT}/continue?batch=${BATCH}`);
    for (const status of ["planned", "materials_staged", "in_process", "rework_approved"]) {
      expect(isOldWorkspaceHref(batchScanHref({ id: BATCH, status, workOrderId: null }))).toBe(false);
      expect(batchScanHref({ id: BATCH, status, workOrderId: ORDER })).toBe(`/production/orders/${ORDER}/continue?batch=${BATCH}`);
    }
    // A finished batch opens its record (what happened), which is the right place.
    expect(batchScanHref({ id: BATCH, status: "released", workOrderId: null })).toBe(`/production/${BATCH}`);
    expect(NO_ORDER_SEGMENT).toBe("without-order");
  });
});

/* ------------------------------------------------------------------ grep-style guard */

const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

/** Files that build "do work" links: the next-action tables, tasks, notifications and the flow screens. */
const WORK_LINK_FILES = [
  "src/modules/production/production-order-next.ts",
  "src/modules/production/floor-tasks.ts",
  "src/modules/production/flow-facts.ts",
  "src/modules/production/curing.ts",
  "src/modules/production/board.ts",
  "src/modules/production/step-cards.ts",
  "src/modules/production/weigh-cards.ts",
  "src/modules/production/materials-list.ts",
  "src/modules/inventory/lookup.ts",
  ...walk(path.join(ROOT, "src/app/(app)/production/orders")).map((p) => path.relative(ROOT, p)),
  "src/app/(app)/production/staging/[batchId]/page.tsx",
  "src/app/(app)/production/work-orders/[workOrderId]/page.tsx",
  "src/app/(app)/quality/inspections/page.tsx",
];
/** A template literal that is exactly `/production/${…}` (optionally with ?query): the old batch workspace. */
const OLD_WORKSPACE = /`\/production\/\$\{[^}]+\}(\?[^`]*)?`/;

describe("grep: no module builds a work link to /production/${batchId}", () => {
  for (const f of WORK_LINK_FILES) {
    it(f, () => {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      const hits = src.split("\n").filter((l) => OLD_WORKSPACE.test(l) && !/batchScanHref|BATCH_BEING_MADE/.test(l));
      // lookup.ts's batchScanHref opens the record only for finished batches (tested above).
      expect(hits.filter((l) => !l.includes("BATCH_BEING_MADE.includes")), f).toEqual([]);
    });
  }

  it("the batch record page has no old action forms (packaging issue, step complete, checklist, yield, transfer)", () => {
    const src = readFileSync(path.join(ROOT, "src/app/(app)/production/[batchId]/page.tsx"), "utf8");
    for (const form of ["PackagingIssueForm", "CompleteStepForm", "ChecklistForm", "WeighForm", "ReadingForm", "EquipmentForm", "ExceptionForm", "PackagingCountForm", "YieldForm", "ScrapForm", "TransferForm", "StartBatchForm", "OneTap"]) {
      expect(new RegExp(`\\b${form}\\b`).test(src), form).toBe(false);
    }
    expect(src).toContain("Continue this batch");
  });

  it("the packaging step never asks to type a BC:LOT code", () => {
    const src = readFileSync(path.join(ROOT, "src/app/(app)/production/orders/[workOrderId]/step/[n]/packaging-box.tsx"), "utf8");
    expect(src).not.toMatch(/scan or type it/i);
    expect(src).not.toMatch(/name="lotRef"[^>]*font-mono/);
    expect(src).toContain("Scan with camera");
  });
});
