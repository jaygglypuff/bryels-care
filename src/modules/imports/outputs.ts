import "server-only";
import { buildXlsx } from "@/lib/export-xlsx";
import { neutralizeCell, toCsv } from "@/lib/export";
import type { ImportKindHandler } from "./kinds";

/**
 * Generated files of the import area: templates (one header row + clearly fictional example rows, §9.2)
 * and the error file (raw row + result + error message, §9.3). Every cell goes through the formula
 * neutraliser (docs/security.md §4.7): a value that starts with = + - @ is written with a leading quote,
 * and XLSX cells are inline strings, so nothing a spreadsheet opens is ever evaluated.
 */
export function templateRows(k: ImportKindHandler): string[][] {
  const header = k.columns.map((c) => c.key);
  return [header.map(neutralizeCell), ...k.exampleRows.map((r) => header.map((h) => neutralizeCell(r[h] ?? "")))];
}

export function templateFile(k: ImportKindHandler, format: "csv" | "xlsx") {
  const rows = templateRows(k);
  return {
    fileName: `template-${k.kind}.${format}`,
    contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: format === "csv" ? toCsv(rows) : buildXlsx(rows, k.label.slice(0, 31)),
  };
}

export type ResultRow = {
  rowNo: number;
  raw: Record<string, string>;
  result: string;
  errorMessage: string | null;
  warnings: string[] | null;
  createdEntityLabel?: string | null;
  matchLabel?: string | null;
};

/** CSV: row number, result, message, warnings, match/created record, then the original columns. */
export function resultCsv(headers: string[], rows: ResultRow[]): Buffer {
  const head = ["row_no", "result", "error_message", "warnings", "matched_or_created", ...headers];
  const body = rows.map((r) =>
    [String(r.rowNo), r.result, r.errorMessage ?? "", (r.warnings ?? []).join(" | "), r.createdEntityLabel ?? r.matchLabel ?? "", ...headers.map((h) => r.raw[h] ?? "")].map(neutralizeCell),
  );
  return toCsv([head.map(neutralizeCell), ...body]);
}
