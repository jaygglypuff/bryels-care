import {
  BarcodeFormat,
  BinaryBitmap,
  Code128Reader,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { code128Modules, qrMatrix } from "@/modules/documents/barcode";

/** Rasterises our QR module matrix (4-module quiet zone, `scale` px per module) and decodes it with ZXing. */
export function decodeQr(text: string, scale = 4): string {
  const { size, dark } = qrMatrix(text);
  const n = (size + 8) * scale;
  const lum = new Uint8ClampedArray(n * n).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.floor(y / scale) - 4;
      const c = Math.floor(x / scale) - 4;
      if (r >= 0 && c >= 0 && r < size && c < size && dark(r, c)) lum[y * n + x] = 0;
    }
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, n, n)));
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]);
  return new QRCodeReader().decode(bitmap, hints).getText();
}

/** Rasterises our Code 128 module widths and decodes the row with ZXing. */
export function decodeCode128(text: string, scale = 3): string {
  const widths = code128Modules(text);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const w = total * scale;
  const h = 40;
  const row = new Uint8ClampedArray(w).fill(255);
  let x = quiet * scale;
  widths.forEach((m, i) => {
    if (i % 2 === 0) row.fill(0, x, x + m * scale);
    x += m * scale;
  });
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) lum.set(row, y * w);
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
  return new Code128Reader().decode(bitmap, new Map()).getText();
}
