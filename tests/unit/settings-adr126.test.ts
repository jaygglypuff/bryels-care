/**
 * ADR-126: five owner-editable settings, each defaulting to the recommended choice (today's behaviour), with grade-5
 * words on the Settings screen ("What it does" = description, "Who should change it" = whoChanges). Plus the pure
 * parts of their enforcement: `checkEntryMode` and `confirmLot` refuse a typed check when typing is off, and the
 * billing words say only "Delivered." for the hidden invoice stage.
 */
import { describe, expect, it } from "vitest";
import { billingStepWords } from "@/lib/billing-step-words";
import { checkEntryMode, TYPING_IS_OFF } from "@/lib/scan/code-sql";
import { SETTINGS, settingDefinition } from "@/lib/settings";
import { confirmLot } from "@/modules/production";
import { DomainError } from "@/lib/errors";

const KEYS = ["scan.typed_code_counts_as_check", "ui.wide_screen_top_bar", "scan.search_open_to_everyone", "sales.show_invoice_stage_without_invoice_access", "ui.setup_edit_forms_folded"] as const;

describe("ADR-126 settings in the catalogue", () => {
  it("defaults are today's behaviour", () => {
    expect(SETTINGS["scan.typed_code_counts_as_check"].default).toBe(true);
    expect(SETTINGS["ui.wide_screen_top_bar"].default).toBe("search");
    expect(SETTINGS["scan.search_open_to_everyone"].default).toBe(true);
    expect(SETTINGS["sales.show_invoice_stage_without_invoice_access"].default).toBe(true);
    expect(SETTINGS["ui.setup_edit_forms_folded"].default).toBe(true);
  });

  it("each has a plain label, what it does and who should change it, without technical words", () => {
    for (const k of KEYS) {
      const d = settingDefinition(k)!;
      expect(d.scopes).toEqual(["organization"]);
      expect(d.description, k).toBeTruthy();
      expect(d.whoChanges, k).toBeTruthy();
      for (const text of [d.label, d.description!, d.whoChanges!]) {
        expect(text, k).not.toMatch(/\b(boolean|true|false|enum|permission|inventory\.lot\.view|server|UI|launcher|via)\b/);
        // Grade 5: short sentences.
        for (const sentence of text.split(/(?<=[.:])\s+/)) expect(sentence.split(/\s+/).length, `${k}: ${sentence}`).toBeLessThanOrEqual(32);
      }
    }
  });

  it("who may change them follows the catalogue: the typed check is owner-only; access settings need a second person; screen layout is direct", () => {
    expect(settingDefinition("scan.typed_code_counts_as_check")).toMatchObject({ restricted: true, requiresApproval: true, ownerOnly: true });
    expect(settingDefinition("scan.search_open_to_everyone")).toMatchObject({ restricted: true, requiresApproval: true });
    expect(settingDefinition("sales.show_invoice_stage_without_invoice_access")).toMatchObject({ restricted: true, requiresApproval: true });
    expect(settingDefinition("ui.wide_screen_top_bar")?.requiresApproval).toBeUndefined();
    expect(settingDefinition("ui.setup_edit_forms_folded")?.requiresApproval).toBeUndefined();
    expect(settingDefinition("ui.wide_screen_top_bar")?.choices?.map((c) => c.value)).toEqual(["search", "scan"]);
    expect(SETTINGS["ui.wide_screen_top_bar"].schema.safeParse("both").success).toBe(false);
  });
});

describe("typed checks while typing is off", () => {
  const lot = { lotNumber: "L-2611-00016" };
  it("checkEntryMode refuses typed with the plain message; scan and older callers still pass", () => {
    expect(checkEntryMode("typed")).toBe("typed");
    expect(checkEntryMode("scan", "payload", false)).toBe("scan");
    expect(checkEntryMode(undefined, "payload", false)).toBe("scan");
    try {
      checkEntryMode("typed", "scan", false);
      throw new Error("not refused");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).message).toBe(TYPING_IS_OFF);
      expect((e as DomainError).details?.code).toBe("TYPED_NOT_A_CHECK");
    }
  });

  it("confirmLot refuses a typed lot number and a bare last 4; a scanned label and 'no confirmation' still pass", () => {
    expect(() => confirmLot("scan", true, lot, "l261100016", "typed", false)).toThrow(TYPING_IS_OFF);
    expect(() => confirmLot("last4", true, lot, "0016", undefined, false)).toThrow(TYPING_IS_OFF);
    expect(() => confirmLot("last4", true, lot, "", "scan", false)).toThrow(/Scan the lot label on the container \(lot L-2611-00016\)\.$/);
    expect(confirmLot("last4", true, lot, "BC:LOT:L-2611-00016", "scan", false)).toBe("scan");
    expect(confirmLot("scan", true, lot, "BC:LOT:L-2611-00016", undefined, false)).toBe("scan");
    expect(confirmLot("none", true, lot, "", "typed", false)).toBe("not_required");
    // On (default): unchanged.
    expect(confirmLot("last4", true, lot, "0016", "typed")).toBe("typed");
  });
});

describe("hidden invoice stage", () => {
  it("says only the lead sentence, with no names and no link", () => {
    expect(billingStepWords({ stage: "hidden", invoice: null, next: null })).toEqual({ text: "Delivered." });
    expect(billingStepWords({ stage: "hidden", invoice: null, next: null }, "Sent out to the customer.")).toEqual({ text: "Sent out to the customer." });
  });
});
