"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { periodCommandAction } from "../actions";

type Cmd = "lock" | "request_unlock" | "approve_unlock" | "reject_unlock" | "cancel_unlock";

/** One period command (restricted ones ask for the password; lock may acknowledge open items). */
export function PeriodCommand({ command, periodCode, requestId, label, openItems = 0, variant = "secondary" }: { command: Cmd; periodCode: string; requestId?: string; label: string; openItems?: number; variant?: "secondary" | "cta" | "danger" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant={variant === "danger" ? "secondary" : variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  const needsReason = command !== "approve_unlock" && command !== "cancel_unlock";
  const needsPassword = command === "lock" || command === "request_unlock" || command === "approve_unlock";
  const f = `${command}-${periodCode}`;
  return (
    <ActionForm action={periodCommandAction} hidden={{ command, periodCode, requestId }} submit={label} variant={variant} pending="Saving…">
      {(fe) => (
        <>
          {needsReason && (
            <Field label="Why" htmlFor={`${f}-r`} error={fe.reason}>
              <Input id={`${f}-r`} name="reason" required minLength={3} maxLength={500} />
            </Field>
          )}
          {command === "approve_unlock" && (
            <Field label="Note (you can skip this)" htmlFor={`${f}-n`}>
              <Input id={`${f}-n`} name="note" maxLength={500} />
            </Field>
          )}
          {command === "lock" && openItems > 0 && (
            <>
              <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="checkbox" name="acknowledge" className="h-5 w-5" /> Close it anyway: I know {openItems} paper(s) dated this month are not finished
              </label>
              <Field label="Why they can stay unfinished" htmlFor={`${f}-a`} error={fe.acknowledgementNote}>
                <Input id={`${f}-a`} name="acknowledgementNote" maxLength={500} />
              </Field>
            </>
          )}
          {needsPassword && (
            <Field label="Your password" htmlFor={`${f}-p`} error={fe.password} hint="Type your password to show it is you.">
              <Input id={`${f}-p`} name="password" type="password" autoComplete="current-password" />
            </Field>
          )}
        </>
      )}
    </ActionForm>
  );
}
