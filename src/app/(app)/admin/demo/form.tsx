"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { resetDemo } from "./actions";

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col gap-2">
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Resetting… (about a minute, keep this page open)" : "Reset demo data"}
      </Button>
      {pending && (
        <p role="status" className="text-[13px] text-muted">
          Clearing every table and loading the fictional data again. When it is done you are signed out and taken to the sign-in page.
        </p>
      )}
    </div>
  );
}

export function ResetDemoForm({ word }: { word: string }) {
  const [state, action] = useActionState(resetDemo, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={`Type ${word} to confirm`} htmlFor="confirm" error={state?.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" autoComplete="off" autoCapitalize="characters" required pattern={`[A-Za-z]{${word.length}}`} placeholder={word} />
      </Field>
      <FormMessage state={state} />
      <ResetButton />
    </form>
  );
}
