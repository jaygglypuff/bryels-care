"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { putAwayAction } from "./actions";

type Bal = { locationId: string; code: string; name: string; kind: string; qtyBase: string };
type Dest = { id: string; code: string; name: string; kind: string };

/** Step 2 of put-away: scan (or type) the destination location; a new key is used for each successful move. */
export function PutAwayForm({ lotNumber, balances, destinations, defaultFrom, uom }: { lotNumber: string; balances: Bal[]; destinations: Dest[]; defaultFrom: string; uom: string }) {
  const [state, dispatch] = useActionState<ActionState, FormData>(async (p, fd) => {
    const r = await putAwayAction(p, fd);
    if (r?.ok) setKey(crypto.randomUUID());
    return r;
  }, null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <form action={dispatch} className="space-y-4">
      <input type="hidden" name="lot" value={lotNumber} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="fromLocationId" error={state?.fieldErrors?.fromLocationId}>
          <Select id="fromLocationId" name="fromLocationId" defaultValue={defaultFrom}>
            {balances.map((b) => (
              <option key={b.locationId} value={b.locationId}>{b.code} · {b.name} ({Number(b.qtyBase).toLocaleString("en-PH")} {uom})</option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity (${uom}, optional)`} htmlFor="qty" error={state?.fieldErrors?.qty} hint="Leave empty to move everything from that location.">
          <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Scan the destination location" htmlFor="location" error={state?.fieldErrors?.location} hint={`Allowed now: ${destinations.map((d) => d.code).join(", ") || "none"}`}>
          <Input id="location" name="location" required autoComplete="off" placeholder="BC:LOC:QUA-01 or QUA-01" autoFocus list="dest-options" />
          <datalist id="dest-options">
            {destinations.map((d) => (
              <option key={d.id} value={d.code}>{d.name}</option>
            ))}
          </datalist>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Moving…" className="w-full sm:w-auto">
        Put away
      </SubmitButton>
    </form>
  );
}
