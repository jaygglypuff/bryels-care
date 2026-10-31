"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { putAwayAction } from "./actions";

type Bal = { locationId: string; code: string; name: string; qtyText: string; looseQtyText: string; boxed: boolean };
type Dest = { id: string; code: string; name: string; kind: string; sectionLabel?: string; suggested?: boolean };

/** Units offered for the quantity: the friendly unit first (kg for gram lots, L for millilitre lots). */
const UNITS: Record<string, string[]> = { g: ["kg", "g"], mL: ["L", "mL"] };

/**
 * Step 2 of put-away: where from (only the places holding the lot; one → chosen), how much (empty =
 * everything loose there), and the shelf. The suggested shelf is chosen already; the user confirms,
 * taps another shelf, or scans a shelf label (ScanOrPick: never a typed code). A new key per
 * submission; the server action redirects on success.
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
  /** Location id of the suggested shelf. */
  defaultTo: string;
  uom: string;
  fromTask: boolean;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [state, dispatch] = useActionState<ActionState, FormData>(putAwayAction, null);
  const [to, setTo] = useState<PickCandidate | null>(() => {
    const d = destinations.find((x) => x.id === defaultTo);
    return d ? { value: d.id, title: d.name, code: d.code } : null;
  });
  const units = UNITS[uom] ?? [uom];
  // Shelves (storage) first, the item's own section first; other allowed places follow.
  const shelves = destinations.filter((d) => d.kind === "storage");
  const ordered = [...shelves.filter((d) => d.suggested), ...shelves.filter((d) => !d.suggested), ...destinations.filter((d) => d.kind !== "storage")];
  const destCands: PickCandidate[] = ordered.map((d) => ({ value: d.id, title: d.name, detail: `${d.code}${d.sectionLabel ? ` · ${d.sectionLabel}` : ""}${d.suggested ? " · suggested" : ""}`, code: d.code, codes: [d.code] }));
  const fromCands: PickCandidate[] = balances.map((b) => ({ value: b.locationId, title: b.name, detail: `${b.code} · ${b.boxed ? `${b.looseQtyText} not in a box, of ${b.qtyText}` : b.qtyText}`, code: b.code, codes: [b.code] }));
  const fe = state?.fieldErrors ?? {};
  const toCode = to?.code ?? "";
  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="lot" value={lotNumber} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <ScanOrPick kind="location" name="fromLocationId" label="Take it from which place?" candidates={fromCands} defaultValue={defaultFrom} hideWhenSingle required onlyCandidates search={false} error={fe.fromLocationId} />
      <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:max-w-sm">
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
      <ScanOrPick
        kind="location"
        name="location"
        id="putaway-dest"
        label={fromTask && toCode ? `Put it on ${toCode}, or tap another place` : "Where does it go?"}
        candidates={destCands}
        candidatesLabel="Places it may go now"
        defaultValue={defaultTo}
        onChange={(_v, c) => setTo(c)}
        required
        onlyCandidates
        maxShown={8}
        error={fe.location}
      />
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Moving…" className="w-full sm:w-auto" disabled={!to}>
        {to ? `Put away to ${toCode}` : "Put away"}
      </SubmitButton>
    </form>
  );
}
