/** ADR-110 C16: plain words on the end-to-end path (shortage message, lot decision refusal, QA check labels). */
import { describe, expect, it } from "vitest";
import { plainShortfall } from "@/app/(app)/sales/shortfall-words";
import { lotDecisionBlocker } from "@/modules/quality/rules";
import { QUALITY_CHECK_LABEL } from "@/modules/quality/check-quality";

describe("C16 words", () => {
  it("the set-aside shortage says neither 'released stock' nor 'allocate'", () => {
    const m = plainShortfall("Part of the stock is set aside. Not enough released stock — GBS-135: 378 pcs short of 500 pcs ordered. The order stays confirmed; allocate again when more stock is released.");
    expect(m).not.toMatch(/released stock|allocate/i);
    expect(m).toContain("Not enough stock that QA said OK to use: GBS-135");
    expect(plainShortfall("No stock could be allocated. x")).toBe("No stock could be set aside. x");
  });

  it("a lot already OK is not 'Release is not possible while the lot is released'", () => {
    const b = lotDecisionBlocker("release", { lotNumber: "L-1", qualityStatus: "released", expiresOn: null }, { isReceiver: false });
    expect(b?.message).toBe("OK to use is not possible: this lot is already OK to use.");
  });

  it("QA check decisions are OK to use / Not yet / Not OK", () => {
    expect(QUALITY_CHECK_LABEL).toEqual({ pass: "OK to use", not_yet: "Not yet", fail: "Not OK" });
  });
});
