"use client";
import { useState } from "react";
import { Field, Input } from "./core";

/** "Warehouse label desk" → "WAREHOUSE-LABEL-DESK" (capitals, digits and dashes; at most `max` characters). */
export function codeFromName(name: string, prefix = "", max = 40): string {
  const body = name
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}${body}`.slice(0, max).replace(/-+$/g, "");
}

/**
 * ADR-088 "never type a code": the person types a name; the technical code is made from it and sits in a
 * folded "Technical name" box (editable only there, read-only once saved). Server validation still decides.
 */
export function NameAndCode({
  idPrefix = "",
  nameLabel = "Name",
  defaultName = "",
  defaultCode,
  codeReadOnly = false,
  prefix = "",
  max = 40,
  nameError,
  codeError,
  placeholder,
  lowercase = false,
}: {
  idPrefix?: string;
  nameLabel?: string;
  defaultName?: string;
  defaultCode?: string;
  codeReadOnly?: boolean;
  prefix?: string;
  max?: number;
  nameError?: string;
  codeError?: string;
  placeholder?: string;
  lowercase?: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState<string | null>(defaultCode ?? null);
  const auto = codeFromName(name, prefix, max);
  const shown = code ?? (lowercase ? auto.toLowerCase().replace(/-/g, "_") : auto);
  return (
    <>
      <Field label={nameLabel} htmlFor={`${idPrefix}name`} error={nameError}>
        <Input id={`${idPrefix}name`} name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
      </Field>
      <details className="rounded-[12px] border border-line px-3 sm:col-span-2" open={!!codeError}>
        <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] text-fg-2">Technical name: {shown || "made from the name"}</summary>
        <div className="pb-3">
          <Field label="Technical name (made for you)" htmlFor={`${idPrefix}code`} error={codeError} hint={codeReadOnly ? "Cannot change after saving." : "Change it only if the IT person asks."}>
            <Input id={`${idPrefix}code`} name="code" required value={shown} readOnly={codeReadOnly} onChange={(e) => setCode(e.target.value)} className="font-mono" />
          </Field>
        </div>
      </details>
    </>
  );
}
