"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { fmtFriendly } from "@/lib/units";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { MoreDetails } from "@/ui/guide";
import { useActionForm } from "../_kit/forms";
import { approveCountAction, findLotsForCountAction, planCountAction, recordCountAction, recountAction, rejectLinesAction } from "./actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function PlanCountForm({ locations, counters, kinds }: { locations: { id: string; code: string; name: string; kind: string }[]; counters: { id: string; name: string }[]; kinds: readonly string[] }) {
  const { state, pending, onSubmit } = useActionForm(planCountAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[14px] font-medium">Which shelves? (nobody can move stock on them until the count is finished)</legend>
        {fe.locationIds && <p className="mb-1 text-[12px] text-[var(--bad-fg)]">{fe.locationIds}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {locations.map((l) => (
            <label key={l.id} className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line px-2 text-[14px]">
              <input type="checkbox" name="locationIds" value={l.id} className="size-5 shrink-0 accent-[var(--primary)]" />
              <span className="min-w-0 break-words"><span className="font-medium">{l.name}</span> <span className="font-mono text-[12px] text-muted">{l.code}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[13px] font-medium">Who counts (they cannot approve this count)</legend>
        {counters.length === 0 ? (
          <p className="text-[13px] text-muted">No users at this site may enter counts. Anyone with count rights can count when no counter is chosen.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {counters.map((c) => (
              <label key={c.id} className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line px-2 text-[14px]">
                <input type="checkbox" name="counterUserIds" value={c.id} className="size-5 accent-[var(--primary)]" /> {c.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <MoreDetails>
        <Field label="A few shelves or everything?" htmlFor="countKind">
          <Select id="countKind" name="countKind" defaultValue="cycle">
            {kinds.map((k) => (
              <option key={k} value={k}>{k === "cycle" ? "A few shelves" : k === "full" ? "Everything" : k}</option>
            ))}
          </Select>
        </Field>
        <Field label="Day of the count" htmlFor="scheduledFor" error={fe.scheduledFor} hint="Empty: today.">
          <Input id="scheduledFor" name="scheduledFor" type="date" />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" name="isBlind" defaultChecked className="size-5 accent-[var(--primary)]" /> Counters do not see how much should be there (better counts)
        </label>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" maxLength={500} />
        </Field>
      </MoreDetails>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Planning…" : "Plan the count"}
      </Button>
    </form>
  );
}

/** "Not in the list? Find it by name": the keyword look-up (ADR-085) for a lot found on the wrong shelf. */
function FindByWords({ onPick, id }: { onPick: (lotNumber: string) => void; id: string }) {
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const [res, setRes] = useState<{ lots: { lotNumber: string; title: string; detail: string }[]; message: string | null }>({ lots: [], message: null });
  const find = () =>
    start(async () => {
      const r = await findLotsForCountAction(text);
      setRes(r.ok ? { lots: r.lots, message: r.lots.length > 1 ? `${r.lots.length} lots match. Tap the right one.` : null } : { lots: [], message: r.message });
      if (r.ok && r.lots.length === 1) onPick(r.lots[0].lotNumber);
    });
  return (
    <MoreDetails title="Not in the list and no barcode? Find it by name">
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">Item name</label>
        <Input
          id={id}
          value={text}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="e.g. coconut oil"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" onClick={find} disabled={busy}>
          {busy ? "…" : "Find"}
        </Button>
      </div>
      {res.message && <p className="text-[13px] text-fg-2" role="status">{res.message}</p>}
      {res.lots.length > 1 && (
        <ul className="flex flex-col gap-2" aria-label="Matching lots">
          {res.lots.map((o) => (
            <li key={o.lotNumber}>
              <button type="button" onClick={() => onPick(o.lotNumber)} className="flex min-h-[52px] w-full flex-col items-start rounded-[12px] border border-line px-3 py-2 text-left hover:bg-surface-2">
                <span className="text-[14px] font-semibold">{o.title} <span className="font-mono text-[12px] font-normal text-muted">{o.lotNumber}</span></span>
                <span className="text-[13px] text-muted">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </MoreDetails>
  );
}

export type ShelfLine ={ lotNumber: string | null; itemName: string | null; baseUom: string | null; counted: boolean; mine: string | null; unlabelled: boolean; description: string | null };

/**
 * Count one shelf (usability test 2026-10-30): "Shelf B-01: scan each sack and type how much". The lots
 * expected on the shelf are listed (without amounts when counting without seeing the expected amount);
 * the amount box has a unit picker (kg/g, L/mL, pcs) and the server converts to the lot's base unit.
 * Every option is at least 44 px tall.
 */
export function ShelfCountForm({ countId, location, lines }: { countId: string; location: { id: string; code: string }; lines: ShelfLine[] }) {
  const [key, setKey] = useState(newKey);
  const { state, pending, onSubmit } = useActionForm(recordCountAction.bind(null, countId));
  const [mode, setMode] = useState<"lot" | "unlabelled">("lot");
  const [lotCode, setLotCode] = useState("");
  const [qty, setQty] = useState("");
  const lotRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state?.ok) {
      setKey(newKey());
      setLotCode("");
      setQty("");
      lotRef.current?.focus();
    }
  }, [state]);
  const fe = state?.fieldErrors ?? {};
  const typed = lotCode.trim().toUpperCase().replace(/^BC:LOT:/, "");
  const known = lines.find((l) => l.lotNumber && l.lotNumber === typed);
  // The lots expected on this shelf, as buttons by name (never type a lot number; ADR-088).
  const expected = lines.filter((l, i) => l.lotNumber && lines.findIndex((x) => x.lotNumber === l.lotNumber) === i);
  const baseUom = mode === "lot" && known?.baseUom ? known.baseUom : "*";
  const id = (f: string) => `${f}-${location.code}`;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid={`shelf-form-${location.code}`}>
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="locationId" value={location.id} />
      {lines.length > 0 && (
        <ul className="divide-y divide-line rounded-[12px] border border-line text-[14px]" aria-label={`What should be on ${location.code}`}>
          {lines.map((l, i) => (
            <li key={`${l.lotNumber ?? "x"}-${i}`} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                {l.unlabelled ? (
                  <span className="font-medium">No label: {l.description}</span>
                ) : (
                  <>
                    <span className="font-medium">{l.itemName}</span> <span className="font-mono text-[12px] text-muted">{l.lotNumber}</span>
                  </>
                )}
              </span>
              <span className={l.counted ? "font-medium text-[var(--ok-fg)]" : "text-muted"}>{l.mine ? `You counted ${l.mine}` : l.counted ? "Counted" : "Not counted yet"}</span>
            </li>
          ))}
        </ul>
      )}
      <div role="radiogroup" aria-label="Does it have a label?" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[12px] border border-line px-3 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
          <input type="radio" name={id("mode")} checked={mode === "lot"} onChange={() => setMode("lot")} className="size-5 accent-[var(--primary)]" /> It has a label
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[12px] border border-line px-3 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
          <input type="radio" name={id("mode")} checked={mode === "unlabelled"} onChange={() => setMode("unlabelled")} className="size-5 accent-[var(--primary)]" /> No label (I found it here)
        </label>
      </div>
      {mode === "lot" ? (
        <div className="flex flex-col gap-2">
          {known ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-surface-2 px-3 py-2 text-[14px]">
              <span className="min-w-0"><span className="font-semibold">{known.itemName}</span> <span className="font-mono text-[12px] text-muted">{known.lotNumber}</span></span>
              <Button type="button" variant="ghost" onClick={() => { setLotCode(""); lotRef.current?.focus(); }}>Change</Button>
            </div>
          ) : (
            expected.length > 0 && (
              <div>
                <p className="mb-1.5 text-[14px] font-medium">Tap what you are counting</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {expected.map((l) => (
                    <button key={l.lotNumber!} type="button" onClick={() => setLotCode(l.lotNumber!)} className="flex min-h-[48px] flex-col items-start justify-center rounded-[12px] border border-line px-3 py-1.5 text-left hover:bg-surface-2">
                      <span className="text-[14px] font-semibold">{l.itemName}</span>
                      <span className="font-mono text-[12px] text-muted">{l.lotNumber}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          <Field label={known ? "Lot (from the label)" : "Or scan the label"} htmlFor={id("lotCode")} error={fe.lotCode}>
            <Input ref={lotRef} id={id("lotCode")} name="lotCode" autoComplete="off" autoCapitalize="characters" placeholder="Scan the label" className="min-h-[52px] font-mono text-[16px]" value={lotCode} onChange={(e) => setLotCode(e.target.value)} />
          </Field>
          {!known && <FindByWords onPick={(n) => setLotCode(n)} id={id("words")} />}
        </div>
      ) : (
        <Field label="What is it? (QA will find out)" htmlFor={id("unlabelled")}>
          <Input id={id("unlabelled")} name="unlabelled" maxLength={300} placeholder="e.g. white 5 kg pail, no label, behind the rack" className="min-h-[52px]" />
        </Field>
      )}
      <Field label={known?.itemName ? `How much ${known.itemName} is there?` : "How much is there?"} htmlFor={id("qty")} error={fe.qty}>
        <QtyUnitInput id={id("qty")} name="qty" unitName="qtyUom" baseUom={baseUom} qty={qty} onQtyChange={setQty} required big />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Saving…" : `Save this amount for ${location.code}`}
      </Button>
    </form>
  );
}

export function RecountForm({ countId, lineId, label, baseUom }: { countId: string; lineId: string; label: string; baseUom: string | null }) {
  const [key] = useState(newKey);
  const { state, pending, onSubmit } = useActionForm(recountAction.bind(null, countId, lineId));
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label={`Count again: ${label}`} htmlFor={`rc-${lineId}`} error={state?.fieldErrors?.qty}>
        <QtyUnitInput id={`rc-${lineId}`} name="qty" unitName="qtyUom" baseUom={baseUom ?? "*"} required />
      </Field>
      <div>
        <Button type="submit" variant="secondary" size="lg" disabled={pending || state?.ok}>
          {pending ? "Saving…" : "Save the new count"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** "-1500" g → "−1.5 kg"; differences get a sign. */
function amt(v: string, uom: string, signed = false) {
  if (!/^-?\d/.test(v)) return v;
  const neg = v.startsWith("-");
  const t = uom ? fmtFriendly(neg ? v.slice(1) : v, uom) : v.replace(/^-/, "");
  return `${neg ? "−" : signed && Number(v) !== 0 ? "+" : ""}${t}`;
}

type ReviewLine = { id: string; label: string; expected: string; first: string; recount: string | null; final: string; variance: string; pct: string | null; reasonCode: string | null; auto: boolean; uom: string };

/** Differences review (ux §9.6): expected, counted, counted again, difference, reason per line; approve or send back. */
export function ApproveForm({ countId, lines, reasons, step }: { countId: string; lines: ReviewLine[]; reasons: readonly { code: string; label: string }[]; step: 1 | 2 }) {
  const { state, pending, onSubmit, confirmBox } = useActionForm(approveCountAction.bind(null, countId), step === 2 ? "Give the second OK for these differences?" : undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {/* One card per line (phone 390 px: no table to scroll sideways; ADR-088). */}
      <ul className="flex flex-col gap-2" aria-label="Differences to check">
        {lines.map((l) => (
          <li key={l.id} className="rounded-[16px] border border-line p-3" data-testid="count-review-line">
            <p className="text-[15px] font-semibold">{l.label}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] tabular sm:grid-cols-4">
              <div><dt className="text-muted">Should be</dt><dd>{amt(l.expected, l.uom)}</dd></div>
              <div><dt className="text-muted">Counted</dt><dd>{amt(l.first, l.uom)}</dd></div>
              <div><dt className="text-muted">Counted again</dt><dd>{l.recount ? amt(l.recount, l.uom) : "—"}</dd></div>
              <div>
                <dt className="text-muted">Difference</dt>
                <dd className="font-semibold">
                  {amt(l.variance, l.uom, true)}
                  {l.pct ? ` (${Number(l.pct).toFixed(1)} %)` : ""}
                </dd>
              </div>
            </dl>
            <div className="mt-2 text-[13px]">
              {l.auto ? (
                <span className="text-muted">Small difference: OK by the rule.</span>
              ) : step === 1 ? (
                <>
                  <label htmlFor={`reason_${l.id}`} className="mb-1 block font-medium">Why is it different?</label>
                  <Select id={`reason_${l.id}`} name={`reason_${l.id}`} defaultValue={l.reasonCode ?? ""} aria-label={`Reason for ${l.label}`} className="w-full sm:max-w-[320px]">
                    <option value="">Choose…</option>
                    {reasons.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </Select>
                  {fe[`reason_${l.id}`] && <p className="text-[12px] text-[var(--bad-fg)]">{fe[`reason_${l.id}`]}</p>}
                </>
              ) : (
                <span>Why: {reasons.find((r) => r.code === l.reasonCode)?.label ?? (l.reasonCode ?? "—").replace(/_/g, " ")}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Field label="Note (optional)" htmlFor="note">
        <Input id="note" name="note" maxLength={500} />
      </Field>
      <FormMessage state={state} />
      {confirmBox ?? (
        <Button type="submit" variant="cta" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Approving…" : step === 2 ? "Give second OK" : "Approve the differences"}
        </Button>
      )}
    </form>
  );
}

export function RejectLinesForm({ countId, lines }: { countId: string; lines: { id: string; label: string }[] }) {
  const { state, pending, onSubmit } = useActionForm(rejectLinesAction.bind(null, countId));
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Ask to count some lines again
      </Button>
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
      <div className="flex flex-col gap-1">
        {lines.map((l) => (
          <label key={l.id} className="flex min-h-[44px] items-center gap-2 text-[14px]">
            <input type="checkbox" name="lineIds" value={l.id} className="size-5 accent-[var(--primary)]" /> {l.label}
          </label>
        ))}
      </div>
      <Field label="Why count again?" htmlFor="rj-reason" error={state?.fieldErrors?.reason}>
        <Input id="rj-reason" name="reason" required minLength={3} maxLength={300} />
      </Field>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Sending…" : "Send back"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
      </div>
    </form>
  );
}
