"use client";
import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { moveStockAction } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string };

export function MoveForm({
  lotId,
  idempotencyKey,
  baseUom,
  sources,
  destinations,
}: {
  lotId: string;
  idempotencyKey: string;
  baseUom: string;
  sources: (Loc & { qty: string; qtyLabel: string })[];
  destinations: Loc[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(moveStockAction, null);
  const [fromId, setFromId] = useState(sources[0]?.id ?? "");
  const from = sources.find((s) => s.id === fromId);
  const [qty, setQty] = useState(from?.qty ?? "");
  const options = useMemo(() => destinations.filter((d) => d.id !== fromId), [destinations, fromId]);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lotId" value={lotId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="From location" htmlFor="fromLocationId" error={fe.fromLocationId}>
        <Select
          id="fromLocationId"
          name="fromLocationId"
          value={fromId}
          onChange={(e) => {
            setFromId(e.target.value);
            setQty(sources.find((s) => s.id === e.target.value)?.qty ?? "");
          }}
          required
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name} ({s.qtyLabel})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="To location" htmlFor="toLocationId" error={fe.toLocationId} hint="Only locations allowed for this lot's quality status are listed.">
        <Select id="toLocationId" name="toLocationId" defaultValue="" required>
          <option value="" disabled>
            Choose destination…
          </option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name} ({d.kind})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Quantity (${baseUom})`} htmlFor="qty" error={fe.qty} hint={from ? `Available at ${from.code}: ${from.qtyLabel}. Defaults to the full quantity.` : undefined}>
        <div className="flex items-center gap-2">
          <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} required className="tabular" />
          <span className="min-w-[36px] text-[14px] font-medium text-muted">{baseUom}</span>
        </div>
      </Field>
      <Field label="Reason" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={3} maxLength={500} placeholder="e.g. Put-away to quarantine cage after receiving" />
      </Field>
      <FormMessage state={state} />
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
        <SubmitButton variant="cta" size="lg" className="w-full sm:w-auto" pendingText="Posting move…">
          Post move
        </SubmitButton>
      </div>
    </form>
  );
}
