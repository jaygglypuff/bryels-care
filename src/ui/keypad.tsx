"use client";
import { Check, Delete, Grid3x3, Keyboard } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./core";
import {
  cleanTyped,
  keyFromEvent,
  NUMBER_ENTRY_STORAGE_KEY,
  pressKey,
  resolveNumberEntry,
  type KeyRules,
  type NumberEntryMode,
  type NumberEntryOrg,
} from "./keypad-keys";

/**
 * In-app numeric keypad (docs/ux-system.md component 5.25, UX review B8; ADR-135): 56 px keys, used on the operator
 * screens (Weigh, Step) instead of the phone keyboard, which hides half the screen.
 *
 * ADR-135 (owner 2026-11-13): the field also takes a physical keyboard and keyboard-wedge devices (a USB scale or a
 * scanner that "types" the number and presses Enter): digits, ".", Backspace, Enter = the ✓ action, with the same
 * rules as the keys (`src/ui/keypad-keys.ts`). How numbers are typed is chosen per device ("Use my keyboard" /
 * "Use the big keypad", remembered on the device) over the organisation setting `ui.number_entry` (Automatic: the
 * keypad on touch screens, typing on computers). With the own keyboard the field is a normal input
 * (`inputMode="decimal"` / `"numeric"`) and the keypad is hidden.
 *
 * `decimal` adds the "." key (weights, temperatures); counts get whole numbers only. `letters` adds
 * A–F and a dash for typing the last characters of a lot number.
 */

/* ------------------------------------------------------------------ how numbers are typed on this device */

const OrgEntry = createContext<NumberEntryOrg>("auto");

/** Set once in the app frame from `screenPreferences(ctx).numberEntry` (ADR-126 / ADR-135). */
export function NumberEntryProvider({ value, children }: { value: NumberEntryOrg; children: ReactNode }) {
  return <OrgEntry.Provider value={value}>{children}</OrgEntry.Provider>;
}

const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";
const CHANGED = "bc:number-entry";

/** Fallback when localStorage cannot be used (private mode, storage blocked): the choice lasts until the page is left. */
let memo: NumberEntryMode | null = null;

function readDevice(): NumberEntryMode | null {
  try {
    const v = window.localStorage.getItem(NUMBER_ENTRY_STORAGE_KEY);
    return v === "keypad" || v === "keyboard" ? v : memo;
  } catch {
    return memo;
  }
}
function touchOnly(): boolean {
  try {
    return window.matchMedia(TOUCH_ONLY).matches;
  } catch {
    return true;
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGED, cb);
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia(TOUCH_ONLY);
    mq.addEventListener?.("change", cb);
  } catch {
    mq = null;
  }
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGED, cb);
    mq?.removeEventListener?.("change", cb);
  };
}
/** A string snapshot so React compares it by value: "<device choice>|<touch only>". */
const snapshot = () => `${readDevice() ?? ""}|${touchOnly() ? 1 : 0}`;
/** On the server (and the first paint) Automatic means the keypad: the operator screens are phone-first. */
const serverSnapshot = () => "|1";

/** The mode on this device and the switch between the two. Every field and keypad on the page agrees. */
export function useNumberEntry(): { mode: NumberEntryMode; choose: (m: NumberEntryMode) => void } {
  const org = useContext(OrgEntry);
  const snap = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [device, touch] = snap.split("|");
  const mode = resolveNumberEntry(org, (device || null) as NumberEntryMode | null, touch === "1");
  const choose = (m: NumberEntryMode) => {
    memo = m;
    try {
      window.localStorage.setItem(NUMBER_ENTRY_STORAGE_KEY, m);
    } catch {
      /* not remembered on this device; `memo` keeps it until the page is left */
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return { mode, choose };
}

/** "Use my keyboard" / "Use the big keypad": one plain link-style button, 44 px tall. */
export function NumberEntrySwitch({ className }: { className?: string }) {
  const { mode, choose } = useNumberEntry();
  const next: NumberEntryMode = mode === "keypad" ? "keyboard" : "keypad";
  return (
    <button
      type="button"
      onClick={() => choose(next)}
      className={cx("inline-flex min-h-[44px] items-center gap-2 self-start text-[15px] text-primary-text underline", className)}
      data-testid="number-entry-switch"
      data-mode={mode}
    >
      {next === "keyboard" ? <Keyboard size={18} aria-hidden /> : <Grid3x3 size={18} aria-hidden />}
      {next === "keyboard" ? "Use my keyboard" : "Use the big keypad"}
    </button>
  );
}

/* ------------------------------------------------------------------ the keypad */

export function Keypad({
  value,
  onChange,
  decimal = false,
  letters = false,
  maxLength = 12,
  onSubmit,
  submitLabel = "Save",
  submitDisabled = false,
  pending = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
  letters?: boolean;
  maxLength?: number;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const { mode } = useNumberEntry();
  // Own keyboard chosen: no keypad, only the way back to it.
  if (mode === "keyboard") return <NumberEntrySwitch className={className} />;
  const press = (k: string) => onChange(pressKey(value, k, { decimal, letters, maxLength }));
  const key = (k: string, label: ReactNode = k, extra?: string) => (
    <button
      key={k}
      type="button"
      onClick={() => press(k)}
      className={cx("min-h-[56px] rounded-[14px] border border-line-strong bg-surface text-[22px] font-semibold tabular text-fg active:bg-surface-2", extra)}
      aria-label={k === "back" ? "Delete last" : k === "clear" ? "Clear" : `Key ${k}`}
    >
      {label}
    </button>
  );
  return (
    <div className={cx("grid select-none gap-1", className)}>
      <div data-testid="keypad">
        {letters && (
          <div className="mb-2 grid grid-cols-7 gap-2">
            {["A", "B", "C", "D", "E", "F", "-"].map((k) => key(k, k, "text-[18px]"))}
          </div>
        )}
        <div className="grid grid-cols-4 gap-2">
          {key("7")}
          {key("8")}
          {key("9")}
          {key("back", <Delete size={22} aria-hidden />)}
          {key("4")}
          {key("5")}
          {key("6")}
          {key("clear", "C", "text-[18px]")}
          {key("1")}
          {key("2")}
          {key("3")}
          {onSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitDisabled || pending}
              className="row-span-2 flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-[14px] border border-transparent bg-cta text-[16px] font-semibold text-white disabled:opacity-50"
            >
              <Check size={26} aria-hidden />
              {pending ? "Saving…" : submitLabel}
            </button>
          ) : (
            <span className="row-span-2" />
          )}
          {key("0", "0", decimal ? "col-span-2" : "col-span-3")}
          {decimal && key(".", ".")}
        </div>
      </div>
      <NumberEntrySwitch />
    </div>
  );
}

/* ------------------------------------------------------------------ the field */

/**
 * The field the keypad types into. Always a real input, so a physical keyboard, a USB scale or a scanner can type
 * into it (ADR-135):
 * - big keypad: read-only with `inputMode="none"` (the phone keyboard never opens); keys are handled here with the
 *   keypad's rules;
 * - own keyboard: a normal input (`inputMode="decimal"` or `"numeric"`); whatever is typed or pasted is cleaned to
 *   what the keypad could have typed.
 * Enter is the screen's ✓ action (`onEnter`), never the browser's own form submit.
 */
export function KeypadField({
  id,
  label,
  value,
  onChange,
  unit,
  active,
  onFocus,
  onEnter,
  error,
  hint,
  large = false,
  decimal = false,
  letters = false,
  maxLength = 12,
  autoFocus = false,
  readOnly = false,
}: {
  id: string;
  label: string;
  value: string;
  /** Typing on a keyboard or a scale; without it the field only shows the value. */
  onChange?: (v: string) => void;
  unit?: string | null;
  active: boolean;
  onFocus: () => void;
  /** Enter: the ✓ action of the screen (Save, next field). Gets the input so it can reach its form. */
  onEnter?: (input: HTMLInputElement) => void;
  error?: string | null;
  hint?: ReactNode;
  large?: boolean;
  decimal?: boolean;
  letters?: boolean;
  maxLength?: number;
  /** Put the cursor here (a scale's keystrokes land in it); taken away again when it turns false. */
  autoFocus?: boolean;
  /** Nothing can be typed (the person may not record it). */
  readOnly?: boolean;
}) {
  const { mode } = useNumberEntry();
  const ref = useRef<HTMLInputElement>(null);
  const rules: KeyRules = { decimal, letters, maxLength };
  const canType = !!onChange && !readOnly;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (autoFocus && canType) el.focus({ preventScroll: true });
    else if (!autoFocus && document.activeElement === el) el.blur();
  }, [autoFocus, canType]);
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[15px] font-medium text-fg">
        {label}
      </label>
      <div
        className={cx(
          "flex min-h-[56px] w-full items-center justify-between gap-2 rounded-[14px] border bg-surface px-4 tabular focus-within:border-ring focus-within:ring-2 focus-within:ring-[var(--ring)]",
          large ? "text-[28px] font-semibold" : "text-[22px]",
          active ? "border-ring ring-2 ring-[var(--lime-200)]" : "border-line-strong",
          error ? "border-[var(--bad-bd)]" : "",
        )}
        onClick={() => ref.current?.focus()}
      >
        <input
          ref={ref}
          id={id}
          type="text"
          value={value}
          placeholder="—"
          readOnly={mode === "keypad" || !canType}
          inputMode={mode === "keypad" ? "none" : decimal ? "decimal" : "numeric"}
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize={letters ? "characters" : "off"}
          spellCheck={false}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? hintId : undefined}
          data-testid="keypad-field"
          data-mode={mode}
          onFocus={onFocus}
          onChange={(e) => canType && onChange!(cleanTyped(e.target.value, rules))}
          onKeyDown={(e) => {
            const k = keyFromEvent(e, rules);
            if (k === null) return;
            if (k === "submit") {
              e.preventDefault(); // never the browser's implicit form submit
              onEnter?.(e.currentTarget);
              return;
            }
            // Own keyboard: the input edits itself (cursor, selection, Delete) and onChange cleans it; Escape clears.
            if (mode === "keyboard") {
              if (e.key === "Escape" && canType) {
                e.preventDefault();
                onChange!("");
              }
              return;
            }
            e.preventDefault();
            if (canType) onChange!(pressKey(value, k, rules));
          }}
          className="w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-muted focus-visible:outline-none"
        />
        {unit && <span className="shrink-0 text-[16px] font-normal text-muted">{unit}</span>}
      </div>
      {/* Keypad presses happen on other buttons: say the new value to screen readers. */}
      {mode === "keypad" && (
        <span className="sr-only" aria-live="polite">
          {value ? `${label}: ${value}${unit ? ` ${unit}` : ""}` : ""}
        </span>
      )}
      {hint && !error && (
        <div id={hintId} className="text-[13px] text-muted">
          {hint}
        </div>
      )}
      {error && (
        <p id={hintId} className="text-[13px] text-[var(--bad-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}
