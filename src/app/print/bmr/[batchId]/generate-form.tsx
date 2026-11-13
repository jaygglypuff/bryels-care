"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { FormMessage, SubmitButton } from "@/ui/form";
import { generateBmrAction } from "./actions";
import { useClientKey } from "@/ui/use-client-key";

/** "Generate BMR": records a numbered, hashed document from the current batch data (ADR-026 browser print). */
export function GenerateBmrForm({ batchId, label }: { batchId: string; label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(generateBmrAction, null);
  const key = useClientKey(); // after hydration (ADR-125, ADR-132 §10)
  return (
    <form action={action} className="no-print flex flex-col gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      {key && <input type="hidden" name="idempotencyKey" value={key} />}
      <SubmitButton variant="cta" size="lg" pendingText="Generating…">
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
