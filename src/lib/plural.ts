/**
 * Counts in plain words (UX re-audit C, round 4): "1 invoice", "3 invoices", "2 boxes", "1 delivery",
 * "4 deliveries", never "invoice(s)". `many` overrides the English rule for odd words ("person" → "people").
 * Pure; unit tested (tests/unit/plural.test.ts).
 */
export function pluralWord(n: number | string | bigint, one: string, many?: string): string {
  const count = Number(n);
  if (count === 1) return one;
  if (many) return many;
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(one)) return `${one}es`;
  return `${one}s`;
}

/** "1 invoice" / "3 invoices" (the number, a space, the word in the right form). */
export function plural(n: number | string | bigint, one: string, many?: string): string {
  return `${n} ${pluralWord(n, one, many)}`;
}

/** "is" / "are" for a count ("1 invoice is late", "3 invoices are late"). */
export const isAre = (n: number | string | bigint) => (Number(n) === 1 ? "is" : "are");
/** "was" / "were" for a count. */
export const wasWere = (n: number | string | bigint) => (Number(n) === 1 ? "was" : "were");
/** "waits" / "wait" for a count ("1 claim waits", "3 claims wait"). */
export const waits = (n: number | string | bigint) => (Number(n) === 1 ? "waits" : "wait");
