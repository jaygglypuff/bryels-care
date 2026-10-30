"use client";
import { useState } from "react";
import { Field, Input, Textarea } from "@/ui/core";
import { ActionForm, FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { decideQualityCheckAction } from "./actions";

/**
 * The three decisions of Check quality (ADR-080 §8; UX words Pass / Not yet / Fail). Pass is enabled
 * only after the "I reviewed the batch record" tick. The server re-checks everything.
 */
export function PassForm({ batchId, maker, canPass }: { batchId: string; maker: { what: string[]; ownerOverride: boolean } | null; canPass: boolean }) {
  const [state, dispatch] = useInPlaceAction(decideQualityCheckAction);
  const [reviewed, setReviewed] = useState(false);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={dispatch} className="flex flex-col gap-3" onSubmit={(e) => !window.confirm("Pass this batch? The stock becomes ready to sell.") && e.preventDefault()}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="decision" value="pass" />
      <label className="flex min-h-[48px] items-center gap-3 text-[15px]">
        <input type="checkbox" name="recordReviewed" value="yes" className="h-6 w-6" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the batch record and the exceptions above
      </label>
      {fe.recordReviewed && <p className="text-[14px] text-[var(--bad-fg)]">{fe.recordReviewed}</p>}
      {maker?.ownerOverride && (
        <Field label="Why do you pass a batch you worked on? (printed on the batch record)" htmlFor="overrideReason" error={fe.overrideReason} hint={`You ${maker.what.join(", ")} on this batch. This is recorded.`}>
          <Textarea id="overrideReason" name="overrideReason" rows={2} maxLength={1000} required placeholder="For example: No separate QA person yet" />
        </Field>
      )}
      <Field label="Note (optional)" htmlFor="pass-reason" error={fe.reason}>
        <Input id="pass-reason" name="reason" maxLength={1000} autoComplete="off" />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton size="lg" pendingText="Passing…" disabled={!reviewed || !canPass}>
          Pass
        </SubmitButton>
      </div>
    </form>
  );
}

export function NotYetForm({ batchId, today }: { batchId: string; today: string }) {
  return (
    <ActionForm action={decideQualityCheckAction} hidden={{ batchId, decision: "not_yet" }} submit="Not yet" pending="Saving…" variant="secondary">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Why not yet?" htmlFor="ny-reason" error={fe.reason}>
            <Input id="ny-reason" name="reason" required maxLength={1000} autoComplete="off" placeholder="For example: waiting for the pH retest" />
          </Field>
          <Field label="Check again on" htmlFor="ny-date" error={fe.checkAgainOn}>
            <Input id="ny-date" name="checkAgainOn" type="date" required min={today} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function FailForm({ batchId }: { batchId: string }) {
  return (
    <ActionForm action={decideQualityCheckAction} hidden={{ batchId, decision: "fail" }} submit="Fail" pending="Saving…" variant="danger" confirm="Fail this batch? The stock is moved to the rejected area. This cannot be undone here.">
      {(fe) => (
        <Field label="Why does it fail?" htmlFor="fail-reason" error={fe.reason}>
          <Textarea id="fail-reason" name="reason" rows={2} required maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}
