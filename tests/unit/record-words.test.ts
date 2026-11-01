/**
 * UX re-audit 2026-11-01 (ADR-105): the batch record timeline, the order history, the Check quality exceptions and
 * the Get materials summary read in words. Stored keys and values are unchanged; only what people read changes.
 */
import { describe, expect, it } from "vitest";
import { auditSentence, batchStateWord, orderStateWord, ownerOverrideSentence, plainReason, wordsFromKey } from "@/modules/production/record-words";
import { materialsSummary } from "@/modules/production/materials-summary";

const RAW = /[a-z]+\.[a-z_]+\.[a-z_]+|[a-z]+_[a-z_]+ =|\(setting /;

describe("batch record timeline in words (re-audit N3)", () => {
  it("readings use the label of the steps setup, not the code", () => {
    const labels = { parameters: { oil_temp: "Oil temperature", trace_time: "Time to trace", mould_id: "Mould used" } };
    expect(auditSentence({ action: "production.process_step_reading.recorded", after: { stepNo: 4, parameter: "oil_temp", value: "30", uom: "°C" } }, labels)).toBe("Oil temperature: 30 °C");
    expect(auditSentence({ action: "production.process_step_reading.recorded", after: { parameter: "mould_id", value: "ABC" } }, labels)).toBe("Mould used: ABC");
    // Without a label (older snapshot) the code becomes words, never "mould_id = ABC".
    expect(auditSentence({ action: "production.process_step_reading.recorded", after: { parameter: "mould_id", value: "ABC" } })).toBe("Mould id: ABC");
  });

  it("the keys the re-audit saw raw read as sentences", () => {
    expect(auditSentence({ action: "production.batch.materials_confirmed" })).toBe("All materials taken to the making area");
    expect(auditSentence({ action: "production.equipment_use.ended", after: { equipment: "SC-01" } }, { equipment: { "SC-01": "Bench scale" } })).toBe("Machine Bench scale (SC-01) free again");
    expect(auditSentence({ action: "production.dispense_record.returned" })).toMatch(/sent a weighing back/);
    expect(plainReason("Owner override (setting governance.owner_override)")).toBe("The owner allowed it (owner override).");
    expect(plainReason("Spilled on the bench")).toBe("Spilled on the bench");
  });

  it("step names in sentences are plain (line clearance → clean-area check)", () => {
    expect(auditSentence({ action: "production.process_step_record.completed", after: { stepNo: 6, name: "Packaging area line clearance" } })).toBe("Step 6 (Packaging area clean-area check) done");
  });

  it("no known or unknown key ever shows raw", () => {
    const keys = [
      "production.batch.created", "production.batch.started", "production.batch.finished", "production.batch.closed", "production.batch.reopen_withdrawn",
      "production.dispense_record.recorded", "production.dispense_record.checked", "production.process_step_record.checked", "production.line_clearance.answered",
      "production.packaging_component.issued", "production.batch.label_lot_fixed", "governance.owner_override.used", "governance.self_approval.used",
      "production.work_order.planned", "production.production_order.approved", "something.new.never_seen",
    ];
    for (const k of keys) expect(auditSentence({ action: k, after: { forAction: "production.process_step_record.completed" } }), k).not.toMatch(RAW);
    expect(wordsFromKey("production.batch.reopen_withdrawn")).toBe("Reopen withdrawn");
  });

  it("state words for batches and orders", () => {
    expect(batchStateWord("in_process")).toBe("Being made");
    expect(batchStateWord("quarantined")).toBe("In the hold area until QA decides");
    expect(orderStateWord("released")).toBe("Approved");
    expect(orderStateWord("completed")).toBe("Quality check");
  });
});

describe("owner override in words (owner's screenshots 2026-11-01)", () => {
  it("names the person, the role and what they did, with the step when known", () => {
    expect(ownerOverrideSentence("Ana Villanueva", "production.process_step_record.completed", { stepNo: 4, name: "Mix and pour" })).toBe("Ana Villanueva (owner) finished step 4 (Mix and pour) for the operator.");
    expect(ownerOverrideSentence("Ana Villanueva", "production.dispense_record.checked")).toBe("Ana Villanueva (owner) did the second-person check of a weighing.");
    expect(ownerOverrideSentence(null, "production.process_step_record.completed")).toBe("The owner finished a step for the operator.");
    expect(ownerOverrideSentence("Ana", "x.y.z_new")).not.toMatch(RAW);
    expect(auditSentence({ action: "governance.owner_override.used", after: { forAction: "production.process_step_record.completed" } }, {}, {}, { stepNo: 4 })).toBe("The owner finished step 4 for the operator (owner override)");
  });
});

describe("Get materials summary (re-audit N1)", () => {
  it("'Every line is taken' only when every line is ticked", () => {
    expect(materialsSummary("planned", { lines: 5, taken: 2, notNeeded: 0 })).toMatchObject({ kind: "open", lineWord: "Not yet" });
    expect(materialsSummary("materials_staged", { lines: 5, taken: 4, notNeeded: 1 })).toMatchObject({ kind: "all_taken", text: "Every line is taken." });
  });

  it("a batch past this list without ticks never says 'every line is taken' and its lines never say 'Not yet'", () => {
    const s = materialsSummary("in_process", { lines: 5, taken: 0, notNeeded: 0 });
    expect(s.kind).toBe("past_without_list");
    expect(s.text).not.toMatch(/Every line is taken/);
    expect(s.text).toMatch(/0 of 5 lines ticked/);
    expect(s.lineWord).toBe("Not ticked");
    expect(materialsSummary("materials_staged", { lines: 3, taken: 1, notNeeded: 0 }).kind).toBe("past_without_list");
  });
});
