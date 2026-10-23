"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../../_kit/forms";
import { reserveAction } from "./actions";

export function ReserveForm({ lotId, locationId, available, uom, ttlDefault, idempotencyKey }: { lotId: string; locationId: string; available: string; uom: string; ttlDefault: number; idempotencyKey: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(reserveAction);
  if (!open)
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reserve
      </Button>
    );
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
      <input type="hidden" name="lotId" value={lotId} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label={`Quantity (max ${available} ${uom})`} htmlFor={`q-${lotId}-${locationId}`} error={fe.qty}>
        <Input id={`q-${lotId}-${locationId}`} name="qty" inputMode="decimal" defaultValue={available} required />
      </Field>
      <Field label="Reserved for" htmlFor={`r-${lotId}-${locationId}`} error={fe.demandReference}>
        <Input id={`r-${lotId}-${locationId}`} name="demandReference" required minLength={3} maxLength={200} placeholder="e.g. Trial batch 14 Nov" />
      </Field>
      <Field label="Hold for (hours)" htmlFor={`t-${lotId}-${locationId}`} error={fe.ttlHours} hint={`Default ${ttlDefault} h (setting).`}>
        <Input id={`t-${lotId}-${locationId}`} name="ttlHours" inputMode="numeric" placeholder={String(ttlDefault)} />
      </Field>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="cta" size="sm" disabled={pending || state?.ok}>{pending ? "Reserving…" : "Reserve"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </form>
  );
}
