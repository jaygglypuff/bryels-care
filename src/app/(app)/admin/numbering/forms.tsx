"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { approveNumberingAction, rejectNumberingAction, submitNumberingAction } from "./actions";

export function NumberingVersionForm({ documentType, current, today }: { documentType: string; current: { prefix: string; pattern: string; resetPeriod: string; sequenceWidth: number; isGapless: boolean }; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(submitNumberingAction, null);
  const fe = state?.fieldErrors ?? {};
  const p = (k: string) => `${documentType}-${k}`;
  return (
    <form action={action} className="mt-2 space-y-3 rounded-[14px] border border-line p-3">
      <input type="hidden" name="documentType" value={documentType} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Letters at the start" htmlFor={p("prefix")} error={fe.prefix} hint="1–8 capital letters or digits">
          <Input id={p("prefix")} name="prefix" defaultValue={current.prefix} required className="font-mono uppercase" />
        </Field>
        <Field label="The running number starts again" htmlFor={p("reset")} error={fe.resetPeriod}>
          <Select id={p("reset")} name="resetPeriod" defaultValue={current.resetPeriod}>
            <option value="never">Never</option>
            <option value="yearly">Every year</option>
            <option value="monthly">Every month</option>
            <option value="daily">Every day</option>
          </Select>
        </Field>
        <Field label="What changes and why" htmlFor={p("sum")} error={fe.changeSummary}>
          <Input id={p("sum")} name="changeSummary" required minLength={3} />
        </Field>
        <Field label="Your password" htmlFor={p("pw")} error={fe.password} hint="Not needed within 10 minutes of “Confirm it’s you”.">
          <Input id={p("pw")} name="password" type="password" autoComplete="current-password" />
        </Field>
      </div>
      <MoreDetails open={!!(fe.pattern || fe.sequenceWidth || fe.effectiveFrom)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Pattern" htmlFor={p("pattern")} error={fe.pattern} hint="{PREFIX} {YYYY} {YY} {YYMM} {YYMMDD} {SEQ}">
            <Input id={p("pattern")} name="pattern" defaultValue={current.pattern} required className="font-mono" />
          </Field>
          <Field label="Digits in the running number" htmlFor={p("width")} error={fe.sequenceWidth}>
            <Input id={p("width")} name="sequenceWidth" type="number" min={1} max={12} defaultValue={current.sequenceWidth} />
          </Field>
          <Field label="Starts on" htmlFor={p("from")} error={fe.effectiveFrom}>
            <Input id={p("from")} name="effectiveFrom" type="date" min={today} defaultValue={today} required />
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" name="isGapless" defaultChecked={current.isGapless} className="size-5" /> No gaps allowed (numbers are never shown in advance; for invoices)
        </label>
      </MoreDetails>
      <FormMessage state={state} />
      <SubmitButton pendingText="Sending…">Send for OK</SubmitButton>
    </form>
  );
}

export function VersionDecision({ id, isOwn }: { id: string; isOwn: boolean }) {
  const [aState, approve] = useActionState<ActionState, FormData>(approveNumberingAction, null);
  const [rState, reject] = useActionState<ActionState, FormData>(rejectNumberingAction, null);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {!isOwn && (
          <form action={approve} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <Input name="password" type="password" placeholder="Your password" aria-label="Your password" autoComplete="current-password" className="w-full sm:w-40" />
            <SubmitButton size="sm" pendingText="Approving…">Approve</SubmitButton>
          </form>
        )}
        <form action={reject} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <Input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason" className="w-full sm:w-40" />
          <SubmitButton size="sm" variant="ghost" pendingText="Closing…">{isOwn ? "Withdraw" : "Reject"}</SubmitButton>
        </form>
      </div>
      {isOwn && <p className="text-[13px] text-muted">You asked for this change; another person must say OK.</p>}
      <FormMessage state={aState ?? rState} />
    </div>
  );
}
