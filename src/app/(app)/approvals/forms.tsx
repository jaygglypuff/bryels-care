"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { ActionForm, FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { decideApprovalAction } from "./actions";

/**
 * Approve and Reject / Send back on one row of "To approve" (ADR-075). Approve is two taps inside the
 * page (no browser popup): the first shows "Approve ₱350.00 expense claim from Tess?" with
 * [Yes, approve] and [Cancel]. The server re-checks permission, site, step and same-person rules.
 */
export function InlineDecision({ kind, entityId, what, rejectLabel }: { kind: string; entityId: string; what: string; rejectLabel: string }) {
  const [asking, setAsking] = useState(false);
  const [state, dispatch] = useInPlaceAction(decideApprovalAction);
  return (
    <div className="flex w-full flex-col gap-2 md:w-72">
      {!asking ? (
        <Button type="button" variant="primary" className="w-full" onClick={() => setAsking(true)}>
          Approve
        </Button>
      ) : (
        <form action={dispatch} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="decision" value="approve" />
          <p className="text-[14px] font-medium" role="status">
            Approve {what}?
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton variant="primary" className="w-full sm:flex-1" pendingText="Approving…" autoFocus>
              Yes, approve
            </SubmitButton>
            <Button type="button" variant="secondary" className="w-full sm:flex-1" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <FormMessage state={state} />
      {rejectLabel && (
        <details className="w-full">
          <summary className="min-h-[44px] cursor-pointer text-[14px] leading-[44px] text-primary-text">{rejectLabel}…</summary>
          <ActionForm action={decideApprovalAction} hidden={{ kind, entityId, decision: "reject" }} submit={rejectLabel} pending="Saving…" variant="danger" className="mt-2 flex flex-col gap-2" messageBelow>
            {(fe) => (
              <Field label="Why?" htmlFor={`note-${entityId}`} error={fe.note}>
                <Input id={`note-${entityId}`} name="note" required minLength={3} maxLength={500} placeholder="Tell the person what to change" />
              </Field>
            )}
          </ActionForm>
        </details>
      )}
    </div>
  );
}
