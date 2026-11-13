import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { canShipFrom } from "@/modules/production/order-cover-rule";

const D = (v: number) => new Decimal(v);
const line = (need: number, fromFree: number, missing: number, coming: { qty: number; readyOn: string | null }[] = []) => ({
  need: D(need),
  fromFree: D(fromFree),
  missing: D(missing),
  coming: coming.map((c, i) => ({ sourceId: `s${i}`, ref: `B-${i}`, kind: "being_made" as const, qty: D(c.qty), readyOn: c.readyOn })),
});

describe("canShipFrom (ADR-131, C-office problem 3)", () => {
  const today = "2026-11-08";
  it("everything set aside: today", () => {
    expect(canShipFrom([line(0, 0, 0)], today)).toEqual({ date: today, why: "all_set_aside" });
  });
  it("on the shelf: today", () => {
    expect(canShipFrom([line(30, 30, 0)], today)).toEqual({ date: today, why: "on_the_shelf" });
  });
  it("coming: the latest ready day of what it waits for", () => {
    expect(canShipFrom([line(30, 10, 0, [{ qty: 20, readyOn: "2026-11-17" }]), line(5, 0, 0, [{ qty: 5, readyOn: "2026-11-12" }])], today)).toEqual({ date: "2026-11-17", why: "coming" });
  });
  it("something still needs making, or a source with no day: not known", () => {
    expect(canShipFrom([line(30, 0, 30)], today).date).toBeNull();
    expect(canShipFrom([line(30, 0, 0, [{ qty: 30, readyOn: null }])], today).why).toBe("not_known");
  });
  it("a ready day in the past is today", () => {
    expect(canShipFrom([line(30, 0, 0, [{ qty: 30, readyOn: "2026-11-01" }])], today).date).toBe(today);
  });
});
