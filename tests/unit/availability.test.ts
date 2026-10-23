/** availability.formula (pure part, A-DM-23): bucket precedence and the vocabulary identity. */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bucketOf, computeAvailability } from "@/modules/inventory/availability";

const STATUSES = ["released", "quarantine", "on_hold", "rejected", "expired", "recalled"];

describe("availability buckets", () => {
  it("precedence: recalled → rejected → expired (status or date) → on_hold → quarantine → released", () => {
    expect(bucketOf("recalled", "2000-01-01", "2027-01-01")).toBe("recalled");
    expect(bucketOf("rejected", "2000-01-01", "2027-01-01")).toBe("rejected");
    expect(bucketOf("on_hold", "2026-12-31", "2027-01-01")).toBe("expired");
    expect(bucketOf("released", "2027-01-01", "2027-01-01")).toBe("released"); // usable through the expiry day
    expect(bucketOf("released", "2026-12-31", "2027-01-01")).toBe("expired");
    expect(bucketOf("quarantine", null, "2027-01-01")).toBe("quarantine");
    expect(bucketOf("something_new", null, "2027-01-01")).toBe("quarantine"); // unknown never counts as available
  });

  it("available = on_hand − reserved − allocated − quarantined − on_hold − expired − recalled − rejected (300 random lot sets)", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const rows = Array.from({ length: 1 + rnd(8) }, () => {
        const onHand = new Decimal(rnd(100000)).div(1000);
        return {
          qualityStatus: STATUSES[rnd(STATUSES.length)],
          expiresOn: rnd(3) === 0 ? null : `2027-01-${String(1 + rnd(28)).padStart(2, "0")}`,
          onHand: onHand.toString(),
          reserved: onHand.div(10).toDecimalPlaces(3).toString(),
          allocated: onHand.div(5).toDecimalPlaces(3).toString(),
        };
      });
      const t = computeAvailability(rows, "2027-01-15");
      const identity = new Decimal(t.onHand).minus(t.reserved).minus(t.allocated).minus(t.quarantined).minus(t.onHold).minus(t.expired).minus(t.recalled).minus(t.rejected);
      expect(identity.toString()).toBe(t.available);
    }
  });
});
