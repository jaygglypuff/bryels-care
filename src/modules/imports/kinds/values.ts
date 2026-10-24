import Decimal from "decimal.js";
import type { RowIssue } from "./types";

/**
 * Column mapping and value reading (docs/data-migration-plan.md §7 general rules, A-MIG-04): values
 * trimmed and internal whitespace collapsed, codes upper-cased, dates parsed with the declared source
 * format and stored as ISO dates, decimal and thousands separators declared in the mapping, quantities
 * kept as decimal strings (ADR-010, never floats). Nothing is guessed: a value that does not parse is a
 * field error on the row, never silently changed.
 */
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DECIMAL_SEPARATORS = [".", ","] as const;
export const THOUSANDS_SEPARATORS = [",", ".", " ", "none"] as const;

export type MappingDefinition = {
  /** template column → file header (null = not in the file). */
  columns: Record<string, string | null>;
  dateFormat: DateFormat;
  decimalSeparator: (typeof DECIMAL_SEPARATORS)[number];
  thousandsSeparator: (typeof THOUSANDS_SEPARATORS)[number];
};

/** A-MIG-04 defaults: thousands ",", decimal ".", dates DD/MM/YYYY. */
export const DEFAULT_FORMATS = { dateFormat: "DD/MM/YYYY", decimalSeparator: ".", thousandsSeparator: "," } as const;

export const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Maps template columns to file headers by name (or alias); unmatched columns stay null. */
export function autoMap(columns: { key: string; aliases?: string[] }[], headers: string[]): Record<string, string | null> {
  const byKey = new Map(headers.map((h) => [headerKey(h), h]));
  const out: Record<string, string | null> = {};
  for (const c of columns) out[c.key] = [c.key, ...(c.aliases ?? [])].map((k) => byKey.get(headerKey(k))).find(Boolean) ?? null;
  return out;
}

export const collapse = (v: string | null | undefined) => (v ?? "").replace(/[\s ]+/g, " ").trim();

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO date from a value in the declared format (ISO is always accepted: XLSX date cells arrive as ISO). */
export function parseDate(v: string, fmt: DateFormat): string | null {
  const s = collapse(v);
  let y: number, m: number, d: number;
  const iso = ISO_RE.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const parts = s.split(/[/.-]/);
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    if (fmt === "YYYY-MM-DD") [y, m, d] = parts.map(Number) as [number, number, number];
    else if (fmt === "MM/DD/YYYY") [m, d, y] = parts.map(Number) as [number, number, number];
    else [d, m, y] = parts.map(Number) as [number, number, number];
    if (parts[fmt === "YYYY-MM-DD" ? 0 : 2].length !== 4) return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Decimal string from a value with the declared separators; null when it is not a plain number. */
export function parseDecimal(v: string, decimalSep: "." | ",", thousandsSep: "," | "." | " " | "none"): string | null {
  let s = collapse(v);
  if (!s) return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const ts = thousandsSep === "none" ? null : thousandsSep;
  if (ts && ts !== decimalSep && s.includes(ts)) {
    const [intPart, ...rest] = s.split(decimalSep);
    if (rest.length > 1) return null;
    if (!new RegExp(`^\\d{1,3}(${ts === "." ? "\\." : ts}\\d{3})+$`).test(intPart)) return null;
    s = intPart.split(ts).join("") + (rest.length ? decimalSep + rest[0] : "");
  }
  if (decimalSep === ",") s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const d = new Decimal(s);
  return (neg ? d.neg() : d).toFixed();
}

const TRUE = new Set(["yes", "y", "true", "1", "x", "oo"]);
const FALSE = new Set(["no", "n", "false", "0", "hindi"]);

/**
 * Reads one mapped row. Every getter records a field error on bad input and returns null, so a kind can
 * read all columns and report every problem of the row at once.
 */
export class RowReader {
  readonly errors: RowIssue[] = [];
  readonly warnings: string[] = [];
  constructor(
    private readonly rec: Record<string, string>,
    private readonly m: Pick<MappingDefinition, "dateFormat" | "decimalSeparator" | "thousandsSeparator">,
    private readonly labels: Record<string, string> = {},
  ) {}

  private label(key: string) {
    return this.labels[key] ?? key;
  }
  error(field: string, message: string) {
    this.errors.push({ field, message });
  }
  warn(message: string) {
    this.warnings.push(message);
  }
  /** Trimmed, whitespace-collapsed text ("" when blank). */
  raw(key: string): string {
    return collapse(this.rec[key]);
  }
  has(key: string): boolean {
    return this.raw(key) !== "";
  }
  text(key: string, o: { required?: boolean; max?: number } = {}): string | null {
    const v = this.raw(key);
    if (!v) {
      if (o.required) this.error(key, `${this.label(key)} is required.`);
      return null;
    }
    if (o.max && v.length > o.max) {
      this.error(key, `${this.label(key)} is longer than ${o.max} characters.`);
      return null;
    }
    return v;
  }
  /** Upper-cased code checked against a pattern (default: the scan grammar of docs/security.md §4.9). */
  code(key: string, o: { required?: boolean; pattern?: RegExp; example?: string } = {}): string | null {
    const v = this.text(key, { required: o.required, max: 64 });
    if (!v) return null;
    const c = v.toUpperCase();
    const re = o.pattern ?? /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
    if (!re.test(c)) {
      this.error(key, `${this.label(key)} "${v}": use capital letters, digits, dot, dash or underscore${o.example ? `, e.g. ${o.example}` : ""}.`);
      return null;
    }
    return c;
  }
  int(key: string, o: { required?: boolean; min?: number; max?: number } = {}): number | null {
    const v = this.raw(key);
    if (!v) {
      if (o.required) this.error(key, `${this.label(key)} is required.`);
      return null;
    }
    const d = parseDecimal(v, this.m.decimalSeparator, this.m.thousandsSeparator);
    const n = d === null ? NaN : Number(d);
    const min = o.min ?? 0;
    const max = o.max ?? 1_000_000_000;
    if (d === null || !new Decimal(d).isInteger() || n < min || n > max) {
      this.error(key, `${this.label(key)} "${v}" must be a whole number from ${min} to ${max.toLocaleString("en-PH")}.`);
      return null;
    }
    return n;
  }
  /** Decimal string; `positive` requires > 0; at most `dp` decimals (default 6, ADR-010). */
  decimal(key: string, o: { required?: boolean; positive?: boolean; nonNegative?: boolean; dp?: number } = {}): string | null {
    const v = this.raw(key);
    if (!v) {
      if (o.required) this.error(key, `${this.label(key)} is required.`);
      return null;
    }
    const d = parseDecimal(v, this.m.decimalSeparator, this.m.thousandsSeparator);
    if (d === null) {
      this.error(key, `${this.label(key)} "${v}" is not a number in the declared format (decimal "${this.m.decimalSeparator}", thousands "${this.m.thousandsSeparator}").`);
      return null;
    }
    const n = new Decimal(d);
    if (o.positive && n.lte(0)) {
      this.error(key, `${this.label(key)} must be greater than zero.`);
      return null;
    }
    if (o.nonNegative && n.lt(0)) {
      this.error(key, `${this.label(key)} cannot be negative.`);
      return null;
    }
    if (n.decimalPlaces() > (o.dp ?? 6)) {
      this.error(key, `${this.label(key)} has more than ${o.dp ?? 6} decimal places.`);
      return null;
    }
    return d;
  }
  date(key: string, o: { required?: boolean } = {}): string | null {
    const v = this.raw(key);
    if (!v) {
      if (o.required) this.error(key, `${this.label(key)} is required.`);
      return null;
    }
    const d = parseDate(v, this.m.dateFormat);
    if (!d) this.error(key, `${this.label(key)} "${v}" is not a valid date in the declared format ${this.m.dateFormat}.`);
    return d;
  }
  bool(key: string, dflt: boolean | null = null): boolean | null {
    const v = this.raw(key).toLowerCase();
    if (!v) return dflt;
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    this.error(key, `${this.label(key)} "${this.raw(key)}": use yes or no.`);
    return dflt;
  }
  /** One of a fixed list (case-insensitive); `synonyms` map file words to list values. */
  oneOf<T extends string>(key: string, values: readonly T[], o: { required?: boolean; synonyms?: Record<string, T>; dflt?: T } = {}): T | null {
    const v = this.raw(key).toLowerCase().replace(/[\s-]+/g, "_");
    if (!v) {
      if (o.required && !o.dflt) this.error(key, `${this.label(key)} is required (${values.join(", ")}).`);
      return o.dflt ?? null;
    }
    const hit = (values as readonly string[]).find((x) => x.toLowerCase() === v) ?? o.synonyms?.[v];
    if (!hit) {
      this.error(key, `${this.label(key)} "${this.raw(key)}" is not one of: ${values.join(", ")}.`);
      return null;
    }
    return hit as T;
  }
}

/** Name used for tier 2 duplicate matching (§8): lower-case, without punctuation, units and extra words. */
export function normalisedName(s: string): string {
  return collapse(s)
    .toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(g|kg|mg|ml|l|pcs|pc|%)\b/g, " ")
    .replace(/\b(inc|corp|corporation|co|ltd|llc|trading|enterprises?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Trigram (Jaccard) similarity in [0, 1] used for tier 3 warnings (§8: ≥ 0.85). Pure and deterministic. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = `  ${normalisedName(s)} `;
    const out = new Set<string>();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return common / (x.size + y.size - common);
}

export const TIER3_THRESHOLD = 0.85;
