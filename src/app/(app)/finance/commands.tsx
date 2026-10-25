"use client";
import { useState } from "react";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { financeCommandAction } from "./actions";

/**
 * One finance command as an in-place form (ADR-043). `reason` asks for a reason (returns, cancels, voids);
 * `note` an optional approval note; `password` the re-authentication of restricted actions (posting and
 * voiding money, docs/security.md §3.6; not needed inside the "Confirm it's you" window). Commands that
 * need input open on demand so the page stays short on a phone.
 */
export function FinanceCommand({
  entity,
  id,
  command,
  label,
  reason,
  note,
  password,
  confirm,
  variant = "secondary",
  hint,
}: {
  entity: "invoice" | "credit_note" | "payment" | "bill" | "expense";
  id: string;
  command: string;
  label: string;
  reason?: boolean;
  note?: boolean;
  password?: boolean;
  confirm?: string;
  variant?: "secondary" | "cta" | "danger" | "primary";
  hint?: string;
}) {
  const needsInput = !!(reason || password);
  const [open, setOpen] = useState(!needsInput);
  if (!open)
    return (
      <Button type="button" variant={variant === "danger" ? "secondary" : variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  const f = `${entity}-${command}`;
  return (
    <ActionForm action={financeCommandAction} hidden={{ entity, id, command }} submit={label} variant={variant} pending="Saving…" confirm={confirm}>
      {(fe) => (
        <>
          {hint && <p className="text-[13px] text-muted">{hint}</p>}
          {reason && (
            <Field label="Reason" htmlFor={`${f}-reason`} error={fe.reason}>
              <Input id={`${f}-reason`} name="reason" required minLength={3} maxLength={500} />
            </Field>
          )}
          {note && (
            <Field label="Note (optional)" htmlFor={`${f}-note`} error={fe.note}>
              <Textarea id={`${f}-note`} name="note" maxLength={500} className="min-h-[56px]" />
            </Field>
          )}
          {password && (
            <Field label="Your password" htmlFor={`${f}-pw`} error={fe.password} hint="Restricted action: confirm it's you (not needed right after “Confirm it's you”).">
              <Input id={`${f}-pw`} name="password" type="password" autoComplete="current-password" />
            </Field>
          )}
        </>
      )}
    </ActionForm>
  );
}
