/**
 * Plain plurals for screen text (UX re-audit B, 2026-11-01): "1 order", "3 orders", never "order(s)".
 *
 *   plural(1, "box", "boxes")   → "1 box"
 *   plural(3, "box", "boxes")   → "3 boxes"
 *   plural(2, "purchase order") → "2 purchase orders"   (regular words add "s")
 *   pluralWord(n, "is", "are")  → the word only, for sentences ("1 order is …", "2 orders are …")
 *
 * Counts may be numbers or numeric strings; anything that is not exactly 1 (including 0) is plural.
 */
export function pluralWord(n: number | string, one: string, many?: string): string {
  return Number(n) === 1 ? one : (many ?? `${one}s`);
}

export function plural(n: number | string, one: string, many?: string): string {
  return `${typeof n === "number" ? n.toLocaleString("en-PH") : n} ${pluralWord(n, one, many)}`;
}
