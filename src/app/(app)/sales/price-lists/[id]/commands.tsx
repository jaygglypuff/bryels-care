"use client";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { newVersionAction, priceListCommandAction } from "../actions";

export function PriceListCommand({ priceListId, command, label, reason, note, variant = "secondary" }: { priceListId: string; command: "submit" | "approve" | "return" | "reject" | "retire"; label: string; reason?: boolean; note?: boolean; variant?: "secondary" | "cta" | "danger" }) {
  const [open, setOpen] = useState(!reason);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <ActionForm action={priceListCommandAction} hidden={{ priceListId, command }} submit={label} variant={variant} pending="Saving…">
      {(fe) => (
        <>
          {reason && (
            <Field label="Why?" htmlFor={`pl-${command}-reason`} error={fe.reason}>
              <Input id={`pl-${command}-reason`} name="reason" required minLength={3} maxLength={300} />
            </Field>
          )}
          {note && (
            <Field label="Approval note (optional)" htmlFor="pl-note" error={fe.note}>
              <Textarea id="pl-note" name="note" maxLength={500} className="min-h-[56px]" />
            </Field>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function NewVersionForm({ priceListId, today }: { priceListId: string; today: string }) {
  return (
    <ActionForm action={newVersionAction} hidden={{ priceListId }} submit="Start new prices from these" variant="secondary" pending="Making the draft…">
      {(fe) => (
        <Field label="New prices start on" htmlFor="nv-from" error={fe.effectiveFrom ?? fe.form}>
          <Input id="nv-from" name="effectiveFrom" type="date" min={today} defaultValue={today} required />
        </Field>
      )}
    </ActionForm>
  );
}
