"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { fmtLotQty } from "@/ui/inventory/bits";
import { useActionForm } from "../../_kit/forms";
import { reserveAction } from "./actions";

/** Set stock aside for a demand: two fields (how much, for what); how long is under More details (setting default). */
export function ReserveForm({ lotId, locationId, available, uom, ttlDefault, idempotencyKey }: { lotId: string; locationId: string; available: string; uom: string; ttlDefault: number; idempotencyKey: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(reserveAction);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Set aside
      </Button>
    );
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
      <input type="hidden" name="lotId" value={lotId} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label={`How much? (${uom}, up to ${fmtLotQty(available, uom)})`} htmlFor={`q-${lotId}-${locationId}`} error={fe.qty}>
        <Input id={`q-${lotId}-${locationId}`} name="qty" inputMode="decimal" defaultValue={available} required />
      </Field>
      <Field label="Set aside for what?" htmlFor={`r-${lotId}-${locationId}`} error={fe.demandReference}>
        <Input id={`r-${lotId}-${locationId}`} name="demandReference" required minLength={3} maxLength={200} placeholder="e.g. Trial batch 14 Nov" />
      </Field>
      <MoreDetails>
        <Field label="Keep it for how many hours?" htmlFor={`t-${lotId}-${locationId}`} error={fe.ttlHours} hint={`If empty: ${ttlDefault} hours.`}>
          <Input id={`t-${lotId}-${locationId}`} name="ttlHours" inputMode="numeric" placeholder={String(ttlDefault)} />
        </Field>
      </MoreDetails>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="cta" disabled={pending || state?.ok}>{pending ? "Setting aside…" : "Set aside"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </form>
  );
}
