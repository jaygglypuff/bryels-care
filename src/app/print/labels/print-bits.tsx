"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { markPrintedAction, markReceiptJobsPrintedAction } from "@/app/(app)/labels/actions";
import { FailForm } from "@/app/(app)/labels/forms";
import type { ActionState } from "@/lib/errors";
import { Button, buttonClass, LinkButton } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

/** Opens the browser's print window once, after the label fonts are ready (ADR-099, `?auto=1`). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    const go = () => setTimeout(() => window.print(), 300);
    if (document.fonts?.ready) document.fonts.ready.then(go, go);
    else go();
  }, [enabled]);
  return null;
}

export function PrintNow({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("cta", "lg") + " no-print w-full sm:w-auto"} data-testid="print-now">
      <Printer size={20} aria-hidden /> {label}
    </button>
  );
}

/**
 * After the print window: "Did all N labels come out right?" Yes records the job(s) as printed (audited);
 * No prints again (the job stays the same) or, folded, records that the printer failed.
 */
export function PrintedCheck({ jobIds, count, stick, back, receiptId }: { jobIds: string[]; count: number; stick: string; back: string | null; receiptId?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(receiptId ? markReceiptJobsPrintedAction : markPrintedAction, null);
  const [failing, setFailing] = useState(false);
  if (state?.ok) {
    return (
      <div className="grid gap-3 rounded-[16px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] p-4" role="status" data-testid="printed-ok">
        <p className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ok-fg)]">
          <CheckCircle2 size={20} aria-hidden /> Saved. {stick}
        </p>
        {back && (
          <LinkButton href={back} variant="cta" size="lg" className="w-full sm:w-auto">
            Back to my work
          </LinkButton>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-[16px] border border-line bg-surface p-4" data-testid="printed-check">
      <p className="text-[16px] font-semibold">{count === 1 ? "Did the label come out right?" : `Did all ${count} labels come out right?`}</p>
      <form action={action} className="flex flex-wrap gap-2">
        {receiptId ? (
          <>
            <input type="hidden" name="jobIds" value={jobIds.join(",")} />
            <input type="hidden" name="receiptId" value={receiptId} />
          </>
        ) : (
          <input type="hidden" name="jobId" value={jobIds[0]} />
        )}
        <SubmitButton variant="cta" size="lg" pendingText="Saving…">
          {count === 1 ? "Yes, it printed" : "Yes, they printed"}
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={() => window.print()}>
          No, print again
        </Button>
      </form>
      <FormMessage state={state} />
      {!receiptId && (
        <div>
          {failing ? (
            <FailForm jobId={jobIds[0]} />
          ) : (
            <button type="button" className="min-h-[44px] text-[14px] text-fg-2 underline" onClick={() => setFailing(true)}>
              The printer is not working
            </button>
          )}
        </div>
      )}
    </div>
  );
}
