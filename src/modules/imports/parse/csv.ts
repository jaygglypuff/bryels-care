import { ParseError, finishSheet, type ParseLimits, type ParsedSheet } from "./types";

/**
 * RFC 4180 CSV reader (docs/data-migration-plan.md §7 general rules): UTF-8 only (a BOM is accepted
 * and dropped), comma, semicolon or tab delimiter detected from the header line, quoted fields with
 * embedded quotes and line breaks. Values are kept verbatim: a cell starting with "=" stays text and
 * is neutralised whenever it is exported again (docs/security.md §4.7).
 */
export function parseCsv(bytes: Uint8Array, limits: ParseLimits): ParsedSheet {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ParseError("The file is not UTF-8 text. In your spreadsheet choose \"Save as → CSV UTF-8\" and upload again.");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\u0000")) throw new ParseError("The file contains binary data. Upload a CSV (text) or an XLSX workbook.");
  const delimiter = detectDelimiter(text);
  const grid: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let atFieldStart = true;
  let line = 1;
  let rowLine = 1;
  const pushRow = () => {
    cells.push(cur);
    grid.push({ cells, line: rowLine });
    cells = [];
    cur = "";
    atFieldStart = true;
    // Header + maxRows data rows + a margin for blank rows; beyond that the file is too large anyway.
    if (grid.length > limits.maxRows + 1000) throw new ParseError(`The file has more than ${limits.maxRows.toLocaleString("en-PH")} data rows. Split it into smaller files.`, "too_large");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cur);
      cur = "";
      atFieldStart = true;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      line++;
      rowLine = line;
      continue;
    }
    cur += ch;
    atFieldStart = false;
  }
  if (quoted) throw new ParseError(`A quoted value that starts on line ${rowLine} is never closed. Check the quotes in that row.`);
  if (cur !== "" || cells.length > 0) pushRow();
  return finishSheet("csv", grid, limits, 0, delimiter === "," ? [] : [`Columns are separated by "${delimiter === "\t" ? "tab" : delimiter}".`]);
}

function detectDelimiter(text: string): string {
  let firstLine = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) break;
    if (!quoted) firstLine += ch;
  }
  const count = (d: string) => firstLine.split(d).length - 1;
  const candidates: [string, number][] = [",", ";", "\t"].map((d) => [d, count(d)]);
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}
