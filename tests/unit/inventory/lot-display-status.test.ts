import { describe, expect, it } from "vitest";
import { lotDisplayStatus } from "@/ui/inventory/lot-status";

describe("lotDisplayStatus (stock list chip)", () => {
  const now = new Date("2026-10-30T04:00:00Z"); // 30 Oct 2026, 12:00 in Manila
  it("shows a released lot past its expiry date as expired, never released", () => {
    expect(lotDisplayStatus("released", "2026-10-28", now)).toBe("expired");
    expect(lotDisplayStatus("quarantine", "2026-10-29", now)).toBe("expired");
    expect(lotDisplayStatus("on_hold", "2026-01-01", now)).toBe("expired");
  });
  it("keeps the stored status on the expiry day, before it, and without an expiry date", () => {
    expect(lotDisplayStatus("released", "2026-10-30", now)).toBe("released");
    expect(lotDisplayStatus("released", "2027-01-01", now)).toBe("released");
    expect(lotDisplayStatus("released", null, now)).toBe("released");
  });
  it("does not override rejected or recalled lots", () => {
    expect(lotDisplayStatus("rejected", "2026-10-01", now)).toBe("rejected");
    expect(lotDisplayStatus("recalled", "2026-10-01", now)).toBe("recalled");
  });
});
