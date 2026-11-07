/**
 * Number normalisation of the master search (owner request 2026-11-08): capitals, dashes, spaces and a scanned label
 * prefix do not matter; the shapes follow the built-in numbering rules.
 */
import { describe, expect, it } from "vitest";
import { formatNumber, NUMBERING_DEFAULTS } from "@/lib/numbering";
import { NUMBER_SHAPES, likeFragment, parseNumberQuery, wantsPartial } from "@/modules/scan/number-query";

describe("parseNumberQuery", () => {
  it.each([
    ["BILL-26-00001", "BILL-26-00001"],
    ["bill-26-00001", "BILL-26-00001"],
    ["BILL2600001", "BILL-26-00001"],
    ["bill2600001", "BILL-26-00001"],
    ["  bill 26 00001 ", "BILL-26-00001"],
    ["inv2026000001", "INV-2026-000001"],
    ["l261000171", "L-2610-00171"],
    ["mat0012", "MAT-0012"],
    ["bx00000001", "BX-00000001"],
    ["capa26001", "CAPA-26-001"],
    ["rc202601", "RC-2026-01"],
    ["BC:LOT:L-2610-00171", "L-2610-00171"],
    ["bc:doc:doc260000001", "DOC-26-0000001"],
  ])("%s → looks up %s", (typed, number) => {
    expect(parseNumberQuery(typed).exact).toContain(number);
  });

  it("knows the prefix, so the look-up can be narrowed", () => {
    expect(parseNumberQuery("BILL-26-00001").prefix).toBe("BILL");
    expect(parseNumberQuery("so-26").prefix).toBe("SO");
    expect(parseNumberQuery("26-00001").prefix).toBeNull();
    expect(parseNumberQuery("coconut").prefix).toBeNull();
  });

  it("last digits are a partial look-up; words alone are not", () => {
    expect(wantsPartial(parseNumberQuery("26-00001"))).toBe(true);
    expect(wantsPartial(parseNumberQuery("00012"))).toBe(true);
    expect(wantsPartial(parseNumberQuery("bills"))).toBe(false);
    expect(wantsPartial(parseNumberQuery("7"))).toBe(false);
    expect(parseNumberQuery("26-00001")).toMatchObject({ text: "26-00001", compact: "2600001", numberLike: true });
  });

  it("never throws and caps the length", () => {
    expect(parseNumberQuery("").exact).toEqual([]);
    expect(parseNumberQuery(undefined as unknown as string).compact).toBe("");
    expect(parseNumberQuery("x".repeat(500)).text.length).toBeLessThanOrEqual(64);
  });

  it("escapes LIKE wildcards typed by the user", () => {
    expect(likeFragment("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("number shapes follow the numbering defaults", () => {
  it("every built-in prefix has a shape, and the rebuilt number equals the formatted one", () => {
    const now = new Date("2026-11-08T03:00:00Z");
    for (const rule of Object.values(NUMBERING_DEFAULTS)) {
      expect(NUMBER_SHAPES[rule.prefix], rule.prefix).toBeDefined();
      const formatted = formatNumber(rule, 17, now);
      expect(parseNumberQuery(formatted.replace(/-/g, "").toLowerCase()).exact, formatted).toContain(formatted);
    }
  });
});
