"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { fmtLotQty } from "@/ui/inventory/bits";
import { useActionForm } from "../_kit/forms";
import { createBoxAction, mergeAction, repackAction, splitAction } from "./actions";

type Content = { lotId: string; lotNumber: string; itemName?: string; qty: string; uom: string };
/** Other boxes on the same shelf: picked by what is inside, never by typing a box number. */
type OtherBox = { number: string; label: string };

function LotPicker({ contents }: { contents: Content[] }) {
  if (contents.length <= 1) return contents[0] ? <input type="hidden" name="lotId" value={contents[0].lotId} /> : null;
  return (
    <Field label="Which one?" htmlFor="lotId">
      <Select id="lotId" name="lotId" required defaultValue="">
        <option value="" disabled>
          Choose…
        </option>
        {contents.map((c) => (
          <option key={c.lotId} value={c.lotId}>
            {c.itemName ? `${c.itemName} · ` : ""}{fmtLotQty(c.qty, c.uom)} · lot {c.lotNumber}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function SplitForm({ containerId, contents, idempotencyKey }: { containerId: string; contents: Content[]; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(splitAction.bind(null, containerId));
  const uom = contents[0]?.uom ?? "";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <LotPicker contents={contents} />
      <Field label={`How much in each new box? (${uom})`} htmlFor="quantities" error={state?.fieldErrors?.quantities} hint="Put a comma between boxes, e.g. 60, 40 makes two new boxes. Each gets its own label.">
        <Input id="quantities" name="quantities" inputMode="decimal" autoComplete="off" required placeholder="60, 40" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending || state?.ok}>
        {pending ? "Splitting…" : "Split into new boxes"}
      </Button>
    </form>
  );
}

export function MergeForm({ containerId, idempotencyKey, others }: { containerId: string; idempotencyKey: string; others: OtherBox[] }) {
  const { state, pending, onSubmit, confirmBox } = useActionForm(mergeAction.bind(null, containerId), "Put these boxes together into one new box? The other boxes will be empty.", "Yes, put them together");
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {others.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[14px] font-medium">Boxes on the same shelf</legend>
          {others.map((b) => (
            <label key={b.number} className="flex min-h-[44px] items-center gap-3 rounded-[12px] border border-line px-3 text-[14px]">
              <input type="checkbox" name="others" value={b.number} className="size-5 shrink-0" />
              <span className="min-w-0">{b.label} <span className="font-mono text-[12px] text-muted">{b.number}</span></span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-[14px] text-fg-2">There are no other boxes on this shelf. Scan the label of the other box.</p>
      )}
      <Field label="Or scan another box label" htmlFor="others" error={state?.fieldErrors?.others} hint="Same item, same QA state and the same shelf.">
        <Input id="others" name="others" autoComplete="off" autoCapitalize="characters" placeholder="Scan the box label" className="font-mono" />
      </Field>
      <FormMessage state={state} />
      {confirmBox ?? (
        <Button type="submit" variant="cta" size="lg" disabled={pending}>
          {pending ? "Putting together…" : "Put together into a new box"}
        </Button>
      )}
    </form>
  );
}

export function RepackForm({ containerId, contents, idempotencyKey, others }: { containerId: string; contents: Content[]; idempotencyKey: string; others: OtherBox[] }) {
  const { state, pending, onSubmit } = useActionForm(repackAction.bind(null, containerId));
  const uom = contents[0]?.uom ?? "";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <LotPicker contents={contents} />
      <Field label={`How much to repack? (${uom})`} htmlFor="qty" error={state?.fieldErrors?.qty}>
        <Input id="qty" name="qty" inputMode="decimal" required autoComplete="off" />
      </Field>
      <Field label="Into which box?" htmlFor="toBox" error={state?.fieldErrors?.toBox}>
        <Select id="toBox" name="toBox" defaultValue="">
          <option value="">A new box (gets its own number)</option>
          {others.map((b) => (
            <option key={b.number} value={b.number}>
              {b.label} · {b.number}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Why?" htmlFor="reason" error={state?.fieldErrors?.reason}>
        <Textarea id="reason" name="reason" required minLength={3} maxLength={300} placeholder="e.g. Customer needs 24 per carton" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Repacking…" : "Repack"}
      </Button>
    </form>
  );
}

type LotOpt = { id: string; label: string; uom: string; locations: { id: string; code: string; name?: string; loose: string }[] };

const KIND_WORDS: Record<string, string> = { box: "Box", carton: "Carton", sack: "Sack", drum: "Drum", pallet: "Pallet", tote: "Tote", bag: "Bag", bottle: "Bottle", loose: "Loose (no box)" };

/**
 * Pack into a box or sack (grade-5, ADR-088): what (picked by name), from which shelf, how much; the kind,
 * "part box" and notes have defaults under More details. The box number is made by the system.
 */
export function NewBoxForm({ lots, initialLotId, idempotencyKey, kinds }: { lots: LotOpt[]; initialLotId?: string; idempotencyKey: string; kinds: readonly string[] }) {
  const { state, pending, onSubmit } = useActionForm(createBoxAction);
  const [lotId, setLotId] = useState(initialLotId && lots.some((l) => l.id === initialLotId) ? initialLotId : (lots[0]?.id ?? ""));
  const lot = lots.find((l) => l.id === lotId);
  const [locId, setLocId] = useState(lot?.locations[0]?.id ?? "");
  const loc = lot?.locations.find((l) => l.id === locId);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field label="What goes in?" htmlFor="lotId" error={fe.lotId}>
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
      {lot && lot.locations.length > 1 ? (
        <Field label="From which shelf?" htmlFor="locationId" error={fe.locationId}>
          <Select id="locationId" name="locationId" value={locId} onChange={(e) => setLocId(e.target.value)}>
            {lot.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name ?? l.code} · {fmtLotQty(l.loose, lot.uom)} loose
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <input type="hidden" name="locationId" value={locId} />
          {loc && lot && <p className="text-[14px] text-fg-2">From {loc.name ?? loc.code}: {fmtLotQty(loc.loose, lot.uom)} loose.</p>}
        </>
      )}
      <Field label={`How much goes in?${lot ? ` (${lot.uom})` : ""}`} htmlFor="qty" error={fe.qty}>
        <Input id="qty" name="qty" inputMode="decimal" required autoComplete="off" />
      </Field>
      <MoreDetails>
        <Field label="Box or sack?" htmlFor="containerKind">
          <Select id="containerKind" name="containerKind" defaultValue="box">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_WORDS[k] ?? k}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" name="isPartial" className="size-5 accent-[var(--primary)]" /> Not full (the label says PARTIAL)
        </label>
        <Field label="Notes" htmlFor="notes">
          <Input id="notes" name="notes" maxLength={300} />
        </Field>
      </MoreDetails>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Packing…" : "Pack it"}
      </Button>
    </form>
  );
}
