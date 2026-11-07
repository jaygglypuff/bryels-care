import { describe, expect, it } from "vitest";
import { scanCodeHref, scanRequestOf } from "@/lib/scan/scan-href";

/**
 * A label handed from the search box to Scan or search (ADR-125): the same label entered again must show its card
 * again, so every hand-over carries a fresh request number and the card is looked up once per request, not once per code.
 */
describe("scan hand-over link", () => {
  it("encodes the label and a request number; the same label twice gives two different links", () => {
    const a = scanCodeHref("BC:LOT:L-2610-00001", 1);
    const b = scanCodeHref("BC:LOT:L-2610-00001", 2);
    expect(a).toBe("/inventory/scan?code=BC%3ALOT%3AL-2610-00001&n=1");
    expect(a).not.toBe(b);
  });

  it("reads the request back from the page's search params (code capped at 200, request key changes per hand-over)", () => {
    expect(scanRequestOf({ code: "BC:LOT:L-1", n: "7" })).toEqual({ code: "BC:LOT:L-1", key: "7:BC:LOT:L-1" });
    expect(scanRequestOf({ code: "BC:LOT:L-1", n: "8" })?.key).not.toBe(scanRequestOf({ code: "BC:LOT:L-1", n: "7" })?.key);
    expect(scanRequestOf({ code: "BC:LOT:L-1" })).toEqual({ code: "BC:LOT:L-1", key: "0:BC:LOT:L-1" });
    expect(scanRequestOf({ code: "x".repeat(300), n: "1" })?.code).toHaveLength(200);
    expect(scanRequestOf({ n: "3" })).toBeNull();
    expect(scanRequestOf({ code: "   " })).toBeNull();
    expect(scanRequestOf({ code: "BC:LOT:L-1", n: "<script>" })?.key).toBe("0:BC:LOT:L-1");
  });
});
