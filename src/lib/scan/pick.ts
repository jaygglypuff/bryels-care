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

export const PICK_KINDS = ["lot", "container", "location", "batch", "item"] as const;
export type PickKind = (typeof PICK_KINDS)[number];

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

/** Label payload types that identify each kind. Batches are numbered records without a typed label. */
export const PICK_PAYLOAD_TYPES: Record<PickKind, ScanType[]> = {
  lot: ["LOT"],
  container: ["BOX"],
  location: ["LOC"],
  batch: [],
  item: ["MAT", "SKU"],
};

/** The user's words for each kind (singular, plural). */
export const PICK_WORDS: Record<PickKind, { one: string; many: string; label: string }> = {
  lot: { one: "lot", many: "lots", label: "lot label" },
  container: { one: "box", many: "boxes", label: "box label" },
  location: { one: "shelf", many: "shelves", label: "shelf label" },
  batch: { one: "batch", many: "batches", label: "batch sheet" },
  item: { one: "item", many: "items", label: "item label" },
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

/** Candidate whose value or one of its label codes equals `value` (case-insensitive). */
export function matchCandidate(candidates: readonly PickCandidate[], value: string): PickCandidate | null {
  const v = normalizeScanInput(value);
  if (!v) return null;
  return candidates.find((c) => !c.disabledReason && (c.value.toUpperCase() === v || (c.code ?? "").toUpperCase() === v || (c.codes ?? []).some((x) => x.toUpperCase() === v))) ?? null;
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
