"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { finishBatchAction } from "./actions";

/**
 * Finish screen (ADR-080 §6, UX review S6). Read-back first: good pieces and rejects from the daily log
 * with "Change"; damaged wrappers come from the packaging step when it recorded them (typed once,
 * consultant review), so usually only the left-over wrappers are typed, with a live balance line.
 * "Finish batch" checks the form first, then asks in the page (no browser pop-up): "You can't change
 * the counts after this. [Yes, finish] [Back]". The live numbers are a preview only: the server
 * recounts and refuses anything that does not add up.
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
  packaging: { materialId: string; materialName: string; uom: string; taken: string; counted: boolean; used: string; damaged: string; leftOver: string; step: { stepNo: number; used: string | null; damaged: string | null; leftOver: string | null } | null }[];
  rejectApproval: { limit: string | null; existingNeedsApproval: boolean; reportOpen: boolean };
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
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  // Kept in state so a server error does not clear them (React resets uncontrolled fields after an action).
  const [checkerId, setCheckerId] = useState("");
  const [checkerPassword, setCheckerPassword] = useState("");
  const [problemReason, setProblemReason] = useState("");
  const [locationRef, setLocationRef] = useState(p.hold?.id ?? "");
  useEffect(() => {
    if (state) setConfirming(false);
  }, [state]);
  const fromLog = p.log.entries > 0 && Number(p.log.good) > 0;
  const [change, setChange] = useState(!fromLog);
  const [good, setGood] = useState(fromLog ? String(Number(p.log.good)) : "");
  const logRejects = Object.fromEntries(p.log.rejects.map((r) => [r.type, String(Number(r.qty))]));
  const types = [...new Set([...p.defectTypes, ...p.log.rejects.map((r) => r.type)])];
  const [rejects, setRejects] = useState<Record<string, string>>(Object.fromEntries(types.map((t) => [t, logRejects[t] ?? ""])));
  const [samples, setSamples] = useState(String(p.samples));
  const [wrapped, setWrapped] = useState("0");
  const [pkg, setPkg] = useState<Record<string, { damaged: string; leftOver: string; used: string }>>(
    Object.fromEntries(p.packaging.map((m) => [m.materialId, { damaged: m.step?.damaged !== null && m.step?.damaged !== undefined ? String(Number(m.step.damaged)) : "", leftOver: m.step?.leftOver !== null && m.step?.leftOver !== undefined ? String(Number(m.step.leftOver)) : "", used: "" }])),
  );
  const [editStep, setEditStep] = useState<Record<string, boolean>>({});
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
  const where = (p.holdOptions.find((l) => l.id === locationRef) ?? p.hold)?.name ?? "the hold area";
  const whereCode = (p.holdOptions.find((l) => l.id === locationRef) ?? p.hold)?.code;
  // Same rule as the server: rejects above the approval limit (or earlier scrap waiting for approval) need a problem report.
  const overLimit = !p.rejectApproval.reportOpen && (p.rejectApproval.existingNeedsApproval || (p.existingScrap.length === 0 && p.rejectApproval.limit !== null && rejectTotal > n(p.rejectApproval.limit)));
  const needsReport = (outside && !p.rejectApproval.reportOpen) || overLimit;

  /** Checks what the page can check before asking for the final yes; the server checks everything again. */
  function check(): string[] {
    const out: string[] = [];
    if (goodN <= 0) out.push(`Enter the good ${p.pieceWord}.`);
    if (n(samples) >= goodN && goodN > 0) out.push(`Samples kept must be fewer than the good ${p.pieceWord}.`);
    if (unbalanced) out.push("The wrappers do not add up yet. Count again.");
    if (needsReport && problemReason.trim().length < 10) out.push("Write what happened (at least 10 characters).");
    if (p.needsChecker && !checkerId) out.push("Choose who checked.");
    if (p.needsChecker && p.requirePassword && !checkerPassword) out.push("The checker types their password.");
    return out;
  }
  function askToConfirm() {
    const errs = check();
    setProblems(errs);
    if (errs.length === 0 && formRef.current?.reportValidity()) setConfirming(true);
  }

  return (
    <form
      ref={formRef}
      action={dispatch}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        // Enter in a field must not finish without the in-page confirmation.
        if (!confirming) {
          e.preventDefault();
          askToConfirm();
        }
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
        {overLimit && (
          <p className="mt-2 text-[15px] font-semibold text-[var(--warn-fg)]" data-testid="rejects-over-limit">
            {p.rejectApproval.existingNeedsApproval ? "Rejects recorded earlier are waiting for approval." : `${rejectTotal} rejects is more than the ${Math.floor(n(p.rejectApproval.limit ?? "0"))} allowed without a report.`}
          </p>
        )}
        {(needsReport || fe.problemReason) && (
          <div className="mt-3">
            <Field label="What happened? (a problem report is opened for QA)" htmlFor="problemReason" error={fe.problemReason} hint="At least 10 characters.">
              <Textarea id="problemReason" name="problemReason" rows={2} maxLength={1000} required={needsReport} value={problemReason} onChange={(e) => setProblemReason(e.target.value)} />
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
                <>
                  {b.step && !editStep[b.materialId] && (b.step.damaged !== null || b.step.leftOver !== null) && (
                    <p className="mt-1 text-[14px]" data-testid={`step-counts-${b.materialId}`}>
                      From step {b.step.stepNo}:{b.step.damaged !== null ? ` ${Number(b.step.damaged)} damaged` : ""}
                      {b.step.leftOver !== null ? `${b.step.damaged !== null ? "," : ""} ${Number(b.step.leftOver)} left over` : ""}.{" "}
                      <button type="button" className="text-[14px] font-semibold text-primary-text underline" onClick={() => setEditStep({ ...editStep, [b.materialId]: true })}>
                        Change
                      </button>
                      <input type="hidden" name={`pkg-${b.materialId}-damaged`} value={pkg[b.materialId].damaged} />
                      {b.step.leftOver !== null && <input type="hidden" name={`pkg-${b.materialId}-leftOver`} value={pkg[b.materialId].leftOver} />}
                    </p>
                  )}
                  {(() => {
                    const fromStep = !!b.step && !editStep[b.materialId];
                    const showDamaged = !(fromStep && b.step!.damaged !== null);
                    const showLeft = !(fromStep && b.step!.leftOver !== null);
                    if (!showDamaged && !showLeft) return null;
                    return (
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {showDamaged && <Count id={`pkg-${b.materialId}-damaged`} label="Damaged" value={pkg[b.materialId].damaged} onChange={(v) => setPkg({ ...pkg, [b.materialId]: { ...pkg[b.materialId], damaged: v } })} error={fe[`pkg-${b.materialId}-damaged`]} />}
                        {showLeft && <Count id={`pkg-${b.materialId}-leftOver`} label="Left over (count them now)" value={pkg[b.materialId].leftOver} onChange={(v) => setPkg({ ...pkg, [b.materialId]: { ...pkg[b.materialId], leftOver: v } })} error={fe[`pkg-${b.materialId}-leftOver`]} />}
                      </div>
                    );
                  })()}
                  {goodN > 0 && b.step?.used !== null && b.step?.used !== undefined && Number(b.step.used) !== b.used && (
                    <p className="mt-1 text-[14px] text-muted">Step {b.step.stepNo} says {Number(b.step.used)} used; here used = good {p.pieceWord} + rejects already wrapped = {b.used}. If the step is right, put {Number(b.step.used)} under More details.</p>
                  )}
                </>
              )}
              {/* Not judged before the counts are in: an empty form is not "69 missing". */}
              {!b.counted && (goodN <= 0 || pkg[b.materialId].leftOver === "") ? (
                <p className="mt-2 text-[15px] text-muted" data-testid={`balance-${b.materialId}`} role="status">
                  {goodN <= 0 ? `Enter the good ${p.pieceWord} and the left-over wrappers; the balance is checked here.` : "Count the left-over wrappers; the balance is checked here."}
                </p>
              ) : (
                <p className={cx("mt-2 text-[15px]", b.diff === 0 ? "text-[var(--ok-fg)]" : "font-semibold text-[var(--bad-fg)]")} data-testid={`balance-${b.materialId}`} role="status">
                  {Number(b.taken)} taken = {b.used} used + {b.damaged} damaged + {b.left} left over {b.diff === 0 ? "✓" : b.diff > 0 ? `· ${b.diff} missing. Count again.` : `· ${-b.diff} too many. Count again.`}
                </p>
              )}
              {fe[`pkg-${b.materialId}`] && <p className="text-[14px] text-[var(--bad-fg)]">{fe[`pkg-${b.materialId}`]}</p>}
            </div>
          ))}
        </section>
      )}

      {p.needsChecker && (
        <fieldset className="grid gap-3 rounded-[16px] border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-[14px] font-semibold">Checked by</legend>
          <Field label="Name" htmlFor="checkerId" error={fe.checkerId}>
            <Select id="checkerId" name="checkerId" required value={checkerId} onChange={(e) => setCheckerId(e.target.value)}>
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
              <Input id="checkerPassword" name="checkerPassword" type="password" autoComplete="off" required value={checkerPassword} onChange={(e) => setCheckerPassword(e.target.value)} />
            </Field>
          )}
        </fieldset>
      )}

      <p className="text-[15px]">
        Goes to: <b>{where}{whereCode ? ` (${whereCode})` : ""}</b>
      </p>

      <details className="rounded-[16px] border border-line p-4">
        <summary className="cursor-pointer text-[15px] font-semibold">More details</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Count id="rejectsWrapped" label="Rejects that were already wrapped" value={wrapped} onChange={setWrapped} error={fe.rejectsWrapped} hint="They used a wrapper, so they count as wrappers used." />
          <Field label="Hold area" htmlFor="locationRef" error={fe.locationRef ?? fe.location}>
            <Select id="locationRef" name="locationRef" value={locationRef} onChange={(e) => setLocationRef(e.target.value)}>
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
      {problems.length > 0 && !confirming && (
        <ul role="alert" className="list-disc rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] py-2 pl-8 pr-3 text-[14px] text-[var(--bad-fg)]" data-testid="finish-problems">
          {problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {confirming ? (
        <div className="rounded-[16px] border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] p-4" role="alertdialog" aria-labelledby="fin-confirm-title" data-testid="finish-confirm">
          <p id="fin-confirm-title" className="text-[16px] font-semibold">
            Finish batch {p.batchNumber}? You can&apos;t change the counts after this.
          </p>
          <p className="mt-1 text-[15px]">
            {goodN} good {p.pieceWord} go to {where} for the quality check{needsReport ? "; a problem report is opened for QA" : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <SubmitButton size="lg" pendingText="Finishing…" autoFocus>
              Yes, finish
            </SubmitButton>
            <Button type="button" variant="secondary" size="lg" onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" size="lg" onClick={askToConfirm} disabled={unbalanced || goodN <= 0} data-testid="finish-batch">
            {needsReport ? "Finish and report the problem" : "Finish batch"}
          </Button>
          {unbalanced && goodN > 0 && <p className="mt-2 text-[14px] text-muted">The wrappers do not add up yet. Count again; if they still do not add up, use Report a problem on the batch page.</p>}
        </div>
      )}
    </form>
  );
}
