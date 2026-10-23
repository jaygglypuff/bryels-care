import { describe, expect, it } from "vitest";
import { code128MinWidthMm, code128Svg, code128Values, payloadSymbol, qrSvg } from "@/modules/documents/barcode";
import { SCAN_PAYLOAD_RE } from "@/lib/scan/payload";
import { decodeCode128, decodeQr } from "../../support/decode";

const PAYLOADS = ["BC:LOT:L-2610-00042", "BC:LOC:QUA-01", "BC:BOX:BX-00000421", "BC:EQP:SCALE-01", "BC:DOC:DOC-26-0000001", `BC:MAT:${"A".repeat(64)}`];

describe("label QR round trip (docs/testing.md §2.2)", () => {
  it.each(PAYLOADS)("QR for %s decodes to the exact payload", (p) => {
    const decoded = decodeQr(p);
    expect(decoded).toBe(p);
    expect(SCAN_PAYLOAD_RE.test(decoded)).toBe(true);
  });

  it.each(PAYLOADS.slice(0, 5))("Code 128 for %s decodes to the exact payload", (p) => {
    expect(decodeCode128(p)).toBe(p);
  });

  it("produces vector SVG with no scripts or external references", () => {
    for (const svg of [qrSvg("BC:LOT:L-1").value, code128Svg("BC:LOT:L-1").value]) {
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).not.toMatch(/<script|href=|<image|<foreignObject/i);
    }
  });

  it("computes the Code 128 checksum per ISO/IEC 15417", () => {
    // Start B 104 + Σ(position × value): P48·1 + J42·2 + J42·3 + "1"17·4 + "2"18·5 + "3"19·6 + C35·7 = 879; 879 mod 103 = 55.
    // (ZXing's reader also verifies the checksum in the round-trip tests above.)
    const v = code128Values("PJJ123C");
    expect(v[v.length - 2]).toBe(55);
  });

  it("label.payload_minimal: the encoded payload is only the typed identifier", () => {
    const { payload } = payloadSymbol("LOT", "L-2610-00042", "qr");
    expect(payload).toBe("BC:LOT:L-2610-00042");
    expect(() => payloadSymbol("LOT", "https://x", "qr")).toThrow();
    expect(() => payloadSymbol("LOT", "L-1", "ean13")).toThrow(/later phase/);
  });

  it("reports the minimum label width for Code 128 at X = 0.25 mm", () => {
    expect(code128MinWidthMm("BC:LOT:L-2610-00042")).toBeGreaterThan(60);
    expect(code128MinWidthMm("BC:LOT:L-2610-00042")).toBeLessThan(100);
  });
});
