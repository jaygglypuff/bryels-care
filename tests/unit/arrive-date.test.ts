import { describe, expect, it } from "vitest";
import { suggestArrival, workingDayOnOrAfter } from "@/lib/arrive-date";

// 2026-11-08 is a Sunday; 2026-11-15 is a Sunday; 2026-11-16 a Monday.
describe("suggestArrival (ADR-131, bugs B8/B16)", () => {
  it("uses the request's Needed by date when it is after today", () => {
    expect(suggestArrival({ today: "2026-11-08", leadDays: 3, neededBy: "2026-11-14" })).toEqual({ date: "2026-11-14", why: "request" });
  });
  it("moves a Sunday Needed by to the Monday", () => {
    expect(suggestArrival({ today: "2026-11-08", leadDays: 0, neededBy: "2026-11-15" }).date).toBe("2026-11-16");
  });
  it("never suggests today: without a request or lead time it is tomorrow", () => {
    expect(suggestArrival({ today: "2026-11-09", leadDays: 0 })).toEqual({ date: "2026-11-10", why: "tomorrow" });
  });
  it("a Needed by of today or earlier is ignored", () => {
    expect(suggestArrival({ today: "2026-11-10", leadDays: 2, neededBy: "2026-11-10" })).toEqual({ date: "2026-11-12", why: "lead_time" });
  });
  it("never a Sunday: today Saturday + 1 day lead time = Monday", () => {
    expect(suggestArrival({ today: "2026-11-14", leadDays: 1 }).date).toBe("2026-11-16");
    expect(suggestArrival({ today: "2026-11-07", leadDays: 0 }).date).toBe("2026-11-09");
  });
  it("workingDayOnOrAfter keeps weekdays and Saturdays", () => {
    expect(workingDayOnOrAfter("2026-11-14")).toBe("2026-11-14");
    expect(workingDayOnOrAfter("2026-11-08")).toBe("2026-11-09");
  });
});
