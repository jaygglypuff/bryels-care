/**
 * Scan-or-pick value resolution (owner review 2026-10-31, "how would he scan it?").
 *
 * One way to identify a lot, box, shelf, batch or item anywhere in the app (`src/ui/scan-or-pick.tsx`):
 * tap one of the expected candidates, scan the label (camera or hardware scanner), or find it by words.
 * This file is the pure part shared by the component (client) and the server resolvers, so it must
 * stay free of Node and browser APIs. Unit tests: tests/unit/scan/scan-or-pick.test.ts.
 *
 * Rules (never fake a value):
 * - Empty input, the placeholder text, or anything that is not a label payload / record number is NOT a
 *   value. It is either words to search for, or refused.
 * - A label of the wrong kind ("BC:LOC:…" where a lot is asked for) is refused with a plain message.
 * - A label or number that matches a candidate's `codes` selects that candidate (no server call).
 */
import { normalizeScanInput, parseScan, type ScanType } from "./payload";

export const PICK_KINDS = ["lot", "container", "location", "batch", "item", "equipment"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

/**
 * How a value was given (owner decision 2026-11-08, A-SCAN-TYPED-01): `scan` = camera or handheld scanner,
 * `typed` = the code printed on the label typed in by a person, `tap` = chosen from a list (or found by name).
 * Typing reads the physical label, so it counts for verification checks; a tap does not.
 */
export const PICK_VIAS = ["scan", "typed", "tap"] as const;
export type PickVia = (typeof PICK_VIAS)[number];

/** Parses a `via` sent by a form ("scan" | "typed" | "tap"); anything else is null. */
export function parseVia(v: unknown): PickVia | null {
  return typeof v === "string" && (PICK_VIAS as readonly string[]).includes(v) ? (v as PickVia) : null;
}

/** One thing the user can tap. `value` is what the form submits (usually the record id). */
export type PickCandidate = {
  value: string;
  /** Big line: what it is, in plain words ("Coconut oil"). */
  title: string;
  /** Small line: lot number, amount, shelf, expiry… */
  detail?: string;
  /** Numbers printed on its label (lot number, box number, shelf code, batch number, item code). */
  codes?: string[];
  /** The record's own number, for forms that submit the number instead of the id (`submit="code"`). */
  code?: string;
  /** Base unit of a lot (g, mL, pcs), for the amount box that follows. */
  uom?: string;
  /** Places holding it (lots): the "which shelf?" choice that follows. */
  places?: PickCandidate[];
  /** Shown greyed out and not tappable, with the reason. */
  disabledReason?: string;
  /** Optional chip text ("waiting for QA", "set aside"). */
  badge?: string;
  badgeTone?: "ok" | "warn" | "bad" | "info";
};

/** Label payload types that identify each kind. A batch is found by its number or by the lot number on its product labels. */
export const PICK_PAYLOAD_TYPES: Record<PickKind, ScanType[]> = {
  lot: ["LOT"],
  container: ["BOX"],
  location: ["LOC"],
  batch: ["LOT"], // ADR-099: a product label on a bar carries BC:LOT:<the lot the batch will make>
  item: ["MAT", "SKU"],
  equipment: ["EQP"], // ADR-125: machines and scales; the app prints no BC:EQP label yet (follow-up), the code is typed or tapped
};

/**
 * The user's words for each kind (singular, plural). `example` is the grey text in the typing box. Round 5 B8: it
 * is never a real record number (people typed the example and got another order's box): it says what to type.
 */
export const PICK_WORDS: Record<PickKind, { one: string; many: string; label: string; example: string }> = {
  lot: { one: "lot", many: "lots", label: "lot label", example: "e.g. the last 4 numbers on the label" },
  container: { one: "box", many: "boxes", label: "box label", example: "e.g. the last 4 numbers on the box label" },
  location: { one: "shelf", many: "shelves", label: "shelf label", example: "e.g. the code on the shelf" },
  batch: { one: "batch", many: "batches", label: "batch sheet", example: "e.g. the batch number on the sheet" },
  item: { one: "item", many: "items", label: "item label", example: "e.g. the code on the label" },
  equipment: { one: "machine", many: "machines", label: "machine label", example: "e.g. the number on the machine" },
};

const TYPE_WORDS: Record<ScanType, string> = { LOT: "a lot label", BOX: "a box label", LOC: "a shelf label", MAT: "a material label", SKU: "a product label", EQP: "a machine label", DOC: "a document" };

/** Plain error shown when nothing matched. */
export function notFoundMessage(kind: PickKind, hasCandidates: boolean): string {
  const w = PICK_WORDS[kind];
  return hasCandidates ? `We couldn't find that. Tap one of the ${w.many} above or scan the ${w.label} again.` : `We couldn't find that. Scan the ${w.label} again, or find it by name.`;
}

/** Plain error for a label of another kind. */
export function wrongKindMessage(kind: PickKind, scanned: ScanType): string {
  return `That is ${TYPE_WORDS[scanned]}. Scan the ${PICK_WORDS[kind].label}.`;
}

/** Message when the form is sent without a choice. */
export function missingMessage(kind: PickKind, hasCandidates: boolean): string {
  const w = PICK_WORDS[kind];
  return hasCandidates ? `Tap one of the ${w.many} above, or scan the ${w.label}.` : `Scan the ${w.label}, or find it by name.`;
}

export type PickInput =
  | { kind: "empty" }
  /** Matches a candidate (tap-equivalent). */
  | { kind: "candidate"; candidate: PickCandidate }
  /** A label payload or record number to resolve on the server. `payload` is normalised. */
  | { kind: "label"; payload: string; value: string }
  /** Free words: search by name. */
  | { kind: "words"; text: string }
  /** Refused with a message (wrong label kind, web link, junk such as a placeholder). */
  | { kind: "refused"; message: string };

const ELLIPSIS = /…|\.\.\./;

/**
 * Classifies scanned or typed text for a field of `kind`.
 * - `fromScanner`: the text came from the camera or a hardware burst (never words).
 */
export function classifyPickInput(kind: PickKind, raw: string, candidates: readonly PickCandidate[] = [], fromScanner = false, alsoAccept: readonly PickKind[] = []): PickInput {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (!text) return { kind: "empty" };
  // A placeholder like "BC:LOT:…" or "e.g. PKG-01" is never a value.
  if (ELLIPSIS.test(text) || /^e\.?g\.?\s/i.test(text)) return { kind: "refused", message: notFoundMessage(kind, candidates.length > 0) };
  const p = parseScan(text);
  if (p.kind === "typed") {
    if (![kind, ...alsoAccept].some((k) => PICK_PAYLOAD_TYPES[k].includes(p.type))) return { kind: "refused", message: wrongKindMessage(kind, p.type) };
    const hit = matchCandidate(candidates, p.value);
    return hit ? { kind: "candidate", candidate: hit } : { kind: "label", payload: p.payload, value: p.value };
  }
  if (p.kind === "untyped") {
    const hit = matchCandidate(candidates, p.value);
    if (hit) return { kind: "candidate", candidate: hit };
    // A single word may be a record number or a name ("coconut"); the scanner always means a number.
    return fromScanner || /\d/.test(p.value) ? { kind: "label", payload: p.value, value: p.value } : { kind: "words", text };
  }
  if (p.reason === "url" || p.reason === "too_long") return { kind: "refused", message: "That is not a Bryel's Care label. Scan the label on the container." };
  if (fromScanner || normalizeScanInput(text).startsWith("BC:")) return { kind: "refused", message: notFoundMessage(kind, candidates.length > 0) };
  return { kind: "words", text };
}

/** Candidate whose value or one of its label codes equals `value` (any case, with or without dashes). */
export function matchCandidate(candidates: readonly PickCandidate[], value: string): PickCandidate | null {
  const v = normalizeScanInput(value);
  if (!v) return null;
  const k = codeKey(v);
  const same = (x: string | undefined) => !!x && (x.toUpperCase() === v || (!!k && codeKey(x) === k));
  return candidates.find((c) => !c.disabledReason && (c.value.toUpperCase() === v || same(c.code) || (c.codes ?? []).some(same))) ?? null;
}

/**
 * The comparable form of a code: upper case, letters and digits only, without a `BC:<TYPE>:` prefix.
 * "bx-0000 0005", "BX00000005" and "BC:BOX:BX-00000005" all give "BX00000005".
 */
export function codeKey(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .trim()
    .replace(/^BC:[A-Z]{3}:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Typed text as a code: control characters and spaces out, upper case ("bx 00000005" → "BX00000005"). */
export function cleanTyped(raw: string): string {
  return normalizeScanInput(raw).replace(/\s+/g, "");
}

/** Fewest characters accepted as "the last characters" of a code. */
export const MIN_TYPED_SUFFIX = 3;

export type TypedMatch = { kind: "one"; candidate: PickCandidate } | { kind: "many"; candidates: PickCandidate[] } | { kind: "none" };

/**
 * A code typed by a person against the EXPECTED candidates (owner decision 2026-11-08): the whole code (any case,
 * with or without dashes, with or without the `BC:` prefix) or, when only one candidate ends with them, its last
 * characters (at least 3: "0005" for BX-00000005, "0016" for L-2611-00016). Only `code` / `codes` are compared
 * (never the record id). Two candidates ending the same way → "many" (type more).
 */
export function matchTypedCode(candidates: readonly PickCandidate[], raw: string, minSuffix = MIN_TYPED_SUFFIX): TypedMatch {
  const k = codeKey(raw);
  if (!k) return { kind: "none" };
  const live = candidates.filter((c) => !c.disabledReason);
  const keys = (c: PickCandidate) => [c.code, ...(c.codes ?? [])].filter((x): x is string => !!x).map(codeKey);
  const exact = live.filter((c) => keys(c).includes(k) || codeKey(c.value) === k);
  if (exact.length === 1) return { kind: "one", candidate: exact[0] };
  if (exact.length > 1) return { kind: "many", candidates: exact };
  if (k.length < minSuffix) return { kind: "none" };
  const tail = live.filter((c) => keys(c).some((x) => x.endsWith(k)));
  if (tail.length === 1) return { kind: "one", candidate: tail[0] };
  return tail.length > 1 ? { kind: "many", candidates: tail } : { kind: "none" };
}

/** Plain refusal for a typed code that is not one of the expected ones. */
export function notListedMessage(kind: PickKind): string {
  return `That number is not on this list. Check the ${PICK_WORDS[kind].label} and type it again.`;
}

/** Plain message when the typed text is words but a number is needed (verification fields). */
export function typeNumberMessage(kind: PickKind): string {
  const w = PICK_WORDS[kind];
  return `Type the number printed on the ${w.label} (all of it or the last 4).`;
}

/** Plain message when two expected codes end with what was typed. */
export function ambiguousTypedMessage(typed: string): string {
  return `More than one ends in ${cleanTyped(typed)}. Type more of the number.`;
}

/** Candidates whose title, detail or codes contain every typed word (≥ 2 letters), any case. */
export function filterCandidates(candidates: readonly PickCandidate[], text: string): PickCandidate[] {
  const ws = text
    .toLowerCase()
    .split(/[\s,;/]+/)
    .filter((w) => w.length >= 2);
  if (!ws.length) return [];
  return candidates.filter((c) => {
    if (c.disabledReason) return false;
    const hay = [c.title, c.detail ?? "", c.code ?? "", ...(c.codes ?? [])].join(" ").toLowerCase();
    return ws.every((w) => hay.includes(w));
  });
}

/** The value a form submits for a candidate. */
export function submitValue(c: PickCandidate, submit: "value" | "code"): string {
  return submit === "code" ? (c.code ?? c.codes?.[0] ?? c.value) : c.value;
}

export type Burst = { chars: string; times: number[] };

/**
 * Hardware (keyboard-wedge) scanners type a whole label in a few milliseconds per key and end with
 * Enter or Tab. True when the collected keys look like that (at least 4 keys, every gap < `maxGapMs`).
 */
export function isScannerBurst(b: Burst, maxGapMs = 50): boolean {
  if (b.chars.length < 4 || b.times.length !== b.chars.length) return false;
  for (let i = 1; i < b.times.length; i++) if (b.times[i] - b.times[i - 1] > maxGapMs) return false;
  return true;
}
