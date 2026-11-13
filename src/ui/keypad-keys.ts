/**
 * Number entry rules shared by the in-app keypad, a physical keyboard and keyboard-wedge devices (USB scales,
 * barcode scanners that "type" a number and press Enter). ADR-135. Pure functions: no React, no DOM, no floating
 * point — values stay strings; screens turn them into decimal.js on submit as before.
 */

export type KeyRules = {
  /** Allow one "." (weights, temperatures). Counts are whole numbers. */
  decimal?: boolean;
  /** Allow A–F and "-" (the last characters of a lot number). */
  letters?: boolean;
  /** Longest value accepted (default 12). */
  maxLength?: number;
};

/** One press: a character, Backspace ("back"), clear ("clear") or the field's ✓ action ("submit"). */
export type KeyPress = "back" | "clear" | "submit" | string;

const LETTERS = new Set(["A", "B", "C", "D", "E", "F", "-"]);

/**
 * The keypad rule for one press (moved unchanged from `Keypad`): a character is ignored when the value is full,
 * a second "." or a "." in a whole-number field is ignored, and a leading zero is replaced in numbers
 * ("0" then "5" = "5"), never in lot characters ("0005").
 */
export function pressKey(value: string, k: KeyPress, rules: KeyRules = {}): string {
  const { decimal = false, letters = false, maxLength = 12 } = rules;
  if (k === "back") return value.slice(0, -1);
  if (k === "clear") return "";
  if (k === "submit") return value;
  if (value.length >= maxLength) return value;
  if (k === ".") {
    if (!decimal || value.includes(".")) return value;
  } else if (!/^\d$/.test(k) && !(letters && LETTERS.has(k))) {
    return value;
  }
  return !letters && value === "0" && k !== "." ? k : value + k;
}

/**
 * Turns a keyboard event into a press, or null when the key is not ours (Tab, arrows, shortcuts with Ctrl/⌘/Alt):
 * the browser then does its usual thing. Digits (top row and number pad send the same `key`), "." and "," (some
 * scales and number pads send a comma), Backspace, Delete or Escape = clear, Enter = the ✓ action. Letters A–F and
 * "-" only in a lot field, typed in either case.
 */
export function keyFromEvent(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, rules: KeyRules = {}): KeyPress | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key;
  if (k === "Enter") return "submit";
  if (k === "Backspace") return "back";
  if (k === "Delete" || k === "Escape") return "clear";
  if (/^\d$/.test(k)) return k;
  if (k === "." || k === "," || k === "Decimal") return rules.decimal ? "." : null;
  if (rules.letters && k.length === 1 && LETTERS.has(k.toUpperCase())) return k.toUpperCase();
  return null;
}

/**
 * Cleans what the phone's or computer's own keyboard put in the box (also a paste or a scale's burst such as
 * " 12.50 kg"): keeps only what the keypad could have typed, in order, through the same `pressKey` rule. So "12,5"
 * becomes "12.5" in a decimal field, "1.2.3" becomes "1.23", letters are dropped from a number, and the length is cut
 * at `maxLength`.
 */
export function cleanTyped(raw: string, rules: KeyRules = {}): string {
  let out = "";
  for (const ch of raw) {
    const k = keyFromEvent({ key: ch }, rules);
    if (k === null || k === "submit" || k === "back" || k === "clear") continue;
    out = pressKey(out, k, rules);
  }
  return out;
}

/** How numbers are typed on this device (ADR-135). */
export type NumberEntryMode = "keypad" | "keyboard";
/** Organisation setting `ui.number_entry`. */
export type NumberEntryOrg = "keypad" | "keyboard" | "auto";

/**
 * The person's own choice on this device wins; otherwise the organisation setting; "auto" = the big keypad on
 * touch screens (no mouse or trackpad), typing on computers.
 */
export function resolveNumberEntry(org: NumberEntryOrg, device: NumberEntryMode | null, touchOnly: boolean): NumberEntryMode {
  if (device) return device;
  if (org === "auto") return touchOnly ? "keypad" : "keyboard";
  return org;
}

/** localStorage key of the per-device choice ("keypad" | "keyboard"). */
export const NUMBER_ENTRY_STORAGE_KEY = "bc.numberEntry";
