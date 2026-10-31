"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

export type DecisionOption = { value: string; label: string; hint: string; blocker: string | null; danger?: boolean };

/**
 * Decision card for a lot or a batch: radio cards (blocked options disabled with the server's reason),
 * mandatory reason, one dark CTA. The server re-checks every rule; this only mirrors them.
 */
export function DecisionForm({
  action,
  hidden,
  options,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  options: DecisionOption[];
}) {
  const [state, formAction] = useActionState(action, null);
  const firstOpen = options.find((o) => !o.blocker)?.value ?? "";
  const [picked, setPicked] = useState(firstOpen);
  // After a decision the options change; fall back to the first available one.
  const choice = options.some((o) => o.value === picked && !o.blocker) ? picked : firstOpen;
  const setChoice = setPicked;
  const selected = options.find((o) => o.value === choice);

  if (!firstOpen) {
    return (
      <div className="flex flex-col gap-2">
        <FormMessage state={state} />
        <p className="text-[13px] text-muted">Nothing can be decided right now:</p>
        <ul className="list-disc pl-5 text-[13px] text-fg-2">
          {options.map((o) => (
            <li key={o.value}>
              <span className="font-medium">{o.label}:</span> {o.blocker}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-medium text-fg">Your decision</legend>
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "flex cursor-pointer flex-col gap-1 rounded-[12px] border px-3 py-2.5 text-[14px]",
              o.blocker ? "cursor-not-allowed border-line bg-surface-2 opacity-70" : choice === o.value ? "border-ring bg-primary-soft" : "border-line-strong hover:bg-surface-2",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="decision"
                value={o.value}
                checked={choice === o.value}
                disabled={!!o.blocker}
                onChange={() => setChoice(o.value)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              {o.label}
            </span>
            <span className={cx("text-[12px]", o.blocker ? "text-[var(--bad-fg)]" : "text-muted")}>{o.blocker ?? o.hint}</span>
          </label>
        ))}
      </fieldset>
      <Field label="Why? (required)" htmlFor="reason" error={state?.fieldErrors?.reason} hint="A short sentence. It is saved with your name and the time and is never changed afterwards.">
        <Textarea id="reason" name="reason" required minLength={5} maxLength={1000} placeholder="For example: supplier papers checked, colour and smell are OK." />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={selected?.danger ? "danger" : "cta"} size="lg" pendingText="Recording decision…">
          {selected ? `${selected.label}` : "Record decision"}
        </SubmitButton>
      </div>
      <p className="text-[12px] text-muted">
        This is an electronic record of a QA decision. Electronic signatures are not yet validated for regulated use; keep the signed paper record as required by your QA procedures.
      </p>
    </form>
  );
}
