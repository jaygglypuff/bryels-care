"use client";
import { useMemo, useState } from "react";
import { Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { finishBatchAction } from "./actions";

/**
 * Finish screen (ADR-080 §6, UX review S6). Read-back first: good pieces and rejects from the daily log
 * with "Change"; the only typed fields are damaged and left-over wrappers, with a live balance line.
 * The live numbers are a preview only: the server recounts and refuses anything that does not add up.
 */
export type FinishFormProps = {
  batchId: string;
  batchNumber: string;
  orderId: string | null;
  pieceWord: string;
  expected: string | null;
  unitNetMassG: string;
  theoreticalYieldG: string | null;
  limits: { min: number; max: number };
  log: { entries: number; days: number; good: string; rejects: { type: string; qty: string }[] };
  existingScrap: { qty: string; note: string | null }[];
  defectTypes: string[];
  samples: number;
  packaging: { materialId: string; materialName: string; uom: string; taken: string; counted: boolean; used: string; damaged: string; leftOver: string }[];
  hold: { id: string; code: string; name: string } | null;
  holdOptions: { id: string; code: string; name: string }[];
  needsChecker: boolean;
  checkers: { id: string; displayName: string }[];
  requirePassword: boolean;
};

const n = (v: string) => {
  const x = Number(v.replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};

function Count({ id, label, value, onChange, error, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <Input id={id} name={id} inputMode="numeric" pattern="[0-9]*" autoComplete="off" className="min-h-[56px] text-[20px] font-semibold" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} />
    </Field>
  );
}

export function FinishForm(p: FinishFormProps) {
  const [state, dispatch] = useInPlaceAction(finishBatchAction);
  const fe = state?.fieldErrors ?? {};
  const fromLog = p.log.entries > 0 && Number(p.log.good) > 0;
  const [change, setChange] = useState(!fromLog);
  const [good, setGood] = useState(fromLog ? String(Number(p.log.good)) : "");
  const logRejects = Object.fromEntries(p.log.rejects.map((r) => [r.type, String(Number(r.qty))]));
  const types = [...new Set([...p.defectTypes, ...p.log.rejects.map((r) => r.type)])];
  const [rejects, setRejects] = useState<Record<string, string>>(Object.fromEntries(types.map((t) => [t, logRejects[t] ?? ""])));
  const [samples, setSamples] = useState(String(p.samples));
  const [wrapped, setWrapped] = useState("0");
  const [pkg, setPkg] = useState<Record<string, { damaged: string; leftOver: string; used: string }>>(Object.fromEntries(p.packaging.map((m) => [m.materialId, { damaged: "", leftOver: "", used: "" }])));
  const rejectTotal = p.existingScrap.length ? p.existingScrap.reduce((t, r) => t + n(r.qty), 0) : Object.values(rejects).reduce((t, v) => t + n(v), 0);
  const goodN = n(good);
  const yieldPct = useMemo(() => {
    const theo = n(p.theoreticalYieldG ?? "0");
    return theo > 0 && goodN > 0 ? Math.round(((goodN * n(p.unitNetMassG)) / theo) * 1000) / 10 : null;
  }, [goodN, p.theoreticalYieldG, p.unitNetMassG]);
  const outside = yieldPct !== null && (yieldPct < p.limits.min || yieldPct > p.limits.max);
  const balances = p.packaging.map((m) => {
    if (m.counted) return { ...m, used: n(m.used), damaged: n(m.damaged), left: n(m.leftOver), diff: n(m.taken) - n(m.used) - n(m.damaged) - n(m.leftOver) };
    const v = pkg[m.materialId];
    const used = v.used ? n(v.used) : goodN + n(wrapped);
    const diff = n(m.taken) - used - n(v.damaged) - n(v.leftOver);
    return { ...m, used, damaged: n(v.damaged), left: n(v.leftOver), diff };
  });
  const unbalanced = balances.some((b) => b.diff !== 0);
  const where = p.hold ? `${p.hold.name} (${p.hold.code})` : "the hold area";

  return (
    <form
      action={dispatch}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        if (!window.confirm(`Finish batch ${p.batchNumber}? ${goodN} ${p.pieceWord} go to ${where} for the quality check. You can't change the counts after this.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="batchId" value={p.batchId} />
      {p.orderId && <input type="hidden" name="orderId" value={p.orderId} />}
      <input type="hidden" name="countsFromLog" value={fromLog ? "yes" : "no"} />
      <input type="hidden" name="changeCounts" value={change ? "yes" : "no"} />
      <input type="hidden" name="rejectTypes" value={types.join("|")} />
      <input type="hidden" name="materialIds" value={p.packaging.filter((m) => !m.counted).map((m) => m.materialId).join(",")} />

      <section className="rounded-[16px] border border-line p-4" aria-labelledby="fin-counts">
        <h2 id="fin-counts" className="text-[16px] font-semibold">
          What was made
        </h2>
        {fromLog && !change ? (
          <ul className="mt-2 space-y-1 text-[15px]">
            <li>
              Good {p.pieceWord}: <b>{goodN}</b> <span className="text-muted">(from {p.log.days} {p.log.days === 1 ? "day" : "days"} in the log)</span>
            </li>
            <li>
              Rejects: <b>{rejectTotal}</b>
              {p.log.rejects.length > 0 && <span className="text-muted"> ({p.log.rejects.map((r) => `${r.type} ${Number(r.qty)}`).join(", ")})</span>}
            </li>
            <li>
              <button type="button" className="text-[14px] font-semibold text-primary-text underline" onClick={() => setChange(true)}>
                Change
              </button>
            </li>
          </ul>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Count id="goodUnits" label={`Good ${p.pieceWord}`} value={good} onChange={setGood} error={fe.goodUnits} hint={fromLog ? `The log says ${Number(p.log.good)}.` : "Nothing was written in the daily log. Count them now."} />
            {p.existingScrap.length > 0 ? (
              <p className="text-[14px] text-muted sm:col-span-2">Rejects already recorded on the batch screen: {rejectTotal}.</p>
            ) : (
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-[14px] font-semibold">Rejects by type</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {types.map((t, i) => (
                    <Field key={t} label={t} htmlFor={`reject-${i}`} error={fe[`rejects.${i}.qty`] ?? fe[`rejects.${i}.type`]}>
                      <Input id={`reject-${i}`} name={`reject-${i}`} inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={rejects[t]} onChange={(e) => setRejects({ ...rejects, [t]: e.target.value.replace(/[^0-9]/g, "") })} />
                    </Field>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Count id="samplesKept" label="Samples kept" value={samples} onChange={setSamples} error={fe.samplesKept} hint={`Taken from the good ${p.pieceWord}; ${Math.max(goodN - n(samples), 0)} left to sell.`} />
        </div>
        <p className={cx("mt-3 text-[15px]", outside ? "font-semibold text-[var(--warn-fg)]" : "text-fg-2")} data-testid="made-vs-expected">
          {p.expected ? `Expected ${p.expected}, made ${goodN || "—"}` : `Made ${goodN || "—"}`}
          {yieldPct !== null ? ` (${yieldPct} %)` : ""} {outside ? `· outside ${p.limits.min}–${p.limits.max} %` : yieldPct !== null ? "· OK" : ""}
        </p>
        {(outside || fe.problemReason) && (
          <div className="mt-3">
            <Field label="What happened? (a problem report is opened for QA)" htmlFor="problemReason" error={fe.problemReason}>
              <Textarea id="problemReason" name="problemReason" rows={2} maxLength={1000} required={outside} />
            </Field>
          </div>
        )}
      </section>

      {p.packaging.length > 0 && (
        <section className="rounded-[16px] border border-line p-4" aria-labelledby="fin-wrappers">
          <h2 id="fin-wrappers" className="text-[16px] font-semibold">
            Wrappers and labels
          </h2>
          {balances.map((b) => (
            <div key={b.materialId} className="mt-3">
              <p className="text-[15px] font-medium">
                {b.materialName}: taken {Number(b.taken)}
              </p>
              {b.counted ? (
                <p className="text-[14px] text-muted">Counted at the wrapping step: {b.used} used, {b.damaged} damaged, {b.left} left over.</p>
              ) : (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Count id={`pkg-${b.materialId}-damaged`} label="Damaged" value={pkg[b.materialId].damaged} onChange={(v) => setPkg({ ...pkg, [b.materialId]: { ...pkg[b.materialId], damaged: v } })} error={fe[`pkg-${b.materialId}-damaged`]} />
                  <Count id={`pkg-${b.materialId}-leftOver`} label="Left over" value={pkg[b.materialId].leftOver} onChange={(v) => setPkg({ ...pkg, [b.materialId]: { ...pkg[b.materialId], leftOver: v } })} error={fe[`pkg-${b.materialId}-leftOver`]} />
                </div>
              )}
              <p className={cx("mt-2 text-[15px]", b.diff === 0 ? "text-[var(--ok-fg)]" : "font-semibold text-[var(--bad-fg)]")} data-testid={`balance-${b.materialId}`} role="status">
                {Number(b.taken)} taken = {b.used} used + {b.damaged} damaged + {b.left} left over {b.diff === 0 ? "✓" : b.diff > 0 ? `· ${b.diff} missing. Count again.` : `· ${-b.diff} too many. Count again.`}
              </p>
              {fe[`pkg-${b.materialId}`] && <p className="text-[14px] text-[var(--bad-fg)]">{fe[`pkg-${b.materialId}`]}</p>}
            </div>
          ))}
        </section>
      )}

      {p.needsChecker && (
        <fieldset className="grid gap-3 rounded-[16px] border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-[14px] font-semibold">Checked by</legend>
          <Field label="Name" htmlFor="checkerId" error={fe.checkerId}>
            <Select id="checkerId" name="checkerId" required defaultValue="">
              <option value="">Choose…</option>
              {p.checkers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </Field>
          {p.requirePassword && (
            <Field label="Their password (typed by them)" htmlFor="checkerPassword" error={fe.checkerPassword}>
              <Input id="checkerPassword" name="checkerPassword" type="password" autoComplete="off" required />
            </Field>
          )}
        </fieldset>
      )}

      <p className="text-[15px]">
        Goes to: <b>{where}</b>
      </p>

      <details className="rounded-[16px] border border-line p-4">
        <summary className="cursor-pointer text-[15px] font-semibold">More details</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Count id="rejectsWrapped" label="Rejects that were already wrapped" value={wrapped} onChange={setWrapped} error={fe.rejectsWrapped} hint="They used a wrapper, so they count as wrappers used." />
          <Field label="Hold area" htmlFor="locationRef" error={fe.locationRef ?? fe.location}>
            <Select id="locationRef" name="locationRef" defaultValue={p.hold?.id ?? ""}>
              {p.holdOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </option>
              ))}
            </Select>
          </Field>
          {p.packaging
            .filter((m) => !m.counted)
            .map((m) => (
              <Count key={m.materialId} id={`pkg-${m.materialId}-used`} label={`${m.materialName} used (only if not one per piece)`} value={pkg[m.materialId].used} onChange={(v) => setPkg({ ...pkg, [m.materialId]: { ...pkg[m.materialId], used: v } })} error={fe[`pkg-${m.materialId}-used`]} />
            ))}
        </div>
      </details>

      <FormMessage state={state} />
      <div>
        <SubmitButton size="lg" pendingText="Finishing…" disabled={unbalanced || goodN <= 0}>
          {outside ? "Finish and report the problem" : "Finish batch"}
        </SubmitButton>
        {unbalanced && <p className="mt-2 text-[14px] text-muted">The wrappers do not add up yet. Count again; if they still do not add up, use Report a problem on the batch page.</p>}
      </div>
    </form>
  );
}
