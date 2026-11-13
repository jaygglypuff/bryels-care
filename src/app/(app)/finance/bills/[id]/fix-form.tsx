"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { fixBillAction } from "../../actions";

/** ADR-131 "Fix a mistake" on a bill in the books: undo it (kept on record) and open its copy to change. */
export function FixBillForm({ billId }: { billId: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Fix a mistake
      </Button>
    );
  return (
    <ActionForm action={fixBillAction} hidden={{ id: billId }} submit="Undo it and open a copy to fix" variant="primary" pending="Fixing…" confirm="Undo this bill (it stays on record) and open a copy to change?">
      {(fe) => (
        <>
          <p className="text-[13px] text-muted">The bill is undone (a cancelling entry is saved to the books) and a copy with the same supplier number opens, so you change only what was wrong.</p>
          <Field label="What was wrong" htmlFor={`fix-${billId}`} error={fe.reason}>
            <Input id={`fix-${billId}`} name="reason" required minLength={5} maxLength={300} placeholder="For example: wrong quantity typed" />
          </Field>
          <Field label="Your password" htmlFor={`fix-pw-${billId}`} error={fe.password} hint="Money in the books changes: type your password to show it is you.">
            <Input id={`fix-pw-${billId}`} name="password" type="password" autoComplete="current-password" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
