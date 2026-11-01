import { describe, expect, it } from "vitest";
import { plainDate, plainDatesIn } from "@/lib/plain-date";
import { isAre, plural, pluralWord, waits } from "@/lib/plural";

describe("plural (no \"(s)\" in what people read)", () => {
  it("adds s, es or ies by the English rule", () => {
    expect(plural(1, "invoice")).toBe("1 invoice");
    expect(plural(3, "invoice")).toBe("3 invoices");
    expect(plural(0, "invoice")).toBe("0 invoices");
    expect(plural(2, "box")).toBe("2 boxes");
    expect(plural(2, "delivery")).toBe("2 deliveries");
    expect(plural(2, "day")).toBe("2 days");
    expect(plural(2, "batch")).toBe("2 batches");
    expect(plural("1", "lot")).toBe("1 lot");
  });
  it("takes an explicit plural for odd words", () => {
    expect(plural(2, "person", "people")).toBe("2 people");
    expect(pluralWord(1, "person", "people")).toBe("person");
  });
  it("verbs follow the count", () => {
    expect(`${plural(1, "invoice")} ${isAre(1)} late`).toBe("1 invoice is late");
    expect(`${plural(2, "claim")} ${waits(2)}`).toBe("2 claims wait");
  });
});

describe("plainDate (no ISO dates in messages)", () => {
  it("shows a calendar day as \"30 Oct 2026\"", () => {
    expect(plainDate("2026-10-30")).toBe("30 Oct 2026");
    expect(plainDate("2026-10-05")).toBe("5 Oct 2026");
    expect(plainDate(new Date("2026-10-30T20:00:00Z"))).toBe("31 Oct 2026"); // Manila is UTC+8
    expect(plainDate(null)).toBe("—");
  });
  it("rewrites ISO dates inside a sentence and leaves record numbers alone", () => {
    expect(plainDatesIn("Coconut Oil went out of date on 2026-10-28 and is still in stock")).toBe("Coconut Oil went out of date on 28 Oct 2026 and is still in stock");
    expect(plainDatesIn("Fix-and-prevent plan: task 2 is late (was due 2026-10-28)")).toBe("Fix-and-prevent plan: task 2 is late (was due 28 Oct 2026)");
    expect(plainDatesIn("INV-2026-000003 · DOC-26-0000002")).toBe("INV-2026-000003 · DOC-26-0000002");
    expect(plainDatesIn(null)).toBeNull();
  });
});
