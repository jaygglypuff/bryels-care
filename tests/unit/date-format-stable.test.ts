import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtDayMonth } from "@/lib/qty";

/**
 * Hydration (ADR-125 item 5): dates shown by client components are formatted on the server and again in the browser.
 * Month names from the runtime's ICU differ between versions ("Sep" in older browsers, "Sept" in Node 22), so the
 * formatters spell month names themselves and only take the Manila calendar numbers from Intl.
 */
describe("date formatting is the same on every runtime", () => {
  it("formats Manila dates with fixed month names", () => {
    expect(fmtDate("2026-09-05")).toBe("05 Sept 2026");
    expect(fmtDate("2026-11-07T17:30:00Z")).toBe("08 Nov 2026"); // after 16:00 UTC it is the next day in Manila
    expect(fmtDate(new Date("2026-01-31T00:00:00Z"))).toBe("31 Jan 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });

  it("formats date and time in Manila, 24 h", () => {
    expect(fmtDateTime("2026-09-05T06:07:00Z")).toBe("05 Sept 2026, 14:07");
    expect(fmtDateTime("2026-09-05T16:07:00Z")).toBe("06 Sept 2026, 00:07");
    expect(fmtDateTime(undefined)).toBe("—");
  });

  it("formats day and month (calendar dates as written, moments in Manila)", () => {
    expect(fmtDayMonth("2026-11-11")).toBe("11 Nov");
    expect(fmtDayMonth("2026-05-05")).toBe("5 May");
    expect(fmtDayMonth("2026-09-30T20:00:00Z")).toBe("1 Oct");
    expect(fmtDayMonth("x")).toBe("—");
  });

  it("does not use the runtime's month names", () => {
    const real = Date.prototype.toLocaleDateString;
    const realS = Date.prototype.toLocaleString;
    Date.prototype.toLocaleDateString = () => "WRONG";
    Date.prototype.toLocaleString = () => "WRONG";
    try {
      expect(fmtDate("2026-09-05")).toBe("05 Sept 2026");
      expect(fmtDateTime("2026-09-05T06:07:00Z")).toBe("05 Sept 2026, 14:07");
      expect(fmtDayMonth("2026-09-05")).toBe("5 Sept");
    } finally {
      Date.prototype.toLocaleDateString = real;
      Date.prototype.toLocaleString = realS;
    }
  });
});
