/**
 * Parsed import file (docs/security.md §2.6): one sheet of text cells. Values are never evaluated;
 * spreadsheet formulas contribute only their last calculated value (counted in `formulaCells`).
 */
export type ParsedSheet = {
  format: "csv" | "xlsx";
  headers: string[];
  /** Data rows (header excluded), each with exactly `headers.length` cells; blank rows are dropped. */
  rows: string[][];
  /** Spreadsheet row/line number of each data row (for messages that point at the file). */
  sourceRowNumbers: number[];
  formulaCells: number;
  notes: string[];
};

/** Thrown by the parsers; the service turns it into a 422/413 DomainError naming the file field. */
export class ParseError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "too_large" | "macro" = "invalid",
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export type ParseLimits = { maxRows: number; maxColumns?: number; maxCellLength?: number };

export const DEFAULT_MAX_COLUMNS = 200;
export const DEFAULT_MAX_CELL_LENGTH = 4000;

/** Header cleanup shared by both parsers: trimmed, unique, blank headers named column_N. */
export function normaliseHeaders(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  raw.forEach((h, i) => {
    let name = (h ?? "").replace(/\s+/g, " ").trim();
    if (!name) name = `column_${i + 1}`;
    if (seen.has(name.toLowerCase())) throw new ParseError(`The header "${name}" appears twice. Give every column a different name.`);
    seen.add(name.toLowerCase());
    out.push(name);
  });
  return out;
}

/** Drops trailing blank header columns that carry no data, pads short rows, enforces the limits. */
export function finishSheet(format: "csv" | "xlsx", grid: { cells: string[]; line: number }[], limits: ParseLimits, formulaCells: number, notes: string[]): ParsedSheet {
  const maxCols = limits.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const maxCell = limits.maxCellLength ?? DEFAULT_MAX_CELL_LENGTH;
  const nonBlank = grid.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (nonBlank.length === 0) throw new ParseError("The file is empty. Use the template: one header row, then one row per record.");
  const [head, ...data] = nonBlank;
  let width = head.cells.length;
  while (width > 0 && head.cells[width - 1].trim() === "" && data.every((r) => (r.cells[width - 1] ?? "").trim() === "")) width -= 1;
  if (width > maxCols) throw new ParseError(`The file has ${width} columns; at most ${maxCols} are accepted.`);
  const headers = normaliseHeaders(head.cells.slice(0, width));
  if (data.length === 0) throw new ParseError("The file has a header row but no data rows.");
  if (data.length > limits.maxRows) throw new ParseError(`The file has ${data.length.toLocaleString("en-PH")} data rows; the limit is ${limits.maxRows.toLocaleString("en-PH")}. Split it into smaller files.`, "too_large");
  const rows: string[][] = [];
  for (const r of data) {
    if (r.cells.slice(width).some((c) => c.trim() !== "")) throw new ParseError(`Row ${r.line} has values in columns without a header. Add a header or remove the values.`);
    const cells = headers.map((_, i) => r.cells[i] ?? "");
    const long = cells.findIndex((c) => c.length > maxCell);
    if (long >= 0) throw new ParseError(`Row ${r.line}, column "${headers[long]}" is longer than ${maxCell} characters.`);
    rows.push(cells);
  }
  return { format, headers, rows, sourceRowNumbers: data.map((r) => r.line), formulaCells, notes };
}
