/**
 * A date in words for messages and alerts (UX re-audit C, round 4): "30 Oct 2026", never "2026-10-30".
 * A date-only string ("2026-10-30") is that calendar day; a timestamp is shown as its Manila day.
 * Pure; unit tested (tests/unit/plural.test.ts).
 */
export function plainDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const s = v instanceof Date ? v : /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) && String(v).length <= 10 ? new Date(`${String(v)}T12:00:00+08:00`) : new Date(String(v));
  if (Number.isNaN(s.getTime())) return String(v);
  return s.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });
}

/**
 * Every ISO calendar date inside a sentence in words ("was due 2026-10-28" → "was due 28 Oct 2026"), for titles and
 * bodies written before round 4 or by modules that still write ISO dates. Record numbers ("INV-2026-000003") are left alone.
 */
export function plainDatesIn(text: string): string;
export function plainDatesIn(text: string | null): string | null;
export function plainDatesIn(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/(?<![\w-])(\d{4}-\d{2}-\d{2})(?![\w-])/g, (d) => plainDate(d));
}
