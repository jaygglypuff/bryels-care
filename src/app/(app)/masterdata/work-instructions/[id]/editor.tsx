"use client";
import { useActionState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveWorkInstructionAction } from "../../_eng/actions";

export function WorkInstructionEditor({ revisionId, body, changeSummary }: { revisionId: string; body: string; changeSummary: string | null }) {
  const [state, action] = useActionState<ActionState, FormData>(saveWorkInstructionAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={revisionId} />
      <Field label="Instruction text" htmlFor={`wi-${revisionId}`} error={fe.bodyMarkdown}>
        <Textarea id={`wi-${revisionId}`} name="bodyMarkdown" defaultValue={body} className="min-h-[200px]" />
      </Field>
      <Field label="Change summary" htmlFor={`wic-${revisionId}`} error={fe.changeSummary}>
        <Input id={`wic-${revisionId}`} name="changeSummary" defaultValue={changeSummary ?? ""} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save draft</SubmitButton>
    </form>
  );
}
