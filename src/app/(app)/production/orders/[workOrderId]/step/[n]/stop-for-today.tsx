"use client";
import { useState } from "react";
import { Moon } from "lucide-react";
import { Button, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { stopForTodayAction } from "../../flow-actions";

/**
 * ADR-104 §5 "Stop for today" on the step card: where we stopped (prefilled from the step) and a short note. The batch
 * stays "Being made"; tomorrow the task reads "Continue … · step n · started yesterday" and shows this note.
 */
export function StopForToday({ batchId, stepNo, prefill, last, dayNo }: { batchId: string; stepNo: number; prefill: string; last: string | null; dayNo: number | null }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useInPlaceAction(stopForTodayAction);
  const [key] = useState(() => `stop-${batchId}-${Date.now()}`);
  return (
    <section className="mt-4 rounded-[20px] border border-line bg-surface p-4" data-testid="stop-for-today">
      {(last || (dayNo && dayNo > 1)) && (
        <p className="mb-2 text-[15px] text-fg-2" data-testid="last-pause">
          {dayNo && dayNo > 1 ? `Day ${dayNo} of this batch. ` : ""}
          {last ?? ""}
        </p>
      )}
      {!open ? (
        <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(true)}>
          <Moon size={18} aria-hidden /> Stop for today
        </Button>
      ) : (
        <form action={action} className="grid gap-2">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="stepNo" value={stepNo} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <label className="grid gap-1 text-[15px]">
            Where did you stop?
            <Input name="whereStopped" defaultValue={prefill} className="min-h-[48px]" />
          </label>
          <label className="grid gap-1 text-[15px]">
            Short note (optional)
            <Input name="note" placeholder="For example: oils melted, lye not added yet" className="min-h-[48px]" />
          </label>
          <SubmitButton variant="cta" size="lg" pendingText="Saving…">
            Save and stop for today
          </SubmitButton>
          <FormMessage state={state} />
        </form>
      )}
    </section>
  );
}
