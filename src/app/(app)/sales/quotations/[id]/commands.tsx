"use client";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { convertQuoteAction, quoteCommandAction } from "../actions";

export function QuoteCommand({ quoteId, command, label, reason, note, variant = "secondary" }: { quoteId: string; command: "submit" | "approve" | "return" | "accept" | "reject" | "void"; label: string; reason?: boolean; note?: boolean; variant?: "secondary" | "cta" | "danger" }) {
  const [open, setOpen] = useState(!reason);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <ActionForm action={quoteCommandAction} hidden={{ quoteId, command }} submit={label} variant={variant} pending="Saving…">
      {(fe) => (
        <>
          {reason && (
            <Field label="Reason" htmlFor={`qc-${command}`} error={fe.reason}>
              <Input id={`qc-${command}`} name="reason" required minLength={3} maxLength={300} />
            </Field>
          )}
          {note && (
            <Field label="Approval note (optional)" htmlFor="qc-note" error={fe.note}>
              <Textarea id="qc-note" name="note" maxLength={500} className="min-h-[56px]" />
            </Field>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function ConvertQuoteForm({ quoteId, today }: { quoteId: string; today: string }) {
  return (
    <ActionForm action={convertQuoteAction} hidden={{ quoteId }} submit="Convert to sales order" variant="cta" pending="Creating the order…">
      {(fe) => (
        <div className="grid grid-cols-1 gap-3">
          <Field label="Requested delivery" htmlFor="cv-date" error={fe.requestedDeliveryOn ?? fe.form}>
            <Input id="cv-date" name="requestedDeliveryOn" type="date" min={today} required />
          </Field>
          <Field label="Customer PO number (optional)" htmlFor="cv-po" error={fe.customerPoNumber}>
            <Input id="cv-po" name="customerPoNumber" maxLength={60} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
