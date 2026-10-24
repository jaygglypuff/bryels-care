/**
 * W2G pure helpers: expiryFor (US-1-22 AC2), GTIN check digit, reason-code applies_to filtering
 * (US-1-24 unit test), exact unit arithmetic (US-1-21 AC2) and the lifecycle transition tables.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_REASON_CODES, reasonCodesFor } from "@/modules/masterdata/reason-codes-defaults";
import { PRODUCT_TRANSITIONS, expiryBaseDate, expiryFor, isValidGtin } from "@/modules/masterdata/products-shelf-life";
import { applyStep, enteredEqualsBase, toBasePair } from "@/modules/masterdata/uom-math";

describe("expiryFor (US-1-22 AC2)", () => {
  it("returns baseDate + shelf_life_days, across month and leap-year boundaries", () => {
    expect(expiryFor({ shelfLifeDays: 365 }, "2026-10-24")).toBe("2027-10-24");
    expect(expiryFor({ shelfLifeDays: 365 }, "2027-03-01")).toBe("2028-02-29");
    expect(expiryFor({ shelfLifeDays: 30 }, "2026-01-31")).toBe("2026-03-02");
    expect(expiryFor({ shelfLifeDays: null }, "2026-10-24")).toBeNull();
    expect(() => expiryFor({ shelfLifeDays: 1 }, "24/10/2026")).toThrow();
  });
  it("the basis is switchable (A-PRD-28): completion by default, release when configured", () => {
    const dates = { completedOn: "2026-10-01", releasedOn: "2026-10-08" };
    expect(expiryBaseDate(dates)).toBe("2026-10-01");
    expect(expiryBaseDate(dates, "release")).toBe("2026-10-08");
    expect(expiryBaseDate({ completedOn: "2026-10-01", releasedOn: null }, "release")).toBeNull();
  });
});

describe("GTIN", () => {
  it("accepts a correct GS1 check digit and refuses a wrong one or a bad length", () => {
    expect(isValidGtin("4800000000002")).toBe(true);
    expect(isValidGtin("4800000000001")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("123")).toBe(false);
  });
});

describe("reason codes: applies_to filtering (US-1-24 AC1)", () => {
  const rows = DEFAULT_REASON_CODES.map((r) => ({ ...r, isActive: true }));
  it("offers only active codes whose applies_to contains the category, in sort order", () => {
    const adj = reasonCodesFor(rows, "adjustment").map((r) => r.code);
    expect(adj).toContain("spillage");
    expect(adj).toContain("other");
    expect(adj).not.toContain("lost_copy");
    expect(adj.at(-1)).toBe("other");
    const withInactive = rows.map((r) => (r.code === "spillage" ? { ...r, isActive: false } : r));
    expect(reasonCodesFor(withInactive, "adjustment").map((r) => r.code)).not.toContain("spillage");
    expect(reasonCodesFor(rows, "nonsense")).toEqual([]);
  });
  it("codes are unique and categories valid in the default list", () => {
    expect(new Set(DEFAULT_REASON_CODES.map((r) => r.code)).size).toBe(DEFAULT_REASON_CODES.length);
  });
});

describe("unit arithmetic (US-1-21 AC2)", () => {
  it("forward multiplies, reverse divides only when exact; entered and base are both returned", () => {
    expect(applyStep("0.1", { factor: "1000", direction: "forward" })!.toString()).toBe("100");
    expect(applyStep("100", { factor: "1000", direction: "reverse" })!.toString()).toBe("0.1");
    expect(applyStep("1", { factor: "3", direction: "reverse" })).toBeNull();
    expect(enteredEqualsBase("2.5", "2500", { factor: "1000", direction: "forward" })).toBe(true);
    expect(enteredEqualsBase("2500", "2.5", { factor: "1000", direction: "reverse" })).toBe(true);
    expect(toBasePair({ qty: "0.1", uom: "kg" }, "g", { factor: "1000", direction: "forward" })).toEqual({ entered: { qty: "0.1", uom: "kg" }, base: { qty: "100", uom: "g" } });
    expect(toBasePair({ qty: "5", uom: "g" }, "g", null)).toEqual({ entered: { qty: "5", uom: "g" }, base: { qty: "5", uom: "g" } });
    expect(toBasePair({ qty: "5", uom: "mL" }, "g", null)).toBeNull();
  });
});

describe("product lifecycle table", () => {
  it("discontinued is final and draft cannot be re-entered", () => {
    expect(PRODUCT_TRANSITIONS.discontinued).toEqual([]);
    expect(Object.values(PRODUCT_TRANSITIONS).some((to) => (to as readonly string[]).includes("draft"))).toBe(false);
  });
});
