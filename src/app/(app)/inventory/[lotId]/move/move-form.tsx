"use client";
import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Textarea } from "@/ui/core";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { FormMessage, SubmitButton } from "@/ui/form";
import { LOCATION_KIND_WORDS } from "@/ui/inventory/bits";
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
      <ScanOrPick
        kind="location"
        name="fromLocationId"
        label="From which shelf?"
        candidates={sources.map((x) => ({ value: x.id, title: x.name, detail: `${x.code} · ${x.qtyLabel}`, code: x.code, codes: [x.code] }))}
        value={fromId || null}
        hideWhenSingle
        onlyCandidates
        search={false}
        required
        onChange={(v) => {
          if ((v ?? "") === fromId) return;
          setFromId(v ?? "");
          setQty(sources.find((x) => x.id === v)?.qty ?? "");
        }}
        error={fe.fromLocationId}
      />
      <ScanOrPick
        kind="location"
        name="toLocationId"
        label="To which shelf?"
        hint="Only shelves this lot may go to now are listed. Tap one or scan the shelf label."
        candidates={options.map((d) => ({ value: d.id, title: d.name, detail: `${d.code}${d.kind !== "storage" ? ` · ${LOCATION_KIND_WORDS[d.kind] ?? d.kind}` : ""}`, code: d.code, codes: [d.code] }))}
        onlyCandidates
        required
        error={fe.toLocationId}
      />
      <Field label={`How much? (${baseUom})`} htmlFor="qty" error={fe.qty} hint={from ? `${from.qtyLabel} on ${from.name}. Filled in with all of it.` : undefined}>
        <div className="flex items-center gap-2">
          <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} required className="tabular" />
          <span className="min-w-[36px] text-[14px] font-medium text-muted">{baseUom}</span>
        </div>
      </Field>
      <Field label="Why?" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={3} maxLength={500} placeholder="e.g. Put away after QA said OK" />
      </Field>
      <FormMessage state={state} />
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
        <SubmitButton variant="cta" size="lg" className="w-full sm:w-auto" pendingText="Saving the move…">
          Move it
        </SubmitButton>
      </div>
    </form>
  );
}
