"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { reverseMovementAction } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string };

/**
 * Confirm dialog with typed confirmation (docs/ux-system.md component 5.16): states the consequence
 * in one sentence, requires a reason and the word REVERSE; optionally posts the corrected move.
 */
export function ReverseForm({
  movementId,
  idempotencyKey,
  summary,
  baseUom,
  canReplace,
  locations,
  defaults,
}: {
  movementId: string;
  idempotencyKey: string;
  summary: string;
  baseUom: string;
  canReplace: boolean;
  locations: Loc[];
  defaults: { fromId: string | null; qty: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(reverseMovementAction, null);
  const [open, setOpen] = useState(false);
  const [withReplacement, setWithReplacement] = useState(false);
  const [typed, setTyped] = useState("");
  const fe = state?.fieldErrors ?? {};

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center rounded-full border border-transparent bg-[#c62828] px-5 text-[14px] font-medium text-white hover:bg-[#8a1c1c]">
        Reverse this movement…
      </button>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-[18px] border border-[var(--bad-bd)] bg-[var(--bad-bg)]/40 p-4" aria-label="Reverse movement">
      <p className="text-[14px] text-fg">
        <strong>This posts a reversal</strong> that moves {summary} back. The original line stays in the ledger unchanged; the reversal fails if the stock has since moved on.
      </p>
      <input type="hidden" name="movementId" value={movementId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="Reason" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={3} maxLength={500} placeholder="e.g. Scanned the wrong destination rack" />
      </Field>
      {canReplace && (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" name="withReplacement" checked={withReplacement} onChange={(e) => setWithReplacement(e.target.checked)} className="size-5" />
          Also post the corrected move (replacement)
        </label>
      )}
      {withReplacement && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Correct source" htmlFor="replacementFrom" error={fe.replacementFrom}>
            <Select id="replacementFrom" name="replacementFrom" defaultValue={defaults.fromId ?? ""} required>
              <option value="" disabled>Choose…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Correct destination" htmlFor="replacementTo" error={fe.replacementTo}>
            <Select id="replacementTo" name="replacementTo" defaultValue="" required>
              <option value="" disabled>Choose…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name} ({l.kind})</option>
              ))}
            </Select>
          </Field>
          <Field label={`Correct quantity (${baseUom})`} htmlFor="replacementQty" error={fe.replacementQty}>
            <Input id="replacementQty" name="replacementQty" inputMode="decimal" defaultValue={defaults.qty} required className="tabular" />
          </Field>
        </div>
      )}
      <Field label="Type REVERSE to confirm" htmlFor="confirmation" error={fe.confirmation}>
        <Input id="confirmation" name="confirmation" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} required />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger" disabled={typed.trim().toUpperCase() !== "REVERSE"} pendingText="Posting reversal…">
          Post reversal
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-[14px]">
          Cancel
        </button>
      </div>
    </form>
  );
}
