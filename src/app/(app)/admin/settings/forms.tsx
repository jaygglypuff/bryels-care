"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { approveSettingChangeAction, cancelSettingChangeAction, changeSettingAction, rejectSettingChangeAction } from "./actions";

export type ValueKind = "number" | "boolean" | "string" | "json";

/** Change one setting (organization or one of the user's sites). Restricted: password required. */
export function SettingForm({ settingKey, kind, current, sites, requiresApproval }: { settingKey: string; kind: ValueKind; current: string; sites: { id: string; code: string }[]; requiresApproval: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(changeSettingAction, null);
  const fe = state?.fieldErrors ?? {};
  const id = (k: string) => `${settingKey}-${k}`;
  return (
    <form action={action} className="mt-3 space-y-3 rounded-[14px] border border-line p-3">
      <input type="hidden" name="key" value={settingKey} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2">
        {sites.length > 0 && (
          <Field label="Applies to" htmlFor={id("site")} error={fe.siteId}>
            <Select id={id("site")} name="siteId" defaultValue="">
              <option value="">Whole organization</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>Site {s.code} only</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="New value" htmlFor={id("value")} error={fe.value} hint={kind === "json" ? "JSON, same shape as the current value." : undefined}>
          {kind === "boolean" ? (
            <Select id={id("value")} name="value" defaultValue={current}>
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          ) : kind === "json" ? (
            <Textarea id={id("value")} name="value" defaultValue={current} rows={4} className="font-mono text-[12px]" />
          ) : (
            <Input id={id("value")} name="value" defaultValue={current} inputMode={kind === "number" ? "decimal" : undefined} />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="clearValue" /> Remove the stored value (use the default or the organization value)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason" htmlFor={id("reason")} error={fe.reason}>
          <Input id={id("reason")} name="reason" required minLength={3} maxLength={500} placeholder="Why this changes" />
        </Field>
        <Field label="Your password" htmlFor={id("password")} error={fe.password} hint="Not needed within 10 minutes of “Confirm it’s you”; two-step sign-in users confirm there.">
          <Input id={id("password")} name="password" type="password" autoComplete="current-password" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="primary" size="sm" pendingText="Saving…">{requiresApproval ? "Submit for approval" : "Save change"}</SubmitButton>
    </form>
  );
}

/** Approve / reject (approvers) or withdraw (the submitter) a pending request. */
export function RequestDecision({ id, canApprove, isOwn }: { id: string; canApprove: boolean; isOwn: boolean }) {
  const [aState, approve] = useActionState<ActionState, FormData>(approveSettingChangeAction, null);
  const [rState, reject] = useActionState<ActionState, FormData>(rejectSettingChangeAction, null);
  const [cState, cancel] = useActionState<ActionState, FormData>(cancelSettingChangeAction, null);
  return (
    <div className="mt-2 space-y-2">
      {canApprove && !isOwn && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <form action={approve} className="flex flex-1 flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <Input name="note" placeholder="Note (optional)" aria-label="Approval note" className="!min-h-[36px] w-40 text-[13px]" />
            <Input name="password" type="password" placeholder="Your password" aria-label="Your password" autoComplete="current-password" className="!min-h-[36px] w-40 text-[13px]" />
            <SubmitButton size="sm" pendingText="Approving…">Approve</SubmitButton>
          </form>
          <form action={reject} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <Input name="reason" required minLength={3} placeholder="Reason" aria-label="Reason for rejecting" className="!min-h-[36px] w-40 text-[13px]" />
            <SubmitButton size="sm" variant="ghost" pendingText="Rejecting…">Reject</SubmitButton>
          </form>
        </div>
      )}
      {isOwn && (
        <form action={cancel} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <p className="text-[12px] text-muted">You submitted this; another person must approve it.</p>
          <SubmitButton size="sm" variant="ghost" pendingText="Withdrawing…">Withdraw</SubmitButton>
        </form>
      )}
      <FormMessage state={aState ?? rState ?? cState} />
    </div>
  );
}
