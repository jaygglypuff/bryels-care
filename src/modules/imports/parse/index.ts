import { parseCsv } from "./csv";
import { isXlsx, parseXlsx } from "./xlsx";
import { ParseError, type ParseLimits, type ParsedSheet } from "./types";

export { ParseError, type ParsedSheet, type ParseLimits } from "./types";
export { parseCsv } from "./csv";
export { parseXlsx, isXlsx, excelNumber } from "./xlsx";

/**
 * Upload gate for import files (docs/security.md §2.5, §2.6): the extension decides the expected
 * format and the bytes must agree (an XLSX is a zip container; a CSV is UTF-8 text). `.xlsm`, `.xls`
 * and anything else are refused before parsing.
 */
export function parseImportFile(fileName: string, bytes: Uint8Array, limits: ParseLimits): ParsedSheet {
  const ext = (fileName.includes(".") ? fileName.split(".").pop()! : "").toLowerCase();
  if (ext === "xlsm" || ext === "xltm" || ext === "xlsb") throw new ParseError("Macro-enabled or binary workbooks are not accepted. Save the sheet as a plain .xlsx or CSV and upload again.", "macro");
  if (ext === "xls") throw new ParseError("Old Excel files (.xls) are not accepted. Save the sheet as .xlsx or CSV UTF-8.");
  if (ext === "xlsx") {
    if (!isXlsx(bytes)) throw new ParseError("The file is named .xlsx but is not an Excel workbook.");
    return parseXlsx(bytes, limits);
  }
  if (ext === "csv" || ext === "txt") {
    if (isXlsx(bytes)) throw new ParseError("The file is named .csv but is a workbook. Rename it to .xlsx or save it as CSV.");
    return parseCsv(bytes, limits);
  }
  throw new ParseError("Upload a CSV (UTF-8) or an Excel .xlsx file made from the template.");
}
