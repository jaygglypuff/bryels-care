"use client";
import { forwardRef, useState } from "react";
import { baseOfUnit, fmtFriendly, parseQtyText, toBaseQty, unitChoices } from "@/lib/units";
import { Input, Select } from "./core";

const ANY_UNITS = ["kg", "g", "L", "mL", "pcs"];

/**
 * Amount + unit for warehouse screens (usability test 2026-10-30). The unit picker offers kg/g, L/mL
 * or pcs for the item's base unit, friendly unit first ("*" = item not known yet: every unit); "20 kg"
 * typed in the box also works. Below the box it repeats what will be saved ("= 20 kg"), so a slip like
 * 50 g instead of 50 kg is visible. The form sends `name` (the text as typed) and `unitName` (the
 * picker); the SERVER converts to the base unit with decimal.js and refuses unknown units. Works
 * controlled (qty/unit + onChange) or uncontrolled.
 */
export const QtyUnitInput = forwardRef<
  HTMLInputElement,
  {
    id: string;
    baseUom: string;
    name?: string;
    unitName?: string;
    qty?: string;
    onQtyChange?: (v: string) => void;
    unit?: string;
    onUnitChange?: (u: string) => void;
    defaultQty?: string;
    defaultUnit?: string;
    required?: boolean;
    big?: boolean;
    unitLabel?: string;
  }
>(function QtyUnitInput({ id, baseUom, name, unitName, qty, onQtyChange, unit, onUnitChange, defaultQty, defaultUnit, required, big, unitLabel = "Unit" }, ref) {
  const choices = baseUom === "*" ? ANY_UNITS : unitChoices(baseUom);
  const [q, setQ] = useState(defaultQty ?? "");
  const [u, setU] = useState(defaultUnit ?? "");
  const curQ = qty ?? q;
  const wanted = unit ?? u;
  const curU = choices.includes(wanted) ? wanted : choices[0];
  const base = baseUom === "*" ? (baseOfUnit(parseQtyText(curQ)?.unit ?? curU) ?? curU) : baseUom;
  const r = curQ.trim() ? toBaseQty(curQ, curU, base) : null;
  return (
    <div className="min-w-0">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_96px] items-center gap-2">
        <Input
          ref={ref}
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          required={required}
          value={curQ}
          onChange={(e) => (onQtyChange ? onQtyChange(e.target.value) : setQ(e.target.value))}
          className={big ? "min-h-[52px] text-[18px] tabular" : "tabular"}
          aria-describedby={`${id}-echo`}
        />
        <Select
          id={`${id}-unit`}
          name={unitName}
          aria-label={unitLabel}
          value={curU}
          onChange={(e) => (onUnitChange ? onUnitChange(e.target.value) : setU(e.target.value))}
          className={big ? "min-h-[52px] text-[16px]" : undefined}
        >
          {choices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </div>
      <p id={`${id}-echo`} className="mt-1 min-h-[18px] text-[13px] text-muted" aria-live="polite">
        {r ? (
          r.ok ? (
            <>
              = <strong className="text-fg">{fmtFriendly(r.qtyBase, base)}</strong>
            </>
          ) : (
            <span className="text-[var(--bad-fg)]">{r.message}</span>
          )
        ) : choices.length > 1 ? (
          `Type a number, or for example 20 ${choices[0]}.`
        ) : null}
      </p>
    </div>
  );
});
