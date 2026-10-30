"use client";
import { Check, Delete } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./core";

/**
 * In-app numeric keypad (docs/ux-system.md component 5.25, UX review B8): 56 px keys, used on the
 * operator screens (Weigh, Step) instead of the iPad keyboard, which hides half the screen. The
 * fields it types into are read-only text inputs (`inputMode="none"`), so the native keyboard never
 * opens. The ✓ key is the screen's primary action (Save, Step done), next to the digits.
 *
 * `decimal` adds the "." key (weights, temperatures); counts get whole numbers only. `letters` adds
 * A–F and a dash for typing the last characters of a lot number.
 */
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
  const press = (k: string) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "clear") return onChange("");
    if (value.length >= maxLength) return;
    if (k === "." && (!decimal || value.includes("."))) return;
    // A leading zero is replaced in numbers ("0" then "5" = "5"), never in lot characters ("0005").
    onChange(!letters && value === "0" && k !== "." ? k : value + k);
  };
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
    <div className={cx("select-none", className)} data-testid="keypad">
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
  );
}

/** A read-only display field the keypad types into (never opens the native keyboard). */
export function KeypadField({
  id,
  label,
  value,
  unit,
  active,
  onFocus,
  error,
  hint,
  large = false,
}: {
  id: string;
  label: string;
  value: string;
  unit?: string | null;
  active: boolean;
  onFocus: () => void;
  error?: string | null;
  hint?: ReactNode;
  large?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[15px] font-medium text-fg">
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={onFocus}
        aria-pressed={active}
        className={cx(
          "flex min-h-[56px] w-full items-center justify-between rounded-[14px] border bg-surface px-4 text-left tabular",
          large ? "text-[28px] font-semibold" : "text-[22px]",
          active ? "border-ring ring-2 ring-[var(--lime-200)]" : "border-line-strong",
          error ? "border-[var(--bad-bd)]" : "",
        )}
      >
        <span className={value ? "text-fg" : "text-muted"}>{value || "—"}</span>
        {unit && <span className="text-[16px] text-muted">{unit}</span>}
      </button>
      {hint && !error && <div className="text-[13px] text-muted">{hint}</div>}
      {error && <p className="text-[13px] text-[var(--bad-fg)]">{error}</p>}
    </div>
  );
}
