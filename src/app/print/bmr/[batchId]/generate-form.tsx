"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { FormMessage, SubmitButton } from "@/ui/form";
import { generateBmrAction } from "./actions";

/** "Generate BMR": records a numbered, hashed document from the current batch data (ADR-026 browser print). */
export function GenerateBmrForm({ batchId, label }: { batchId: string; label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(generateBmrAction, null);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <form action={action} className="no-print flex flex-col gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={key} suppressHydrationWarning />
      <SubmitButton variant="cta" size="lg" pendingText="Generating…">
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
