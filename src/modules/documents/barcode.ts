import QRCode from "qrcode";
import { buildPayload, SCAN_PAYLOAD_RE, type ScanType } from "@/lib/scan/payload";
import { trusted, type SafeHtml } from "./html";

/**
 * Vector barcodes for labels and documents (ADR-017, docs/reports-and-templates.md §8.2).
 * Both generators are synchronous and deterministic so a reprint of the same dataset produces
 * the same markup (and therefore the same hash).
 */

/** Dark-module matrix of a QR Code, error correction M (decodable in tests). */
export function qrMatrix(text: string): { size: number; dark: (row: number, col: number) => boolean } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return { size, dark: (r, c) => data[r * size + c] === 1 };
}

/**
 * QR Code as an inline SVG with a 4-module quiet zone. The caller sizes it in mm via CSS; at
 * 28 mm a version-2 symbol (25 modules + 8 quiet) gives ~0.85 mm modules, above the 0.5 mm minimum.
 */
export function qrSvg(text: string, label = text): SafeHtml {
  const { size, dark } = qrMatrix(text);
  const q = 4;
  const n = size + q * 2;
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (dark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  }
  const aria = label.replace(/[^A-Za-z0-9 :._-]/g, "");
  return trusted(
    `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code ${aria}" data-symbology="qr"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`,
  );
}

// Code 128 bar/space width patterns for values 0..105 and STOP (106), from ISO/IEC 15417.
const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** Code 128 subset B symbol values (start, data, checksum, stop) for printable ASCII text. */
export function code128Values(text: string): number[] {
  const values = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 subset B cannot encode character ${JSON.stringify(ch)}`);
    values.push(code - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values;
}

/** Module widths (bar, space, bar, …) of the whole symbol without quiet zones. */
export function code128Modules(text: string): number[] {
  return code128Values(text).flatMap((v) => [...C128[v]].map(Number));
}

/** Width in modules including 10-module quiet zones on both sides. */
export function code128WidthModules(text: string): number {
  return code128Modules(text).reduce((a, b) => a + b, 0) + 20;
}

/** Minimum label width (mm) for a Code 128 payload at X = 0.25 mm plus 4 mm padding (§8.2). */
export function code128MinWidthMm(text: string, xMm = 0.25): number {
  return Math.ceil(code128WidthModules(text) * xMm + 4);
}

/** Code 128 subset B as an inline SVG; bars are vector rectangles, never raster. */
export function code128Svg(text: string): SafeHtml {
  const widths = code128Modules(text);
  const quiet = 10;
  let x = quiet;
  let d = "";
  widths.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x} 0h${w}v1h-${w}z`;
    x += w;
  });
  const total = x + quiet;
  const aria = text.replace(/[^A-Za-z0-9 :._-]/g, "");
  return trusted(
    `<svg viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Code 128 ${aria}" data-symbology="code128"><rect width="${total}" height="1" fill="#fff"/><path d="${d}" fill="#000"/></svg>`,
  );
}

/** Builds the grammar-checked payload and its symbol. Throws when the value cannot be encoded. */
export function payloadSymbol(type: ScanType, value: string, symbology: "qr" | "code128" | "ean13"): { payload: string; svg: SafeHtml } {
  const payload = buildPayload(type, value);
  if (!SCAN_PAYLOAD_RE.test(payload)) throw new Error("payload grammar");
  if (symbology === "code128") return { payload, svg: code128Svg(payload) };
  if (symbology === "ean13") throw new Error("EAN-13 is reserved for retail barcodes in a later phase (ADR-017); choose QR or Code 128.");
  return { payload, svg: qrSvg(payload) };
}
