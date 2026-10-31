"use client";
import { useActionState, useState, useTransition } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { resolvePickAction } from "../../scan-pick-actions";
import { issueHeldStockAction, placeHoldAction } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string; held: boolean };
type Reason = { code: string; label: string };
type LotOpt = { lotNumber: string; itemName: string; onHand: string };

/** Which lot: tap it, scan its label or find it by name (ScanOrPick; no code typing, ADR-088). */
function LotPicker({ lots, fe, defaultLot, required = true, onChange }: { lots: LotOpt[]; fe: Record<string, string>; defaultLot?: string; required?: boolean; onChange?: (lotNumber: string | null, c: PickCandidate | null) => void }) {
  return (
    <ScanOrPick
      kind="lot"
      name="lot"
      submit="code"
      label="Which lot?"
      candidates={lots.map((l) => ({ value: l.lotNumber, title: l.itemName, detail: `lot ${l.lotNumber} · ${l.onHand}`, code: l.lotNumber, codes: [l.lotNumber] }))}
      defaultValue={defaultLot}
      required={required}
      onChange={(v, c) => onChange?.(v, c)}
      error={fe.lot ?? fe.lotScan}
    />
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
        <ScanOrPick
          kind="location"
          name="locationId"
          label="Which place?"
          candidates={locations.map((l) => ({ value: l.id, title: l.name, detail: l.code, code: l.code, codes: [l.code], disabledReason: l.held ? "Already stopped" : undefined }))}
          onlyCandidates
          required
          error={fe.locationId}
        />
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
  // "From which place?" offers only the places that hold the chosen lot (one → chosen and hidden).
  const [places, setPlaces] = useState<PickCandidate[] | null>(null);
  const [, startPlaces] = useTransition();
  const onLot = (v: string | null, c: PickCandidate | null) => {
    if (!v) return setPlaces(null);
    if (c?.places) return setPlaces(c.places);
    startPlaces(async () => {
      const r = await resolvePickAction("lot", v);
      setPlaces(r.ok ? (r.candidate.places ?? []) : []);
    });
  };
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
          <LotPicker lots={lots} fe={fe} onChange={onLot} />
        </div>
        <div className="sm:col-span-2">
          {places === null ? (
            <p className="text-[13px] text-muted">Choose the lot first; then its places show here.</p>
          ) : places.length === 0 ? (
            <p className="text-[13px] text-[var(--warn-fg)]">This lot has no stock on any place at this site.</p>
          ) : (
            <ScanOrPick
              kind="location"
              name="fromLocationId"
              label="From which place?"
              candidates={places.filter((p) => locations.some((l) => l.id === p.value))}
              hideWhenSingle
              onlyCandidates
              search={false}
              required
              error={fe.fromLocationId}
            />
          )}
        </div>
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
