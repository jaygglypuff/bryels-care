"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { issueHeldStockAction, placeHoldAction } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string; held: boolean };
type Reason = { code: string; label: string };
type LotOpt = { lotNumber: string; itemName: string; onHand: string };

/** Pick the lot by its name (no code typing, ADR-088); scanning a label stays possible under "More details". */
function LotPicker({ lots, fe, defaultLot, required = true }: { lots: LotOpt[]; fe: Record<string, string>; defaultLot?: string; required?: boolean }) {
  const known = !defaultLot || lots.some((l) => l.lotNumber === defaultLot);
  return (
    <>
      <Field label="Which lot?" htmlFor="lot" error={fe.lot}>
        <Select id="lot" name="lot" required={required && known && lots.length > 0} defaultValue={known ? (defaultLot ?? "") : ""}>
          <option value="">Choose…</option>
          {lots.map((l) => (
            <option key={l.lotNumber} value={l.lotNumber}>
              {l.itemName} · {l.lotNumber} ({l.onHand})
            </option>
          ))}
        </Select>
      </Field>
      <MoreDetails title="Not in the list? Scan the label" open={!known || lots.length === 0}>
        <Field label="Scan the lot label" htmlFor="lotScan" error={fe.lotScan}>
          <Input id="lotScan" name="lotScan" autoComplete="off" defaultValue={known ? "" : defaultLot} />
        </Field>
      </MoreDetails>
    </>
  );
}

export function PlaceHoldForm({ locations, reasonCodes, defaultLot, lots }: { locations: Loc[]; reasonCodes: Reason[]; defaultLot?: string; lots: LotOpt[] }) {
  const [state, dispatch] = useActionState<ActionState, FormData>(placeHoldAction, null);
  const [scope, setScope] = useState<"lot" | "location">("lot");
  const [key] = useState(() => crypto.randomUUID());
  const fe = state?.fieldErrors ?? {};
  return (
    <form
      action={dispatch}
      className="space-y-4"
      onSubmit={(e) => {
        const msg = scope === "location" ? "Every lot in this place is stopped and nothing new can be put there. Continue?" : "Nobody can use, set aside or ship this lot until QA decides. Continue?";
        if (!window.confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="scope" value={scope} />
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-2 text-[14px] font-medium">What to stop</legend>
        {(["lot", "location"] as const).map((s) => (
          <label key={s} className="flex min-h-[44px] items-center gap-2 rounded-full border border-line px-4 text-[14px]">
            <input type="radio" name="scopeChoice" checked={scope === s} onChange={() => setScope(s)} /> {s === "lot" ? "One lot" : "A whole place (every lot in it)"}
          </label>
        ))}
      </fieldset>
      {scope === "lot" ? (
        <LotPicker lots={lots} fe={fe} defaultLot={defaultLot} />
      ) : (
        <Field label="Which place?" htmlFor="locationId" error={fe.locationId}>
          <Select id="locationId" name="locationId" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id} disabled={l.held}>
                {l.name} · {l.code}{l.held ? " · already stopped" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Kind of reason" htmlFor="reasonCode" error={fe.reasonCode}>
        <Select id="reasonCode" name="reasonCode" required defaultValue={reasonCodes[0]?.code}>
          {reasonCodes.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="What happened?" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" size="lg" pendingText="Stopping…">Stop it</SubmitButton>
    </form>
  );
}

export function HeldIssueForm({ locations, lots }: { locations: { id: string; code: string; name: string; kind: string }[]; lots: LotOpt[] }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, dispatch] = useActionState<ActionState, FormData>(async (p, fd) => {
    const r = await issueHeldStockAction(p, fd);
    if (r?.ok) setKey(crypto.randomUUID());
    return r;
  }, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={dispatch} className="space-y-4" onSubmit={(e) => !window.confirm("Take out stopped stock as an exception? This is saved with your name.") && e.preventDefault()}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 sm:col-span-2">
          <LotPicker lots={lots} fe={fe} />
        </div>
        <Field label="From which place?" htmlFor="fromLocationId" error={fe.fromLocationId}>
          <Select id="fromLocationId" name="fromLocationId" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name} · {l.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="How much (g or pieces)" htmlFor="qty" error={fe.qty}>
          <Input id="qty" name="qty" required inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="What for?" htmlFor="purpose" error={fe.purpose}>
          <Select id="purpose" name="purpose" defaultValue="sampling">
            <option value="sampling">A sample for testing</option>
            <option value="rework">To fix it (rework)</option>
            <option value="destruction">To throw it away</option>
          </Select>
        </Field>
      </div>
      <Field label="Why?" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" size="lg" pendingText="Saving…">Take it out (exception)</SubmitButton>
    </form>
  );
}
