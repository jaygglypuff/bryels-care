import { describe, expect, it } from "vitest";
import { baseToUnitText, fmtFriendly, friendlyUnit, normalizeUnit, parseQtyText, toBaseQty, unitChoices, unusualAmount } from "@/lib/units";

describe("units: friendly units and choices", () => {
  it("offers kg/g for gram items, L/mL for millilitre items and pcs for count items, friendly unit first", () => {
    expect(unitChoices("g")).toEqual(["kg", "g"]);
    expect(unitChoices("mL")).toEqual(["L", "mL"]);
    expect(unitChoices("pcs")).toEqual(["pcs"]);
    expect(friendlyUnit("g")).toBe("kg");
    expect(friendlyUnit("mL")).toBe("L");
    expect(friendlyUnit("pcs")).toBe("pcs");
  });
  it("normalizes the ways people type a unit", () => {
    expect(normalizeUnit("KG")).toBe("kg");
    expect(normalizeUnit("kilos")).toBe("kg");
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("l")).toBe("L");
    expect(normalizeUnit("ml")).toBe("mL");
    expect(normalizeUnit("pieces")).toBe("pcs");
    expect(normalizeUnit("sacks")).toBeNull();
  });
});

describe("units: typed amounts", () => {
  it("reads '20 kg', '20kg', '1,500 g' and a bare number", () => {
    expect(parseQtyText("20 kg")).toEqual({ qty: "20", unit: "kg" });
    expect(parseQtyText(" 20kg ")).toEqual({ qty: "20", unit: "kg" });
    expect(parseQtyText("1,500 g")).toEqual({ qty: "1500", unit: "g" });
    expect(parseQtyText("12.5")).toEqual({ qty: "12.5", unit: null });
    expect(parseQtyText("twenty")).toBeNull();
    expect(parseQtyText("")).toBeNull();
  });

  it("converts to the base unit with decimal arithmetic (no floating point)", () => {
    const r = toBaseQty("20", "kg", "g");
    expect(r.ok && r.qtyBase.toString()).toBe("20000");
    const t = toBaseQty("0.1 kg", "g", "g"); // the unit typed in the box wins over the picker
    expect(t.ok && t.qtyBase.toString()).toBe("100");
    const l = toBaseQty("1.234567", "L", "mL");
    expect(l.ok && l.qtyBase.toString()).toBe("1234.567");
    const same = toBaseQty("60000", "g", "g");
    expect(same.ok && same.qtyBase.toString()).toBe("60000");
    const none = toBaseQty("5", null, "pcs");
    expect(none.ok && none.qtyBase.toString()).toBe("5");
  });

  it("refuses an unknown unit or a unit of another kind", () => {
    const a = toBaseQty("20", "sacks", "g");
    expect(a.ok).toBe(false);
    expect(!a.ok && a.message).toMatch(/kg or g/);
    const b = toBaseQty("20 L", null, "g");
    expect(b.ok).toBe(false);
    const c = toBaseQty("2 kg", null, "pcs");
    expect(c.ok).toBe(false);
    expect(!c.ok && c.message).toMatch(/pcs/);
  });

  it("refuses negative, empty and too precise amounts", () => {
    expect(toBaseQty("-1", "kg", "g").ok).toBe(false);
    expect(toBaseQty("", "kg", "g").ok).toBe(false);
    expect(toBaseQty("1.1234567", "g", "g").ok).toBe(false);
  });

  it("shows amounts in friendly units and back in the unit chosen", () => {
    expect(fmtFriendly("60000", "g")).toBe("60 kg");
    expect(fmtFriendly("250", "g")).toBe("250 g");
    expect(fmtFriendly("1500", "mL")).toBe("1.5 L");
    expect(fmtFriendly("2880", "pcs")).toBe("2,880 pcs");
    expect(baseToUnitText("60000", "g", "kg")).toBe("60");
    expect(baseToUnitText("1500", "mL", "L")).toBe("1.5");
    expect(baseToUnitText("12", "pcs", "pcs")).toBe("12");
  });
});

describe("units: unusual receipt amounts", () => {
  it("asks when 50 g arrives for an item that usually comes in 25 kg sacks", () => {
    const u = unusualAmount({ qtyBase: "50", baseUom: "g", typedQty: "50", typedUnit: "g", packQtyBase: "25000", pastQtyBase: [] });
    expect(u).not.toBeNull();
    expect(u?.suggestUnit).toBe("kg");
  });
  it("asks when the amount is far from past receipts even without a standard pack", () => {
    const u = unusualAmount({ qtyBase: "50", baseUom: "g", typedQty: "50", typedUnit: "g", packQtyBase: null, pastQtyBase: ["25000", "50000"] });
    expect(u?.suggestUnit).toBe("kg");
  });
  it("does not ask for a normal delivery or a count item", () => {
    expect(unusualAmount({ qtyBase: "50000", baseUom: "g", typedQty: "50", typedUnit: "kg", packQtyBase: "25000", pastQtyBase: [] })).toBeNull();
    expect(unusualAmount({ qtyBase: "500", baseUom: "pcs", typedQty: "500", typedUnit: "pcs", packQtyBase: "500", pastQtyBase: [] })).toBeNull();
    expect(unusualAmount({ qtyBase: "50", baseUom: "g", typedQty: "50", typedUnit: "g", packQtyBase: null, pastQtyBase: [] })).toBeNull();
  });
  it("asks when a huge amount was typed in kg for an item that comes in grams", () => {
    const u = unusualAmount({ qtyBase: "500000", baseUom: "g", typedQty: "500", typedUnit: "kg", packQtyBase: "500", pastQtyBase: [] });
    expect(u?.suggestUnit).toBe("g");
  });
});
