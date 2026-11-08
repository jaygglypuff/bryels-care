/**
 * Number normalisation for the master search (owner request 2026-11-08 "plus any code like BILL-26-00001").
 * Pure: no database, no server imports (unit-tested in tests/unit/scan/master-search-numbers.test.ts).
 *
 * People type record numbers in many ways. All of these find BILL-26-00001:
 * | Typed            | How                                                                  |
 * |------------------|----------------------------------------------------------------------|
 * | BILL-26-00001    | as stored (exact)                                                    |
 * | bill-26-00001    | capitals do not matter (exact)                                       |
 * | BILL2600001      | dashes put back from the number's shape `BILL-{YY}-{SEQ}` (exact)    |
 * | BILL 26 00001    | spaces count as dashes (exact)                                       |
 * | BC:DOC:…         | a scanned label prefix is dropped first                              |
 * | 26-00001, 00001  | the last digits: every number that ends with or contains them (partial) |
 */

/** How the part after the prefix is built (src/lib/numbering.ts NUMBERING_DEFAULTS). */
export type NumberShape =
  | "YY" // {PREFIX}-{YY}-{SEQ}
  | "YYYY" // {PREFIX}-{YYYY}-{SEQ}
  | "YYMM" // {PREFIX}-{YYMM}-{SEQ}
  | "SEQ"; // {PREFIX}-{SEQ}

/** Prefix → shape of the built-in numbering defaults (kept in step with NUMBERING_DEFAULTS by a unit test). */
export const NUMBER_SHAPES: Readonly<Record<string, NumberShape>> = {
  GR: "YY", L: "YYMM", B: "YY", SO: "YY", DR: "YY", MOV: "YY", QH: "YY", BX: "SEQ", TR: "YY", CNT: "YY", ADJ: "YY", RSV: "YY",
  DOC: "YY", INS: "YY", DEV: "YY", WO: "YY", PP: "YYMM", QT: "YY", PA: "YY", PK: "YY", SH: "YY", CMP: "YY", RT: "YY",
  IMP: "YYMM", LDOC: "SEQ", PR: "YY", PO: "YY", SRT: "YY", INV: "YYYY", BILL: "YY", PAY: "YY", CN: "YYYY", EXP: "YY",
  CAPA: "YY", CC: "YY", RC: "YYYY", PM: "SEQ", MWO: "YY", MAT: "SEQ", PRD: "SEQ", SUP: "SEQ", CUS: "SEQ", LOC: "SEQ",
  EQP: "SEQ", WH: "SEQ", LINE: "SEQ", DEP: "SEQ", QCP: "SEQ", SKU: "SEQ", F: "SEQ", R: "SEQ", WI: "SEQ",
};

const HEAD = { YY: 2, YYYY: 4, YYMM: 4, SEQ: 0 } as const;

/** The seven typed label prefixes of ADR-017 (a scanned label typed into the box). */
const LABEL_PREFIX = /^BC:(LOT|BOX|LOC|MAT|SKU|EQP|DOC):/i;

export type NumberQuery = {
  /** Upper case, label prefix dropped, runs of spaces as one dash ("BILL-26-00001"). */
  text: string;
  /** Letters and digits only ("BILL2600001"). */
  compact: string;
  /** Exact forms to look up: the text itself and, from a known prefix, the number with its dashes put back. */
  exact: string[];
  /** The letters the number starts with when they are a known prefix ("BILL"), else null. */
  prefix: string | null;
  /** True when the text looks like a number or code (has a digit). */
  numberLike: boolean;
};

/** Normalises what was typed into the forms the search looks up. Never throws. */
export function parseNumberQuery(input: string): NumberQuery {
  const text = String(input ?? "")
    .trim()
    .replace(LABEL_PREFIX, "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .slice(0, 64);
  const compact = text.replace(/[^A-Z0-9]/g, "");
  const letters = compact.match(/^[A-Z]+/)?.[0] ?? "";
  const prefix = letters && NUMBER_SHAPES[letters] ? letters : null;
  const exact = new Set<string>();
  if (text) exact.add(text);
  if (prefix) {
    const rest = compact.slice(prefix.length);
    const shape = NUMBER_SHAPES[prefix];
    const head = HEAD[shape];
    if (/^\d+$/.test(rest) && rest.length > head) exact.add(head ? `${prefix}-${rest.slice(0, head)}-${rest.slice(head)}` : `${prefix}-${rest}`);
  }
  return { text, compact, exact: [...exact], prefix, numberLike: /\d/.test(compact) };
}

/**
 * Whether a typed value should also be looked up as part of a number: it has a digit and at least 3 letters or
 * digits ("26-00001", "so-26", "00001"). Words alone ("bills") never search numbers.
 */
export function wantsPartial(q: NumberQuery): boolean {
  return q.numberLike && q.compact.length >= 3;
}

/** LIKE-safe fragment (the user's % and _ are matched literally). */
export function likeFragment(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Words people put before a short number ("order 4", "batch 3"), and the number prefixes they mean (round 5, C report
 * #15: "order 4" should find SO-26-00004). Lower case; plurals are folded by the caller.
 */
export const WORD_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  order: ["SO", "PO", "WO"],
  "customer order": ["SO"],
  "sales order": ["SO"],
  "purchase order": ["PO"],
  "production order": ["WO"],
  batch: ["B"],
  lot: ["L"],
  invoice: ["INV"],
  bill: ["BILL"],
  delivery: ["SH", "GR"],
  payment: ["PAY"],
  request: ["PR"],
  quote: ["QT"],
  offer: ["QT"],
  "price offer": ["QT"],
  problem: ["DEV"],
  box: ["BX"],
  customer: ["CUS"],
  supplier: ["SUP"],
  product: ["PRD"],
  material: ["MAT"],
  count: ["CNT"],
  return: ["RT", "SRT"],
};

/**
 * A short record number (round 5, A report B14 and C report #15): "4", "0003", "SO 4", "so-4", "order 4". The records
 * it finds have numbers that END with this number ("4" → SO-26-00004, WO-26-00004, CUS-0004; "0003" → B-26-0003),
 * whatever zeros stand in front. `prefixes` narrows the record types (null: every type). Null when the text is not one.
 * Longer partial numbers ("26-00001") keep the "contains" search (`wantsPartial`).
 */
export type ShortNumber = { prefixes: readonly string[] | null; /** The number without leading zeros ("3"; "0" for all zeros). */ n: string };

export function parseShortNumber(input: string): ShortNumber | null {
  const text = String(input ?? "").trim().replace(LABEL_PREFIX, "").toLowerCase().replace(/\s+/g, " ").slice(0, 64);
  if (!text) return null;
  const strip = (d: string) => d.replace(/^0+(?=\d)/, "");
  // Digits only, at most 6 ("4", "0003", "00012").
  let m = /^(\d{1,6})$/.exec(text);
  if (m) return { prefixes: null, n: strip(m[1]) };
  // A number prefix and a short number ("SO 4", "so-4", "B 3", "inv4").
  m = /^([a-z]{1,4})[ -]?(\d{1,6})$/.exec(text);
  if (m && NUMBER_SHAPES[m[1].toUpperCase()]) return { prefixes: [m[1].toUpperCase()], n: strip(m[2]) };
  // A word and a short number ("order 4", "batches 3", "customer order 12", "order no. 4", "order #4").
  m = /^([a-z][a-z ]*?)\s*(?:no\.?|number|#)?\s*(\d{1,6})$/.exec(text);
  if (m) {
    const word = m[1].trim();
    const forms = [word, word.replace(/ies$/, "y"), word.replace(/es$/, ""), word.replace(/s$/, "")];
    for (const f of forms) if (WORD_PREFIXES[f]) return { prefixes: WORD_PREFIXES[f], n: strip(m[2]) };
  }
  return null;
}

/** Postgres regex for "the number ends with this number" (any zeros before it, and a non-digit or the start before). */
export function endsWithNumberRegex(n: string): string {
  return `(^|[^0-9])0*${n.replace(/[^0-9]/g, "")}$`;
}
