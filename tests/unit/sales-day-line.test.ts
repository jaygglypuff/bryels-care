import { describe, expect, it } from "vitest";
import { salesDayLine } from "@/app/(app)/dashboard/sales-day-line";

const peso = (v: string) => `₱${Number(v).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

describe("salesDayLine (Home 'Sales today', UX audit C #15)", () => {
  it("a quiet morning after a big day is not shown as a red drop", () => {
    const l = salesDayLine("3456", "67200", peso)!;
    expect(l.tone).toBe("neutral");
    expect(l.text).toBe("Yesterday: ₱67,200 in total (today is not over yet)");
    expect(l.text).not.toMatch(/%|−/);
  });
  it("a small or empty yesterday gets neutral words", () => {
    expect(salesDayLine("0", "0", peso)).toEqual({ text: "Same as yesterday", tone: "neutral" });
    expect(salesDayLine("200", "500", peso)).toEqual({ text: "Yesterday was quiet (₱500)", tone: "neutral" });
  });
  it("more than yesterday is good news", () => {
    expect(salesDayLine("5000", "1200", peso)).toEqual({ text: "₱3,800 more than yesterday", tone: "good" });
    expect(salesDayLine(null, "1", peso)).toBeNull();
  });
});
