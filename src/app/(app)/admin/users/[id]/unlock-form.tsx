"use client";
import { useActionState } from "react";
import { Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { unlockAccount } from "./actions";

export function UnlockForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(unlockAccount, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <Field label="Reason for unlocking" htmlFor="reason" error={state?.fieldErrors?.reason} hint="For example: identity confirmed by phone with the user.">
        <Input id="reason" name="reason" required minLength={5} maxLength={300} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="cta" pendingText="Unlocking…">
          Unlock account
        </SubmitButton>
      </div>
    </form>
  );
}
