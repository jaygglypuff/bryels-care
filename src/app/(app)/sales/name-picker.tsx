"use client";
import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/ui/core";

export type PickOption = { value: string; label: string; /** extra words that also match (code, city, phone); never shown first */ also?: string };

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

/**
 * Pick a customer or a product by name (ADR-088: nobody types a code). A search box above a normal list:
 * typing a few letters of the name shortens the list, and when only one matches it is chosen. The list is a
 * native <select> (phones show their own big picker; keyboard and screen readers work as usual), so the
 * chosen value is still the record id the server checks.
 */
export function NamePicker({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  searchLabel = "Search by name",
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
  const searchId = useId();
  const shown = useMemo(() => filterOptions(options, q, value), [options, q, value]);
  const many = options.length > 6 && !disabled;
  return (
    <div className="flex flex-col gap-2">
      {many && (
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            id={searchId}
            type="search"
            aria-label={searchLabel}
            aria-controls={id}
            placeholder={searchLabel}
            className="pl-10"
            value={q}
            autoComplete="off"
            onChange={(e) => {
              const next = e.target.value;
              setQ(next);
              const hits = filterOptions(options, next);
              if (searchWords(next).length && hits.length === 1 && hits[0].value !== value) onChange(hits[0].value);
            }}
          />
        </div>
      )}
      <Select id={id} name={name} value={value} disabled={disabled} required={required} onChange={(e) => onChange(e.target.value)}>
        <option value="">{shown.length === 0 ? "Nothing matches: try fewer letters" : placeholder}</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
