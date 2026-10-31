"use client";
import { useActionState } from "react";
import { markReceiptJobsPrintedAction } from "@/app/(app)/labels/actions";
import type { ActionState } from "@/lib/errors";
import { FormMessage, SubmitButton } from "@/ui/form";

/** After the labels come out of the printer: one tap records all of them as printed. */
export function ReceiptPrintedForm({ jobIds, receiptId }: { jobIds: string[]; receiptId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(markReceiptJobsPrintedAction, null);
  return (
    <form action={action} className="space-y-2 rounded-[16px] border border-line bg-surface p-4">
      <input type="hidden" name="jobIds" value={jobIds.join(",")} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <p className="text-[14px]">When the labels have come out of the printer:</p>
      <SubmitButton variant="cta" pendingText="Saving…">The labels printed OK</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
