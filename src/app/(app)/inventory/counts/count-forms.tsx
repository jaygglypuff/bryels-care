"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../_kit/forms";
import { approveCountAction, planCountAction, recordCountAction, recountAction, rejectLinesAction } from "./actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function PlanCountForm({ locations, counters, kinds }: { locations: { id: string; code: string; name: string; kind: string }[]; counters: { id: string; name: string }[]; kinds: readonly string[] }) {
  const { state, pending, onSubmit } = useActionForm(planCountAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind" htmlFor="countKind">
          <Select id="countKind" name="countKind" defaultValue="cycle">
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
        </Field>
        <Field label="Scheduled for (optional)" htmlFor="scheduledFor" error={fe.scheduledFor}>
          <Input id="scheduledFor" name="scheduledFor" type="date" />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 self-end text-[13px]">
          <input type="checkbox" name="isBlind" defaultChecked className="size-4 accent-[var(--primary)]" /> Blind count (counters do not see quantities)
        </label>
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[13px] font-medium">Locations to count and freeze</legend>
        {fe.locationIds && <p className="mb-1 text-[12px] text-[var(--bad-fg)]">{fe.locationIds}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {locations.map((l) => (
            <label key={l.id} className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line px-2 text-[13px]">
              <input type="checkbox" name="locationIds" value={l.id} className="size-4 accent-[var(--primary)]" />
              <span className="min-w-0 truncate"><span className="font-mono font-semibold">{l.code}</span> <span className="text-muted">{l.kind}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[13px] font-medium">Counters (they cannot approve this count)</legend>
        {counters.length === 0 ? (
          <p className="text-[13px] text-muted">No users at this site may enter counts. Anyone with count rights can count when no counter is chosen.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {counters.map((c) => (
              <label key={c.id} className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line px-2 text-[13px]">
                <input type="checkbox" name="counterUserIds" value={c.id} className="size-4 accent-[var(--primary)]" /> {c.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <Field label="Notes (optional)" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={500} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Planning…" : "Plan count"}
      </Button>
    </form>
  );
}

/** Count capture: scan location (choose), scan lot, type the quantity (blind). */
export function CaptureForm({ countId, locations }: { countId: string; locations: { id: string; code: string; done: boolean }[] }) {
  const [key, setKey] = useState(newKey);
  const { state, pending, onSubmit } = useActionForm(recordCountAction.bind(null, countId));
  const [mode, setMode] = useState<"lot" | "unlabelled">("lot");
  const lotRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state?.ok) {
      setKey(newKey());
      if (lotRef.current) lotRef.current.value = "";
      lotRef.current?.focus();
    }
  }, [state]);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label="Location" htmlFor="locationId" error={fe.locationId}>
        <Select id="locationId" name="locationId" defaultValue={locations.find((l) => !l.done)?.id ?? locations[0]?.id}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code}{l.done ? " · done" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex gap-2 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "lot"} onChange={() => setMode("lot")} className="accent-[var(--primary)]" /> Labelled lot</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "unlabelled"} onChange={() => setMode("unlabelled")} className="accent-[var(--primary)]" /> No label (found)</label>
      </div>
      {mode === "lot" ? (
        <Field label="Scan the lot label" htmlFor="lotCode" error={fe.lotCode}>
          <Input ref={lotRef} id="lotCode" name="lotCode" autoComplete="off" autoCapitalize="characters" placeholder="BC:LOT:L-2610-00001" className="font-mono" />
        </Field>
      ) : (
        <Field label="Describe the item (QA will identify it)" htmlFor="unlabelled">
          <Input id="unlabelled" name="unlabelled" maxLength={300} placeholder="e.g. white 5 kg pail, no label, behind rack A" />
        </Field>
      )}
      <Field label="Counted quantity (base unit)" htmlFor="qty" error={fe.qty}>
        <Input id="qty" name="qty" inputMode="decimal" autoComplete="off" required className="min-h-[52px] text-[18px] tabular" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save count"}
      </Button>
    </form>
  );
}

export function RecountForm({ countId, lineId, label }: { countId: string; lineId: string; label: string }) {
  const [key] = useState(newKey);
  const { state, pending, onSubmit } = useActionForm(recountAction.bind(null, countId, lineId));
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label={`Recount ${label}`} htmlFor={`rc-${lineId}`} error={state?.fieldErrors?.qty}>
        <Input id={`rc-${lineId}`} name="qty" inputMode="decimal" required className="w-36 tabular" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending || state?.ok}>
        {pending ? "Saving…" : "Save recount"}
      </Button>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

type ReviewLine = { id: string; label: string; expected: string; first: string; recount: string | null; final: string; variance: string; pct: string | null; reasonCode: string | null; auto: boolean; uom: string };

/** Variance review table (ux §9.6): expected, counted, recount, variance, reason per line; approve or send back. */
export function ApproveForm({ countId, lines, reasons, step }: { countId: string; lines: ReviewLine[]; reasons: readonly { code: string; label: string }[]; step: 1 | 2 }) {
  const { state, pending, onSubmit } = useActionForm(approveCountAction.bind(null, countId), step === 2 ? "Give the second approval for these variances?" : undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[16px] border border-line">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Counted</th><th className="px-3 py-2">Recount</th><th className="px-3 py-2">Variance</th><th className="px-3 py-2">Reason</th></tr>
          </thead>
          <tbody className="divide-y divide-line tabular">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{l.label}</td>
                <td className="px-3 py-2">{l.expected}</td>
                <td className="px-3 py-2">{l.first}</td>
                <td className="px-3 py-2">{l.recount ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{l.variance} {l.uom}{l.pct ? ` (${Number(l.pct).toFixed(1)} %)` : ""}</td>
                <td className="px-3 py-2">
                  {l.auto ? (
                    <span className="text-muted">auto-approved</span>
                  ) : step === 1 ? (
                    <>
                      <Select name={`reason_${l.id}`} defaultValue={l.reasonCode ?? ""} aria-label={`Reason for ${l.label}`} className="min-w-[160px]">
                        <option value="">Choose…</option>
                        {reasons.map((r) => (
                          <option key={r.code} value={r.code}>{r.label}</option>
                        ))}
                      </Select>
                      {fe[`reason_${l.id}`] && <p className="text-[12px] text-[var(--bad-fg)]">{fe[`reason_${l.id}`]}</p>}
                    </>
                  ) : (
                    (l.reasonCode ?? "—").replace(/_/g, " ")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Approval note (optional)" htmlFor="note">
        <Input id="note" name="note" maxLength={500} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Approving…" : step === 2 ? "Give second approval" : "Approve variances"}
      </Button>
    </form>
  );
}

export function RejectLinesForm({ countId, lines }: { countId: string; lines: { id: string; label: string }[] }) {
  const { state, pending, onSubmit } = useActionForm(rejectLinesAction.bind(null, countId));
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Send lines back for recount</Button>;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
      <div className="flex flex-col gap-1">
        {lines.map((l) => (
          <label key={l.id} className="flex min-h-[40px] items-center gap-2 text-[13px]"><input type="checkbox" name="lineIds" value={l.id} className="size-4 accent-[var(--primary)]" /> {l.label}</label>
        ))}
      </div>
      <Field label="Why recount?" htmlFor="rj-reason" error={state?.fieldErrors?.reason}>
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
