"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { issueHeldStockAction, placeHoldAction } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string; held: boolean };
type Reason = { code: string; label: string };

export function PlaceHoldForm({ locations, reasonCodes, defaultLot }: { locations: Loc[]; reasonCodes: Reason[]; defaultLot?: string }) {
  const [state, dispatch] = useActionState<ActionState, FormData>(placeHoldAction, null);
  const [scope, setScope] = useState<"lot" | "location">("lot");
  const [key] = useState(() => crypto.randomUUID());
  const fe = state?.fieldErrors ?? {};
  return (
    <form
      action={dispatch}
      className="space-y-4"
      onSubmit={(e) => {
        const msg = scope === "location" ? "Every lot with stock in this location goes on hold and the location refuses new stock. Continue?" : "The lot goes on hold: blocked for allocation, issue and shipment. Continue?";
        if (!window.confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="scope" value={scope} />
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-2 text-[14px] font-medium">What to hold</legend>
        {(["lot", "location"] as const).map((s) => (
          <label key={s} className="flex min-h-[44px] items-center gap-2 rounded-full border border-line px-4 text-[14px]">
            <input type="radio" name="scopeChoice" checked={scope === s} onChange={() => setScope(s)} /> {s === "lot" ? "A lot" : "A location (every lot in it)"}
          </label>
        ))}
      </fieldset>
      {scope === "lot" ? (
        <Field label="Lot (scan or type)" htmlFor="lot" error={fe.lot}>
          <Input id="lot" name="lot" defaultValue={defaultLot} required placeholder="BC:LOT:L-2610-00012" autoComplete="off" />
        </Field>
      ) : (
        <Field label="Location" htmlFor="locationId" error={fe.locationId}>
          <Select id="locationId" name="locationId" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id} disabled={l.held}>
                {l.code} · {l.name} ({l.kind}){l.held ? " · already on hold" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Reason code" htmlFor="reasonCode" error={fe.reasonCode}>
        <Select id="reasonCode" name="reasonCode" required defaultValue={reasonCodes[0]?.code}>
          {reasonCodes.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="What happened" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" size="lg" pendingText="Placing hold…">Place hold</SubmitButton>
    </form>
  );
}

export function HeldIssueForm({ locations }: { locations: { id: string; code: string; name: string; kind: string }[] }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, dispatch] = useActionState<ActionState, FormData>(async (p, fd) => {
    const r = await issueHeldStockAction(p, fd);
    if (r?.ok) setKey(crypto.randomUUID());
    return r;
  }, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={dispatch} className="space-y-4" onSubmit={(e) => !window.confirm("Issue blocked stock under the controlled exception? This is recorded against your name.") && e.preventDefault()}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lot (scan or type)" htmlFor="lot" error={fe.lot}>
          <Input id="lot" name="lot" required autoComplete="off" placeholder="BC:LOT:L-2610-00012" />
        </Field>
        <Field label="From location" htmlFor="fromLocationId" error={fe.fromLocationId}>
          <Select id="fromLocationId" name="fromLocationId" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity (lot base unit)" htmlFor="qty" error={fe.qty}>
          <Input id="qty" name="qty" required inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Purpose" htmlFor="purpose" error={fe.purpose}>
          <Select id="purpose" name="purpose" defaultValue="sampling">
            <option value="sampling">Sampling</option>
            <option value="rework">Rework</option>
            <option value="destruction">Destruction</option>
          </Select>
        </Field>
      </div>
      <Field label="Reason" htmlFor="reason" error={fe.reason}>
        <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" size="lg" pendingText="Issuing…">Issue under exception</SubmitButton>
    </form>
  );
}
