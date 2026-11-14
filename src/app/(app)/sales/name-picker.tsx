"use client";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Search } from "lucide-react";
import { Button, Input } from "@/ui/core";

export type PickOption = { value: string; label: string; /** extra words that also match (code, city, phone); never shown first */ also?: string; /** a second line under the name (address, stock) */ detail?: string };

/** Lower-case words of a search ("acap soap" → ["acap", "soap"]). */
export function searchWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Options whose name (or extra words) contain every typed word; the chosen one always stays in the list. */
export function filterOptions(options: PickOption[], q: string, keep?: string): PickOption[] {
  const words = searchWords(q);
  if (!words.length) return options;
  return options.filter((o) => o.value === keep || words.every((w) => `${o.label} ${o.also ?? ""}`.toLowerCase().includes(w)));
}

/** How many rows show at once; more are reached by typing (re-audit B #6: short lists, big rows). */
export const VISIBLE_ROWS = 6;

/**
 * Pick a customer or a product by name: ONE control (ADR-088; re-audit B #6 replaced the search box + dropdown).
 * Type a few letters of the name and tap the row. Rows are big (≥ 48 px), the list shortens as you type, at
 * most six show at once, and Enter picks the only match. Once chosen, the name shows with "Change". The chosen
 * value is still the record id the server checks (hidden input `name`); `id` is the typing box, so a
 * `<Field htmlFor={id}>` label points at it. Keyboard: Tab to a row, Enter or Space picks it.
 */
export function NamePicker({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  searchLabel = "Type part of the name",
  disabled,
  required,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  placeholder: string;
  searchLabel?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const chosen = options.find((o) => o.value === value) ?? null;
  const hits = useMemo(() => filterOptions(options, q), [options, q]);
  const shown = hits.slice(0, VISIBLE_ROWS);
  const editing = !disabled && (open || !chosen);
  const pick = (v: string) => {
    onChange(v);
    setQ("");
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // never submits the form from the typing box
      if (hits.length === 1) pick(hits[0].value);
    }
    if (e.key === "Escape" && chosen) setOpen(false);
  };
  const rowKey = (e: KeyboardEvent<HTMLLIElement>, v: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(v);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={`name-picker-${id}`}>
      {name && <input type="hidden" name={name} value={value} />}
      {/* Lets the browser say "choose one" on submit when nothing is chosen (hidden inputs skip `required`). */}
      {required && !disabled && <input tabIndex={-1} aria-hidden className="sr-only" required value={value} onChange={() => undefined} />}

      {!editing ? (
        <div className="flex min-h-[52px] min-w-0 items-center justify-between gap-3 rounded-[8px] border border-line bg-surface px-4 py-2">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <Check size={16} className="shrink-0 text-[var(--ok-fg)]" aria-hidden />
              <span className="break-words">{chosen?.label ?? placeholder}</span>
            </span>
            {chosen?.detail && <span className="block text-[13px] text-fg-2">{chosen.detail}</span>}
          </span>
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(true);
                setTimeout(() => input.current?.focus(), 0);
              }}
              aria-label={`Change: ${chosen?.label ?? ""}`}
            >
              Change
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              ref={input}
              id={id}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              placeholder={options.length > VISIBLE_ROWS ? searchLabel : placeholder}
              className="pl-10"
              value={q}
              autoComplete="off"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          <ul id={listId} role="listbox" aria-label={placeholder} className="flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface">
            {shown.length === 0 ? (
              <li className="px-4 py-3 text-[15px] text-fg-2" role="presentation">
                Nothing matches “{q}”: try fewer letters.
              </li>
            ) : (
              shown.map((o) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={0}
                  onClick={() => pick(o.value)}
                  onKeyDown={(e) => rowKey(e, o.value)}
                  className="flex min-h-[48px] cursor-pointer flex-col justify-center border-b border-line px-4 py-2 last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                >
                  <span className="text-[16px] font-medium text-fg">{o.label}</span>
                  {o.detail && <span className="text-[13px] text-fg-2">{o.detail}</span>}
                </li>
              ))
            )}
          </ul>
          {hits.length > shown.length && <p className="text-[13px] text-fg-2">{hits.length - shown.length} more: type more letters of the name.</p>}
          {chosen && (
            <button type="button" className="min-h-[44px] self-start text-[14px] text-primary-text underline" onClick={() => { setQ(""); setOpen(false); }}>
              Keep {chosen.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
