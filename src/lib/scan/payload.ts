/**
 * Scan payload grammar (ADR-017, docs/data-model.md §9.5, docs/reports-and-templates.md §8.1).
 *
 * Shared by the server (scan resolution, label rendering) and the client (scanner component), so
 * it must stay free of Node and browser APIs.
 *
 *   payload := "BC:" TYPE ":" VALUE
 *   TYPE    := LOT | BOX | LOC | MAT | SKU | EQP | DOC
 *   VALUE   := [A-Z0-9][A-Z0-9._-]{0,63}
 *
 * A payload is never a URL and never carries quantity, status or dates. Manual entry may omit the
 * `BC:<TYPE>:` prefix ("untyped"): the value grammar still applies, and the server searches the
 * numbered records the user may see.
 */

export const SCAN_TYPES = ["LOT", "BOX", "LOC", "MAT", "SKU", "EQP", "DOC"] as const;
export type ScanType = (typeof SCAN_TYPES)[number];

/** Grammar of a value (and of every code that can end up in a payload). */
export const SCAN_VALUE_RE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
/** Full typed payload grammar (docs/testing.md §2.2). */
export const SCAN_PAYLOAD_RE = /^BC:(LOT|BOX|LOC|MAT|SKU|EQP|DOC):[A-Z0-9][A-Z0-9._-]{0,63}$/;

/** What each type resolves to, in the user's words (scan result card caption). */
export const SCAN_TYPE_LABEL: Record<ScanType, string> = {
  LOT: "Lot",
  BOX: "Box",
  LOC: "Location",
  MAT: "Material",
  SKU: "SKU",
  EQP: "Equipment",
  DOC: "Document",
};

export type ParsedScan =
  | { kind: "typed"; type: ScanType; value: string; payload: string }
  | { kind: "untyped"; value: string }
  | { kind: "invalid"; reason: "empty" | "url" | "grammar" | "too_long"; input: string };

/** Longest raw input we look at; anything longer is not a label. */
export const MAX_RAW_LENGTH = 200;

/**
 * Removes control characters a keyboard-wedge scanner may add (CR, LF, TAB, GS/FNC1, …), trims
 * and upper-cases. Upper-casing is safe because the grammar is uppercase-only, and it lets a
 * person type a lot number on a phone keyboard.
 */
export function normalizeScanInput(raw: string): string {
  return String(raw ?? "")
    .slice(0, MAX_RAW_LENGTH * 2)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .toUpperCase();
}

const URL_LIKE = /^[A-Z][A-Z0-9+.-]*:\/\/|^WWW\.|\/\//;

/** Parses scanned or typed text. Pure; never throws. */
export function parseScan(raw: string): ParsedScan {
  const input = normalizeScanInput(raw);
  if (!input) return { kind: "invalid", reason: "empty", input };
  if (input.length > MAX_RAW_LENGTH) return { kind: "invalid", reason: "too_long", input: input.slice(0, 40) };
  if (URL_LIKE.test(input)) return { kind: "invalid", reason: "url", input };
  if (input.startsWith("BC:")) {
    if (!SCAN_PAYLOAD_RE.test(input)) return { kind: "invalid", reason: input.includes("//") ? "url" : "grammar", input };
    const [, type, ...rest] = input.split(":");
    return { kind: "typed", type: type as ScanType, value: rest.join(":"), payload: input };
  }
  if (!SCAN_VALUE_RE.test(input)) return { kind: "invalid", reason: "grammar", input };
  return { kind: "untyped", value: input };
}

/** True when `value` can be encoded in a payload (used by label rendering and code validation). */
export function isValidScanValue(value: string): boolean {
  return SCAN_VALUE_RE.test(value);
}

/** Builds a payload; throws when the value would break the grammar (a label must never encode junk). */
export function buildPayload(type: ScanType, value: string): string {
  if (!SCAN_TYPES.includes(type)) throw new Error(`Unknown scan type ${type}`);
  if (!SCAN_VALUE_RE.test(value)) throw new Error(`"${value}" cannot be encoded in a ${type} label: use only A-Z, 0-9, dot, underscore and hyphen (max 64).`);
  return `BC:${type}:${value}`;
}

/** Plain-language message for an invalid scan (scanner N state). */
export function invalidScanMessage(p: Extract<ParsedScan, { kind: "invalid" }>): string {
  switch (p.reason) {
    case "empty":
      return "Scan a label or type a number first.";
    case "url":
      return "Not recognised: this code is a web link, not a Bryel's Care label. Do not open it; scan the label on the container.";
    case "too_long":
      return "Not recognised: this code is too long to be a Bryel's Care label.";
    default:
      return "Not recognised. Bryel's Care labels start with BC: (for example BC:LOT:L-2610-00042), or type a lot, batch, order or document number.";
  }
}
