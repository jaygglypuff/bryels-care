"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { fmtLotQty } from "@/ui/inventory/bits";
import { useActionForm } from "../_kit/forms";
import { createBoxAction, mergeAction, repackAction, splitAction } from "./actions";

type Content = { lotId: string; lotNumber: string; itemName?: string; qty: string; uom: string };
/** Other boxes on the same shelf: picked by what is inside, never by typing a box number. */
type OtherBox = { number: string; label: string };

function LotPicker({ contents }: { contents: Content[] }) {
  if (contents.length <= 1) return contents[0] ? <input type="hidden" name="lotId" value={contents[0].lotId} /> : null;
  return (
    <ScanOrPick
      kind="lot"
      name="lotId"
      label="Which one?"
      candidates={contents.map((c) => ({ value: c.lotId, title: c.itemName || `Lot ${c.lotNumber}`, detail: `${fmtLotQty(c.qty, c.uom)} · lot ${c.lotNumber}`, code: c.lotNumber, codes: [c.lotNumber] }))}
      required
      onlyCandidates
      search={false}
    />
  );
}

const boxCands = (others: OtherBox[]): PickCandidate[] => others.map((b) => ({ value: b.number, title: b.label, detail: `box ${b.number}`, code: b.number, codes: [b.number] }));

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
      <ScanOrPick
        kind="container"
        name="others"
        submit="code"
        multiple
        label="Which boxes go together with this one?"
        hint="Same item, same QA state and the same shelf."
        candidates={boxCands(others)}
        candidatesLabel={others.length ? "Boxes on the same shelf" : undefined}
        required
        error={state?.fieldErrors?.others}
      />
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
      <ScanOrPick
        kind="container"
        name="toBox"
        submit="code"
        label="Into which box? (choose none for a new box)"
        candidates={boxCands(others)}
        candidatesLabel={others.length ? "Boxes on the same shelf" : undefined}
        error={state?.fieldErrors?.toBox}
      />
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

type LotOpt = { id: string; label: string; lotNumber?: string; uom: string; locations: { id: string; code: string; name?: string; loose: string }[] };

const KIND_WORDS: Record<string, string> = { box: "Box", carton: "Carton", sack: "Sack", drum: "Drum", pallet: "Pallet", tote: "Tote", bag: "Bag", bottle: "Bottle", loose: "Loose (no box)" };

/**
 * Pack into a box or sack (grade-5, ADR-088): what (picked by name), from which shelf, how much; the kind,
 * "part box" and notes have defaults under More details. The box number is made by the system.
 */
export function NewBoxForm({ lots, initialLotId, idempotencyKey, kinds }: { lots: LotOpt[]; initialLotId?: string; idempotencyKey: string; kinds: readonly string[] }) {
  const { state, pending, onSubmit } = useActionForm(createBoxAction);
  const [lotId, setLotId] = useState(initialLotId && lots.some((l) => l.id === initialLotId) ? initialLotId : lots.length === 1 ? lots[0].id : "");
  const lot = lots.find((l) => l.id === lotId);
  const [locId, setLocId] = useState(lot?.locations[0]?.id ?? "");
  const loc = lot?.locations.find((l) => l.id === locId);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <ScanOrPick
        kind="lot"
        name="lotId"
        label="What goes in?"
        candidates={lots.map((l) => ({ value: l.id, title: l.label, detail: l.locations.map((x) => `${fmtLotQty(x.loose, l.uom)} loose on ${x.name ?? x.code}`).join(" · "), code: l.lotNumber, codes: l.lotNumber ? [l.lotNumber] : [] }))}
        value={lotId || null}
        onlyCandidates
        required
        onChange={(v) => {
          if ((v ?? "") === lotId) return;
          setLotId(v ?? "");
          setLocId(lots.find((l) => l.id === v)?.locations[0]?.id ?? "");
        }}
        error={fe.lotId}
      />
      {lot && lot.locations.length > 0 && (
        <ScanOrPick
          kind="location"
          name="locationId"
          label="From which shelf?"
          candidates={lot.locations.map((l) => ({ value: l.id, title: l.name ?? l.code, detail: `${l.code} · ${fmtLotQty(l.loose, lot.uom)} loose`, code: l.code, codes: [l.code] }))}
          value={locId || null}
          hideWhenSingle
          onlyCandidates
          search={false}
          required
          onChange={(v) => v !== locId && setLocId(v ?? "")}
          error={fe.locationId}
        />
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
