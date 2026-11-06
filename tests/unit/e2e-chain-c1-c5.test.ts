/** ADR-110 C1 and C5, pure parts: "548 of 500" blocks Finish; blocked equipment in plain words. */
import { describe, expect, it } from "vitest";
import { equipmentWhy, fixerWords, shortDay } from "@/modules/masterdata/equipment-words";
import { overOrderedLines } from "@/modules/sales/packing";

describe("C1 never more than ordered", () => {
  it("548 of 500 is 48 too many, in plain words", () => {
    const [o] = overOrderedLines([{ id: "l1", name: "Guava Bar Soap 135 g", ordered: "500", before: "0", here: "548" }]);
    expect(o.tooMany.toString()).toBe("48");
    expect(o.message).toBe("Guava Bar Soap 135 g: 548 of 500 pcs are checked, 48 too many. Take the extra box off before you finish.");
  });
  it("an approved extra and what was sent before count", () => {
    expect(overOrderedLines([{ id: "l1", name: "X", ordered: "500", before: "100", here: "424", extra: "24" }])).toEqual([]);
    expect(overOrderedLines([{ id: "l1", name: "X", ordered: "500", before: "100", here: "425", extra: "24" }])[0].tooMany.toString()).toBe("1");
  });
});

describe("C5 why the equipment cannot be used", () => {
  it("cleaning, calibration and maintenance in plain words, with the fix", () => {
    const w = equipmentWhy("SC-01", [{ code: "cleaning_required", detail: "Cleaning not recorded since last use" }], "2026-11-06");
    expect(w).toEqual([{ code: "cleaning_required", text: "SC-01 needs cleaning after the last batch", fix: "record_cleaning" }]);
    const c = equipmentWhy("SC-02", [{ code: "calibration_due", detail: "Calibration was due 2026-11-01", dueDate: "2026-11-01" }], "2026-11-06");
    expect(c[0].text).toBe("SC-02 calibration is overdue since 1 Nov");
    expect(c[0].fix).toBe("maintenance");
    expect(equipmentWhy("MIX-01", [{ code: "out_of_service", detail: "Out of service" }], "2026-11-06")[0].text).toBe("MIX-01 is out of service");
  });
  it("names who fixes it, at most three names", () => {
    expect(fixerWords("maintenance", ["Dino", "Ramon"])).toBe("Maintenance or the site manager fixes it (Dino, Ramon).");
    expect(fixerWords("manager", ["A", "B", "C", "D", "E"])).toBe("Ask the site manager (A, B, C or 2 others).");
    expect(fixerWords("record_cleaning", [])).toBeNull();
    expect(shortDay("2025-12-31", "2026-11-06")).toBe("31 Dec 2025");
  });
});
