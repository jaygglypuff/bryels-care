/** Schedule cadence and report periods (US-5-05, A-W3B-04): pure functions, no database. */
import { describe, expect, it } from "vitest";
import { describeCadence, nextRunAfter, slotKey, zonedInstant } from "@/modules/reports/cadence";
import { isoWeekKey, resolvePeriod } from "@/modules/reports/params";

const tz = "Asia/Manila";

describe("cadence", () => {
  it("computes the next local run strictly after a moment", () => {
    const daily = { cadence: "daily" as const, runAtTime: "07:00", weekday: null, monthDay: null, timezone: tz };
    expect(nextRunAfter(daily, new Date("2026-10-24T22:00:00Z")).toISOString()).toBe("2026-10-24T23:00:00.000Z"); // 06:00 → 07:00 same local day
    expect(nextRunAfter(daily, new Date("2026-10-24T23:00:00Z")).toISOString()).toBe("2026-10-25T23:00:00.000Z"); // exactly at the slot → next day
    const weekly = { ...daily, cadence: "weekly" as const, weekday: 1 };
    expect(nextRunAfter(weekly, new Date("2026-10-21T02:00:00Z")).toISOString()).toBe("2026-10-25T23:00:00.000Z"); // Mon 26 Oct 07:00 Manila
    const monthly = { ...daily, cadence: "monthly" as const, monthDay: 1, runAtTime: "06:30" };
    expect(nextRunAfter(monthly, new Date("2026-10-24T00:00:00Z")).toISOString()).toBe("2026-10-31T22:30:00.000Z");
    expect(describeCadence(weekly)).toBe("Every Monday at 07:00 (Asia/Manila)");
  });

  it("converts local times with the zone's offset and keys slots by local time", () => {
    expect(zonedInstant("2026-01-15", "00:00", tz).toISOString()).toBe("2026-01-14T16:00:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-01T07:00:00.000Z"); // DST
    expect(slotKey(new Date("2026-10-25T23:00:00Z"), tz)).toBe("2026-10-26T07:00");
  });
});

describe("periods", () => {
  it("resolves presets to half-open local date ranges; weeks run Monday to Sunday", () => {
    expect(resolvePeriod("previous_week", "2026-10-26")).toMatchObject({ from: "2026-10-19", toExclusive: "2026-10-26" });
    expect(resolvePeriod("this_week", "2026-10-25")).toMatchObject({ from: "2026-10-19", toExclusive: "2026-10-26" }); // Sunday
    expect(resolvePeriod("previous_month", "2026-01-10")).toMatchObject({ from: "2025-12-01", toExclusive: "2026-01-01" });
    expect(resolvePeriod("last_7_days", "2026-10-24")).toMatchObject({ from: "2026-10-18", toExclusive: "2026-10-25" });
    expect(resolvePeriod("custom", "2026-10-24", { from: "2026-10-01", to: "2026-10-01" }).label).toBe("Custom dates · 2026-10-01");
    expect(() => resolvePeriod("custom", "2026-10-24", { from: "2026-10-05", to: "2026-10-01" })).toThrow();
    expect(isoWeekKey("2026-10-19")).toBe("2026-W43");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });
});
