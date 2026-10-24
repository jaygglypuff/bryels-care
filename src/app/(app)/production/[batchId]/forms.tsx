"use client";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/ui/form";
import { startBatchAction } from "../actions";

export function StartBatchForm({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(startBatchAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <SubmitButton size="lg" variant="cta" pendingText="Confirming…">
        Confirm materials at the line
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
