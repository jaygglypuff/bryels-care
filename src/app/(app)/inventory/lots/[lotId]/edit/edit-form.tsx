"use client";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { useActionForm } from "../../../_kit/forms";
import { editLotAction } from "./actions";

/** Fix lot details: expiry, supplier's code and why (3 visible fields); made-on date and brand under More details. */
export function EditLotForm({ lotId, v }: { lotId: string; v: { manufacturedOn: string | null; expiresOn: string | null; supplierLotNumber: string | null; brand?: string | null; isMaterial?: boolean } }) {
  const { state, pending, onSubmit } = useActionForm(editLotAction.bind(null, lotId));
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expiry date" htmlFor="expiresOn" error={fe.expiresOn}>
          <Input id="expiresOn" name="expiresOn" type="date" defaultValue={v.expiresOn ?? ""} />
        </Field>
        <Field label="Supplier's code on the sack" htmlFor="supplierLotNumber" hint="As printed on the supplier's label.">
          <Input id="supplierLotNumber" name="supplierLotNumber" maxLength={100} defaultValue={v.supplierLotNumber ?? ""} />
        </Field>
      </div>
      <MoreDetails open={!!fe.manufacturedOn || !!fe.brand}>
        <Field label="Made on" htmlFor="manufacturedOn" error={fe.manufacturedOn}>
          <Input id="manufacturedOn" name="manufacturedOn" type="date" defaultValue={v.manufacturedOn ?? ""} />
        </Field>
        {v.isMaterial && (
          <Field label="Brand" htmlFor="brand" error={fe.brand}>
            <Input id="brand" name="brand" maxLength={80} defaultValue={v.brand ?? ""} />
          </Field>
        )}
      </MoreDetails>
      <Field label="Why fix it?" htmlFor="reason" error={fe.reason} hint="Kept in the history with the old and new values.">
        <Textarea id="reason" name="reason" required minLength={5} maxLength={500} placeholder="e.g. The supplier's paper says it expires 31 Mar 2027; typed wrong at receiving" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">{pending ? "Saving…" : "Save the fix"}</Button>
    </form>
  );
}
