"use client";
import { Field, Textarea } from "@/ui/core";
import { Banner } from "@/ui/status";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { workOrderCommandAction } from "./actions";

export type NextStepProps = {
  workOrderId: string;
  command: "plan" | "release" | "create_batch" | null;
  label: string | null;
  pendingText?: string;
  withNote?: boolean;
  blocked?: { title: string; body: string } | null;
  idle?: string | null;
};

/**
 * The work order's primary action (Plan → Release → Create batch). One component instance for
 * every state, so the result of the last command stays on screen when the action's response
 * re-renders the page into the next state (ux-system §9.3 "primary action by state", ADR-043).
 */
export function NextStep(p: NextStepProps) {
  const [state, action] = useInPlaceAction(workOrderCommandAction);
  return (
    <div className="flex flex-col gap-3">
      {p.blocked && (
        <Banner tone="info" title={p.blocked.title}>
          {p.blocked.body}
        </Banner>
      )}
      {p.command && p.label && !p.blocked && (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="workOrderId" value={p.workOrderId} />
          <input type="hidden" name="command" value={p.command} />
          {p.withNote && (
            <Field label="Release note (optional)" htmlFor="note">
              <Textarea id="note" name="note" maxLength={500} className="min-h-[56px]" />
            </Field>
          )}
          <div>
            <SubmitButton variant="cta" pendingText={p.pendingText ?? "Working…"}>
              {p.label}
            </SubmitButton>
          </div>
        </form>
      )}
      {!p.command && !p.blocked && p.idle && <p className="text-[13px] text-muted">{p.idle}</p>}
      <FormMessage state={state} />
    </div>
  );
}
