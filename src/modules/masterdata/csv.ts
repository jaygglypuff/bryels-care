/**
 * CSV export helpers (docs/security.md §4.7): every field is quoted, rows end with \r\n, and any value
 * starting with = + - @ tab or carriage return is prefixed with a single quote so spreadsheets never
 * evaluate it as a formula.
 */
export function neutralizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const q = (v: unknown) => `"${neutralizeCell(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
