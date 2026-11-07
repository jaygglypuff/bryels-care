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
