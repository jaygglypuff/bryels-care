"use client";
import { useState } from "react";
import { Button, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { correctResultAction, decideCorrectionAction } from "./actions";
import { NextApprover } from "@/ui/next-approver";
import type { NextActors } from "@/lib/next-actors-words";

/**
 * ADR-104 §3 on Check quality: every result with its corrections (old values struck through with who and when), a
 * "Correct this result" form on the newest entry, and the corrections that wait for a second QA person.
 * Before the decision the correction is saved at once; after it, it is a request a second QA person approves.
 */
export type ResultRow = { id: string; testName: string; result: string; passed: boolean; by: string; at: string; correctionReason: string | null; live: boolean; free: boolean };
export type PendingCorrection = { id: string; test: string; oldResult: string; value: string; reason: string; by: string; at: string; canDecide: boolean; mine: boolean; next?: NextActors | null };

const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

export function ResultCorrections({ batchId, rows, pending, decided, canCorrect }: { batchId: string; rows: ResultRow[]; pending: PendingCorrection[]; decided: boolean; canCorrect: boolean }) {
  const byTest = new Map<string, ResultRow[]>();
  for (const r of rows) byTest.set(r.testName, [...(byTest.get(r.testName) ?? []), r]);
  return (
    <div className="grid gap-3" data-testid="result-corrections">
      {pending.map((c) => (
        <PendingBox key={c.id} c={c} />
      ))}
      <ul className="divide-y divide-line">
        {[...byTest.entries()].map(([name, list]) => (
          <li key={name} className="py-3">
            <p className="font-medium">{name}</p>
            <ul className="mt-1 grid gap-1">
              {list.map((r) => (
                <li key={r.id} className="text-[15px]">
                  <span className={r.live ? "font-semibold" : "text-muted line-through"} data-testid={r.live ? "result-live" : "result-old"}>
                    {r.result} · {r.passed ? "OK" : "not OK"}
                  </span>{" "}
                  <span className="text-[13px] text-muted">
                    {r.by}, {r.at}
                    {r.correctionReason ? ` · corrected: ${r.correctionReason}` : ""}
                  </span>
                  {r.live && canCorrect && !pending.some((p) => p.test === r.testName) && <CorrectForm batchId={batchId} row={r} decided={decided} />}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CorrectForm({ batchId, row, decided }: { batchId: string; row: ResultRow; decided: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useInPlaceAction(correctResultAction);
  const [k] = useState(key);
  const fe = state?.fieldErrors ?? {};
  if (!open)
    return (
      <Button type="button" variant="secondary" size="sm" className="ml-2" onClick={() => setOpen(true)} data-testid="correct-result">
        {decided ? "Ask to correct this result" : "Correct this result"}
      </Button>
    );
  return (
    <form action={action} className="mt-2 grid gap-2 rounded-[14px] border border-line p-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="resultId" value={row.id} />
      <input type="hidden" name="decided" value={decided ? "1" : "0"} />
      <input type="hidden" name="idempotencyKey" value={k} />
      {decided && <p className="text-[14px] text-fg-2">The batch is already decided. A second QA person must say yes; then the decision opens again and the batch is checked again.</p>}
      <label className="grid gap-1 text-[15px]">
        New value
        <Input name="value" defaultValue="" className="min-h-[48px]" />
        {fe.value && <span className="text-[13px] text-[var(--bad-fg)]">{fe.value}</span>}
      </label>
      <fieldset className="flex flex-wrap gap-3 text-[15px]">
        <legend className="text-[14px] text-fg-2">Result {row.free ? "" : "(for yes/no tests)"}</legend>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="conforms" value="yes" className="h-5 w-5" /> OK
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="conforms" value="no" className="h-5 w-5" /> Not OK
        </label>
        {fe.conforms && <span className="text-[13px] text-[var(--bad-fg)]">{fe.conforms}</span>}
      </fieldset>
      <label className="grid gap-1 text-[15px]">
        Why is it corrected?
        <Input name="reason" placeholder="For example: wrong decimal place" className="min-h-[48px]" />
        {fe.reason && <span className="text-[13px] text-[var(--bad-fg)]">{fe.reason}</span>}
      </label>
      <SubmitButton variant="cta" size="lg" pendingText="Saving…">
        {decided ? "Ask a second QA person" : "Save the correction"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

function PendingBox({ c }: { c: PendingCorrection }) {
  const [state, action] = useInPlaceAction(decideCorrectionAction);
  const [k] = useState(key);
  return (
    <section className="rounded-[16px] border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3" data-testid="pending-correction">
      <p className="text-[15px] font-semibold">
        {c.by} asks to correct {c.test}: <span className="line-through">{c.oldResult}</span> → {c.value}
      </p>
      <p className="text-[14px]">Why: {c.reason}</p>
      {!c.canDecide && <NextApprover next={c.next} className="text-[14px]" />}
      {c.canDecide ? (
        <form action={action} className="mt-2 grid gap-2">
          <input type="hidden" name="requestId" value={c.id} />
          <input type="hidden" name="idempotencyKey" value={k} />
          <p className="text-[14px] text-fg-2">Yes opens the decision again: the lot goes back to the hold area and the batch is checked again.</p>
          <Input name="note" placeholder="Note (needed for No)" className="min-h-[48px]" />
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="approve" variant="cta" size="lg" pendingText="Saving…">
              Yes, correct it
            </SubmitButton>
            <SubmitButton name="decision" value="refuse" variant="secondary" size="lg" pendingText="Saving…">
              No
            </SubmitButton>
          </div>
          <FormMessage state={state} />
        </form>
      ) : (
        <p className="mt-1 text-[14px] text-fg-2">{c.mine ? "You asked for it. A second QA person decides." : "A second QA person decides."}</p>
      )}
    </section>
  );
}
