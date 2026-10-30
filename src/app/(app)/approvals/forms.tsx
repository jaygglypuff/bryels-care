"use client";
import { Field, Input } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { decideApprovalAction } from "./actions";

/** Approve and Reject / Send back on one row of "To approve" (ADR-075). The server re-checks everything. */
export function InlineDecision({ kind, entityId, what, rejectLabel }: { kind: string; entityId: string; what: string; rejectLabel: string }) {
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <ActionForm action={decideApprovalAction} hidden={{ kind, entityId, decision: "approve" }} submit="Approve" pending="Approving…" variant="cta" size="sm" className="flex flex-col gap-2" messageBelow confirm={`Approve ${what}?`} />
      {rejectLabel && (
        <details className="w-full sm:w-72">
          <summary className="min-h-[44px] cursor-pointer text-[14px] leading-[44px] text-primary-text">{rejectLabel}…</summary>
          <ActionForm action={decideApprovalAction} hidden={{ kind, entityId, decision: "reject" }} submit={rejectLabel} pending="Saving…" variant="danger" size="sm" className="mt-2 flex flex-col gap-2" messageBelow>
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
