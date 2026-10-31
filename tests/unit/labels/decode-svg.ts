import { BarcodeFormat, BinaryBitmap, Code128Reader, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";

/** Reads the QR symbol back from the SVG a label carries (its path of 1×1 dark modules) and decodes it with ZXing. */
export function decodeQrFromSvg(body: string): string {
  const svg = body.match(/<svg viewBox="0 0 (\d+) \1"[^>]*data-symbology="qr">.*?<path d="([^"]+)"/);
  if (!svg) throw new Error("no QR in label");
  const n = Number(svg[1]);
  const scale = 4;
  const px = n * scale;
  const lum = new Uint8ClampedArray(px * px).fill(255);
  for (const m of svg[2].matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const c = Number(m[1]);
    const r = Number(m[2]);
    for (let y = 0; y < scale; y++) lum.fill(0, (r * scale + y) * px + c * scale, (r * scale + y) * px + c * scale + scale);
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, px, px)));
  return new QRCodeReader().decode(bitmap, new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]])).getText();
}

/** Same for Code 128: the bars of the SVG path, rasterised as rows. */
export function decodeCode128FromSvg(body: string): string {
  const svg = body.match(/<svg viewBox="0 0 (\d+) 1"[^>]*data-symbology="code128">.*?<path d="([^"]+)"/);
  if (!svg) throw new Error("no Code 128 in label");
  const scale = 3;
  const w = Number(svg[1]) * scale;
  const h = 40;
  const row = new Uint8ClampedArray(w).fill(255);
  for (const m of svg[2].matchAll(/M(\d+) 0h(\d+)v1h-\d+z/g)) row.fill(0, Number(m[1]) * scale, (Number(m[1]) + Number(m[2])) * scale);
  const lum = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) lum.set(row, y * w);
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
  return new Code128Reader().decode(bitmap, new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]])).getText();
}
