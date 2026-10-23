/** Helpers shared by renderers (print contract: docs/reports-and-templates.md §10). */

/** Escapes text for a CSS string literal (used in @page margin boxes). */
export function cssString(v: string): string {
  const body = String(v)
    .replace(/[\\"]/g, (c) => "\\" + c)
    .replace(/[\r\n\u2028\u2029]/g, " ")
    .replace(/[<>]/g, "");
  return '"' + body + '"';
}

/** Formats a millimetre number for CSS without float noise (e.g. 28, 27.5). */
export function mmCss(v: number): string {
  return `${Math.round(v * 10) / 10}mm`;
}

export const FONT_STACK = `Inter, "Helvetica Neue", Arial, sans-serif`;
export const MONO_STACK = `ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;

/** Lot quality status → the word printed on labels (status at print, A-RPT-10). */
export const STATUS_WORD: Record<string, string> = {
  quarantine: "QUARANTINE",
  released: "RELEASED",
  on_hold: "ON HOLD",
  rejected: "REJECTED",
  expired: "EXPIRED",
  recalled: "RECALLED",
};

export function shortHash(hex: string): string {
  return hex.replace(/-/g, "").slice(0, 8).toUpperCase();
}
