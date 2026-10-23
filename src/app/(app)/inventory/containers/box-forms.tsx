"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../_kit/forms";
import { createBoxAction, mergeAction, repackAction, splitAction } from "./actions";

type Content = { lotId: string; lotNumber: string; qty: string; uom: string };

function LotPicker({ contents }: { contents: Content[] }) {
  if (contents.length <= 1) return contents[0] ? <input type="hidden" name="lotId" value={contents[0].lotId} /> : null;
  return (
    <Field label="Lot" htmlFor="lotId">
      <Select id="lotId" name="lotId" required defaultValue="">
        <option value="" disabled>
          Choose the lot…
        </option>
        {contents.map((c) => (
          <option key={c.lotId} value={c.lotId}>
            {c.lotNumber} · {c.qty} {c.uom}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function SplitForm({ containerId, contents, idempotencyKey }: { containerId: string; contents: Content[]; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(splitAction.bind(null, containerId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <LotPicker contents={contents} />
      <Field label="Quantity of each new box" htmlFor="quantities" error={state?.fieldErrors?.quantities} hint="Separate with commas, e.g. 60, 40. Each number becomes a new box with its own label.">
        <Input id="quantities" name="quantities" inputMode="decimal" autoComplete="off" required placeholder="60, 40" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending || state?.ok}>
        {pending ? "Splitting…" : "Split box"}
      </Button>
    </form>
  );
}

export function MergeForm({ containerId, idempotencyKey }: { containerId: string; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(mergeAction.bind(null, containerId), "Merge these boxes into one new box? The scanned boxes will be emptied.");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="Scan the other box(es)" htmlFor="others" error={state?.fieldErrors?.others} hint="Same item, same quality status and the same location. Mixed lots only if the company setting allows.">
        <Input id="others" name="others" autoComplete="off" autoCapitalize="characters" required placeholder="BC:BOX:BX-00000012" className="font-mono" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending}>
        {pending ? "Merging…" : "Merge into a new box"}
      </Button>
    </form>
  );
}

export function RepackForm({ containerId, contents, idempotencyKey }: { containerId: string; contents: Content[]; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(repackAction.bind(null, containerId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <LotPicker contents={contents} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity to repack" htmlFor="qty" error={state?.fieldErrors?.qty}>
          <Input id="qty" name="qty" inputMode="decimal" required autoComplete="off" />
        </Field>
        <Field label="Into box (leave empty for a new box)" htmlFor="toBox" error={state?.fieldErrors?.toBox}>
          <Input id="toBox" name="toBox" autoComplete="off" autoCapitalize="characters" placeholder="BX-00000012" className="font-mono" />
        </Field>
      </div>
      <Field label="Reason" htmlFor="reason" error={state?.fieldErrors?.reason}>
        <Textarea id="reason" name="reason" required minLength={3} maxLength={300} placeholder="e.g. Customer requires 24 per carton" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending}>
        {pending ? "Repacking…" : "Repack"}
      </Button>
    </form>
  );
}

type LotOpt = { id: string; label: string; uom: string; locations: { id: string; code: string; loose: string }[] };

export function NewBoxForm({ lots, initialLotId, idempotencyKey, kinds }: { lots: LotOpt[]; initialLotId?: string; idempotencyKey: string; kinds: readonly string[] }) {
  const { state, pending, onSubmit } = useActionForm(createBoxAction);
  const [lotId, setLotId] = useState(initialLotId && lots.some((l) => l.id === initialLotId) ? initialLotId : (lots[0]?.id ?? ""));
  const lot = lots.find((l) => l.id === lotId);
  const [locId, setLocId] = useState(lot?.locations[0]?.id ?? "");
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="Lot" htmlFor="lotId" error={fe.lotId}>
        <Select
          id="lotId"
          name="lotId"
          value={lotId}
          onChange={(e) => {
            setLotId(e.target.value);
            setLocId(lots.find((l) => l.id === e.target.value)?.locations[0]?.id ?? "");
          }}
        >
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location" htmlFor="locationId" error={fe.locationId}>
          <Select id="locationId" name="locationId" value={locId} onChange={(e) => setLocId(e.target.value)}>
            {lot?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · loose {l.loose} {lot.uom}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity in the box${lot ? ` (${lot.uom})` : ""}`} htmlFor="qty" error={fe.qty}>
          <Input id="qty" name="qty" inputMode="decimal" required autoComplete="off" />
        </Field>
        <Field label="Kind" htmlFor="containerKind">
          <Select id="containerKind" name="containerKind" defaultValue="box">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 self-end text-[13px]">
          <input type="checkbox" name="isPartial" className="size-4 accent-[var(--primary)]" /> Partial box (printed PARTIAL)
        </label>
      </div>
      <Field label="Notes (optional)" htmlFor="notes">
        <Input id="notes" name="notes" maxLength={300} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Creating box…" : "Create box"}
      </Button>
    </form>
  );
}
