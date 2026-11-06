/** ADR-110 C18 (walk P14): a lot number typed by hand keeps the counted loose pieces; box labels never carry a count. */
import { describe, expect, it } from "vitest";
import { scanQty } from "@/app/(app)/sales/scan-qty";

describe("scanQty", () => {
  it("a lot QR label carries the typed pieces", () => {
    expect(scanQty("BC:LOT:L-2611-00025", "121")).toEqual({ isLotLabel: true, qty: "121" });
    expect(scanQty("BC:LOT:L-2611-00025", "")).toEqual({ isLotLabel: true, qty: null });
  });

  it("a lot number typed by hand carries the typed pieces (was lost before)", () => {
    expect(scanQty("L-2611-00025", "121")).toEqual({ isLotLabel: false, qty: "121" });
    expect(scanQty("  L-2611-00025 ", " 6.5 ")).toEqual({ isLotLabel: false, qty: "6.5" });
  });

  it("box labels and box numbers never carry a count", () => {
    expect(scanQty("BC:BOX:BX-00000005", "48")).toEqual({ isLotLabel: false, qty: null });
    expect(scanQty("BX-00000005", "48")).toEqual({ isLotLabel: false, qty: null });
  });

  it("no number typed, or not a number: no count is sent", () => {
    expect(scanQty("L-2611-00025", "")).toEqual({ isLotLabel: false, qty: null });
    expect(scanQty("L-2611-00025", "abc")).toEqual({ isLotLabel: false, qty: null });
  });
});
