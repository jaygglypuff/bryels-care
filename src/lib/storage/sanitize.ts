import { DomainError } from "@/lib/errors";

/**
 * Upload validation and metadata stripping (docs/security.md §2.5, §4.6).
 *
 * - Allow-list by magic bytes: JPEG, PNG, WebP, PDF. The declared type, the extension and the sniffed
 *   type must agree (422 otherwise).
 * - Size caps: images 10 MB, PDFs 25 MB (A-SEC-15).
 * - Images: EXIF/XMP/IPTC/comments and text chunks are removed by rewriting the container; the JPEG
 *   orientation tag is kept in a minimal EXIF block so phone photos still display upright. Pixel data is
 *   not re-encoded (no image library dependency yet; deviation from "re-encode with sharp", A-W1B-06).
 * - HEIC is refused with a clear message (conversion needs an image library).
 */

export const UPLOAD_LIMITS = { image: 10 * 1024 * 1024, pdf: 25 * 1024 * 1024 } as const;

export type AllowedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

const EXT_TYPES: Record<string, AllowedType | "image/heic"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  heic: "image/heic",
  heif: "image/heic",
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** Content type from the file's first bytes, or null when it is not an allowed type. */
export function sniffType(b: Uint8Array): AllowedType | "image/heic" | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(b, 4, 4) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis"].includes(ascii(b, 8, 4))) return "image/heic";
  return null;
}

export type ValidatedUpload = { contentType: AllowedType; bytes: Uint8Array; fileName: string; metadataStripped: boolean };

/** Validates type agreement and size, then strips image metadata. Throws 422 DomainErrors with field "file". */
export function validateUpload(input: { fileName: string; declaredType: string; bytes: Uint8Array }): ValidatedUpload {
  const fileName = (input.fileName || "").replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(-200);
  if (!fileName) throw new DomainError("validation", "The file has no name.", { field: "file" });
  if (input.bytes.length === 0) throw new DomainError("validation", "The file is empty.", { field: "file" });
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const byExt = EXT_TYPES[ext];
  const sniffed = sniffType(input.bytes);
  const declared = (input.declaredType || "").toLowerCase().split(";")[0].trim().replace("image/jpg", "image/jpeg").replace("image/heif", "image/heic");
  if (sniffed === "image/heic" || byExt === "image/heic") {
    throw new DomainError("validation", "HEIC photos are not supported yet. Set the phone camera to JPEG (\"Most compatible\") or take a screenshot and upload that.", { field: "file" });
  }
  if (!sniffed || !byExt) throw new DomainError("validation", "Only JPEG, PNG, WebP photos and PDF documents can be uploaded.", { field: "file" });
  if (sniffed !== byExt || (declared && declared !== "application/octet-stream" && declared !== sniffed)) {
    throw new DomainError("validation", "The file's content does not match its name or type. Upload the original photo or PDF.", { field: "file" });
  }
  const cap = sniffed === "application/pdf" ? UPLOAD_LIMITS.pdf : UPLOAD_LIMITS.image;
  if (input.bytes.length > cap) {
    throw new DomainError("validation", `The file is too large: ${(input.bytes.length / 1048576).toFixed(1)} MB. The limit is ${cap / 1048576} MB for ${sniffed === "application/pdf" ? "PDFs" : "photos"}.`, { field: "file" });
  }
  let bytes = input.bytes;
  let metadataStripped = false;
  try {
    if (sniffed === "image/jpeg") bytes = stripJpeg(bytes);
    else if (sniffed === "image/png") bytes = stripPng(bytes);
    else if (sniffed === "image/webp") bytes = stripWebp(bytes);
    metadataStripped = sniffed !== "application/pdf";
  } catch {
    throw new DomainError("validation", "The image file is damaged and cannot be read.", { field: "file" });
  }
  return { contentType: sniffed, bytes, fileName, metadataStripped };
}

/* ------------------------------------------------------------------ JPEG */

/** Orientation (1..8) from an APP1 Exif payload, or null. */
function exifOrientation(seg: Uint8Array): number | null {
  if (ascii(seg, 0, 6) !== "Exif\0\0") return null;
  const t = 6;
  const le = ascii(seg, t, 2) === "II";
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const ifd = t + u32(t + 4);
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

function orientationSegment(o: number): Uint8Array {
  const data = [
    ...Array.from("Exif\0\0", (c) => c.charCodeAt(0)),
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const len = data.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...data]);
}

/** Drops APP1..APP15 (except ICC profile and Adobe) and COM segments; keeps only the orientation tag. */
export function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;
  let insertAt = 1;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error("bad marker");
    const marker = b[i + 1];
    if (marker === 0xd9) {
      parts.push(b.subarray(i));
      break;
    }
    if (marker === 0xff) {
      i += 1; // fill byte before a marker
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error("bad length");
    const seg = b.subarray(i, i + 2 + len);
    const payload = b.subarray(i + 4, i + 2 + len);
    if (marker === 0xda) {
      parts.push(b.subarray(i)); // start of scan: entropy-coded data to the end, copied verbatim
      break;
    }
    const isApp = marker >= 0xe1 && marker <= 0xef;
    if (marker === 0xe1 && ascii(payload, 0, 6) === "Exif\0\0") orientation = exifOrientation(payload) ?? orientation;
    const keepApp = (marker === 0xe2 && ascii(payload, 0, 11) === "ICC_PROFILE") || (marker === 0xee && ascii(payload, 0, 5) === "Adobe");
    if ((isApp && !keepApp) || marker === 0xfe) {
      // dropped: EXIF (GPS, device), XMP, IPTC/Photoshop, comments
    } else {
      parts.push(seg);
      if (marker === 0xe0) insertAt = parts.length;
    }
    i += 2 + len;
  }
  if (orientation && orientation !== 1) parts.splice(insertAt, 0, orientationSegment(orientation));
  return concat(parts);
}

/* ------------------------------------------------------------------ PNG */

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "pHYs", "bKGD", "hIST", "sPLT", "acTL", "fcTL", "fdAT"]);

/** Keeps image-defining chunks only; drops tEXt, zTXt, iTXt, eXIf, tIME and unknown ancillary chunks. */
export function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) throw new Error("bad chunk");
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

/* ------------------------------------------------------------------ WebP */

/** Removes EXIF and XMP chunks and clears their VP8X flags. */
export function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const end = i + 8 + size + (size % 2);
    if (end > b.length + 1) throw new Error("bad chunk");
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = Uint8Array.from(b.subarray(i, Math.min(end, b.length)));
      if (fourcc === "VP8X") chunk[8] &= ~(0x08 | 0x04);
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const riffSize = body.length + 4;
  const header = Uint8Array.from([0x52, 0x49, 0x46, 0x46, riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, (riffSize >> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return concat([header, body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
