import { inflateRawSync } from "node:zlib";
import Decimal from "decimal.js";
import { ParseError, finishSheet, type ParseLimits, type ParsedSheet } from "./types";

/**
 * Values-only XLSX reader (docs/security.md §2.6). No dependency and nothing is ever executed:
 * - macro-enabled workbooks (`.xlsm`, a `vbaProject.bin` part or a macro content type) are refused;
 * - formula cells contribute only their cached value (counted and reported), external links and
 *   data connections are never opened;
 * - the zip container is bounded: at most 4,000 parts, each part inflated with a hard output cap, so a
 *   zip bomb fails instead of exhausting memory;
 * - numbers are read as decimal strings (15 significant digits, Excel's precision; ADR-010) and cells
 *   with a date format become ISO dates (YYYY-MM-DD).
 * Only the first worksheet is read.
 */
const MAX_PARTS = 4000;
const MAX_PART_BYTES = 150 * 1024 * 1024;

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

function readZipDirectory(b: Buffer): Map<string, ZipEntry> {
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) throw new ParseError("The file is not a valid XLSX workbook.");
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ParseError("The workbook is damaged (no zip directory). Save it again as .xlsx.");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  if (count > MAX_PARTS) throw new ParseError("The workbook has too many parts to be a plain spreadsheet.");
  const out = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new ParseError("The workbook is damaged (zip directory). Save it again as .xlsx.");
    const method = b.readUInt16LE(p + 10);
    const compressedSize = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    out.set(name.replace(/^\/+/, ""), { name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readPart(b: Buffer, e: ZipEntry): string {
  if (e.size > MAX_PART_BYTES) throw new ParseError("The workbook is too large once unpacked.", "too_large");
  if (b.readUInt32LE(e.offset) !== 0x04034b50) throw new ParseError("The workbook is damaged (zip entry). Save it again as .xlsx.");
  const nameLen = b.readUInt16LE(e.offset + 26);
  const extraLen = b.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = b.subarray(start, start + e.compressedSize);
  let raw: Buffer;
  if (e.method === 0) raw = Buffer.from(data);
  else if (e.method === 8) {
    try {
      raw = inflateRawSync(data, { maxOutputLength: Math.min(MAX_PART_BYTES, Math.max(e.size, 1) + 1024) });
    } catch {
      throw new ParseError("The workbook could not be unpacked (damaged or larger than it declares).");
    }
  } else throw new ParseError("The workbook uses an unsupported compression. Save it again as .xlsx.");
  return raw.toString("utf8");
}

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITY[e] ?? m;
  });
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

/** Text of every <t> inside a string item (rich text runs), ignoring phonetic runs. */
function itemText(xml: string): string {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of noPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Built-in date/time number formats (ECMA-376 §18.8.30) and custom formats with day/month/year tokens. */
function isDateFormat(id: number, code: string | undefined): boolean {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
  if (!code) return false;
  const cleaned = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dy]/i.test(cleaned) || (/m/i.test(cleaned) && !/[0#]/.test(cleaned));
}

function serialToIso(serial: Decimal, date1904: boolean): string | null {
  if (!serial.isFinite() || serial.lt(0) || serial.gt(2_958_465)) return null;
  const days = serial.floor().toNumber();
  // Excel's 1900 system counts the non-existent 1900-02-29; serials after it are one day ahead.
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const adj = !date1904 && days < 61 ? days + 1 : days;
  const d = new Date(base + adj * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Decimal string of a cached numeric value, rounded to Excel's 15 significant digits. */
export function excelNumber(v: string): string {
  try {
    const d = new Decimal(v.trim());
    if (!d.isFinite()) return v;
    return d.toSignificantDigits(15).toFixed();
  } catch {
    return v;
  }
}

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function parseXlsx(bytes: Uint8Array, limits: ParseLimits): ParsedSheet {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = readZipDirectory(b);
  const part = (name: string) => {
    const e = dir.get(name);
    return e ? readPart(b, e) : null;
  };
  const contentTypes = part("[Content_Types].xml");
  if (!contentTypes || !dir.has("xl/workbook.xml")) throw new ParseError("The file is not an Excel workbook (.xlsx).");
  if ([...dir.keys()].some((n) => /vbaProject\.bin$/i.test(n)) || /macroEnabled/i.test(contentTypes)) {
    throw new ParseError("Macro-enabled workbooks (.xlsm) are not accepted. Save the sheet as a plain .xlsx or CSV and upload again.", "macro");
  }
  const workbook = part("xl/workbook.xml")!;
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  if (!firstSheet) throw new ParseError("The workbook has no worksheet.");
  const relId = attr(firstSheet, "r:id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = part("xl/_rels/workbook.xml.rels");
  if (rels && relId) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === relId);
    const target = rel ? attr(rel, "Target") : null;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheetXml = part(sheetPath);
  if (!sheetXml) throw new ParseError("The first worksheet of the workbook could not be read.");

  const shared: string[] = [];
  const sst = part("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(itemText(m[1] ?? ""));

  const xfDate: boolean[] = [];
  const styles = part("xl/styles.xml");
  if (styles) {
    const fmts = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) fmts.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    for (const m of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attr(m[0], "numFmtId") ?? 0);
      xfDate.push(isDateFormat(id, fmts.get(id)));
    }
  }

  let formulaCells = 0;
  const grid: { cells: string[]; line: number }[] = [];
  let nextRow = 1;
  for (const rm of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rAttr = rm[1] ? attr(rm[1], "r") : null;
    const line = rAttr ? Number(rAttr) : nextRow;
    nextRow = line + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = attr(a, "r");
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col > 16_383) continue;
      const t = attr(a, "t") ?? "n";
      const s = Number(attr(a, "s") ?? 0);
      if (/<f\b/.test(body)) formulaCells++;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (t === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (t === "inlineStr") value = itemText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (t === "str") value = v !== undefined ? decodeXml(v) : "";
      else if (t === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (t === "e") value = v !== undefined ? decodeXml(v) : "#ERROR";
      else if (v !== undefined) {
        const num = excelNumber(decodeXml(v));
        value = xfDate[s] ? (serialToIso(new Decimal(num), date1904) ?? num) : num;
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    grid.push({ cells, line });
    if (grid.length > limits.maxRows + 1000) throw new ParseError(`The sheet has more than ${limits.maxRows.toLocaleString("en-PH")} data rows. Split it into smaller files.`, "too_large");
  }
  const notes: string[] = [];
  if (formulaCells > 0) notes.push(`${formulaCells} cell(s) contain formulas; their last calculated values were used, the formulas were ignored.`);
  if (/<sheet\b[^>]*>[\s\S]*<sheet\b/.test(workbook)) notes.push("Only the first worksheet was read.");
  return finishSheet("xlsx", grid, limits, formulaCells, notes);
}
