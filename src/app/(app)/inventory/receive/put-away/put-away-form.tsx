"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { putAwayAction } from "./actions";

type Bal = { locationId: string; code: string; name: string; qtyText: string; looseQtyText: string; boxed: boolean };
type Dest = { id: string; code: string; name: string; kind: string; sectionLabel?: string; suggested?: boolean };

/** Units offered for the quantity: the friendly unit first (kg for gram lots, L for millilitre lots). */
const UNITS: Record<string, string[]> = { g: ["kg", "g"], mL: ["L", "mL"] };
const MAX_CHIPS = 8;

/**
 * Step 2 of put-away: where from, how much (empty = everything loose there), and the shelf. The shelf
 * is prefilled with the suggestion; the user confirms, taps another shelf chip, or scans a location
 * label into the field. A new key is used for each submission; the server action redirects on success.
 */
export function PutAwayForm({
  lotNumber,
  balances,
  destinations,
  defaultFrom,
  defaultTo,
  uom,
  fromTask,
}: {
  lotNumber: string;
  balances: Bal[];
  destinations: Dest[];
  defaultFrom: string;
  defaultTo: string;
  uom: string;
  fromTask: boolean;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [state, dispatch] = useActionState<ActionState, FormData>(putAwayAction, null);
  const [to, setTo] = useState(defaultTo);
  const units = UNITS[uom] ?? [uom];
  // Tap targets: shelves (storage) first, the item's own section first; other allowed places stay reachable by scan or typing.
  const shelves = destinations.filter((d) => d.kind === "storage");
  const chips = (shelves.length ? [...shelves.filter((d) => d.suggested), ...shelves.filter((d) => !d.suggested)] : destinations).slice(0, MAX_CHIPS);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="lot" value={lotNumber} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="fromLocationId" error={fe.fromLocationId}>
          <Select id="fromLocationId" name="fromLocationId" defaultValue={defaultFrom}>
            {balances.map((b) => (
              <option key={b.locationId} value={b.locationId}>
                {b.code} · {b.name} ({b.boxed ? `${b.looseQtyText} not in a box, of ${b.qtyText}` : b.qtyText})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="How much? (optional)" htmlFor="qty" error={fe.qty} hint="Leave empty to move everything from there.">
            <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" />
          </Field>
          {units.length > 1 ? (
            <div className="pb-[22px]">
              <label htmlFor="qtyUom" className="sr-only">
                Unit
              </label>
              <Select id="qtyUom" name="qtyUom" defaultValue={units[0]} className="min-w-[72px]">
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <>
              <input type="hidden" name="qtyUom" value={uom} />
              <span className="pb-[34px] text-[14px] text-muted">{uom}</span>
            </>
          )}
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[14px] font-semibold">{fromTask && defaultTo ? `Put it on ${defaultTo}, or tap another place` : "Where does it go?"}</legend>
        <div className="flex flex-wrap gap-2" data-testid="putaway-destinations">
          {chips.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTo(d.code)}
              aria-pressed={to === d.code}
              className={cx(
                "min-h-[44px] rounded-full border px-4 text-[14px] font-medium",
                to === d.code ? "border-primary bg-primary text-white" : "border-line bg-surface text-fg hover:border-primary",
              )}
            >
              {d.code}
              <span className={cx("ml-1 text-[12px] font-normal", to === d.code ? "text-white/85" : "text-muted")}>{d.sectionLabel ?? d.kind}</span>
            </button>
          ))}
        </div>
        <Field label="Or scan the shelf label" htmlFor="location" error={fe.location} hint={`Allowed now: ${destinations.map((d) => d.code).join(", ") || "none"}`}>
          <Input id="location" name="location" required autoComplete="off" placeholder="BC:LOC:A-01 or A-01" value={to} onChange={(e) => setTo(e.target.value)} list="dest-options" />
          <datalist id="dest-options">
            {destinations.map((d) => (
              <option key={d.id} value={d.code}>
                {d.name}
                {d.sectionLabel ? ` · ${d.sectionLabel}` : ""}
              </option>
            ))}
          </datalist>
        </Field>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Moving…" className="w-full sm:w-auto" disabled={!to.trim()}>
        {to.trim() ? `Put away to ${to.trim().toUpperCase().replace(/^BC:LOC:/, "")}` : "Put away"}
      </SubmitButton>
    </form>
  );
}
