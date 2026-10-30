"use client";
import { Button, Field, Input, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../../../_kit/forms";
import { editLotAction } from "./actions";

export function EditLotForm({ lotId, v }: { lotId: string; v: { manufacturedOn: string | null; expiresOn: string | null; supplierLotNumber: string | null; brand?: string | null; isMaterial?: boolean } }) {
  const { state, pending, onSubmit } = useActionForm(editLotAction.bind(null, lotId));
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Manufactured" htmlFor="manufacturedOn" error={fe.manufacturedOn}>
          <Input id="manufacturedOn" name="manufacturedOn" type="date" defaultValue={v.manufacturedOn ?? ""} />
        </Field>
        <Field label="Expiry" htmlFor="expiresOn" error={fe.expiresOn}>
          <Input id="expiresOn" name="expiresOn" type="date" defaultValue={v.expiresOn ?? ""} />
        </Field>
        <Field label="Supplier lot" htmlFor="supplierLotNumber">
          <Input id="supplierLotNumber" name="supplierLotNumber" maxLength={100} defaultValue={v.supplierLotNumber ?? ""} />
        </Field>
        {v.isMaterial && (
          <Field label="Brand" htmlFor="brand" error={fe.brand}>
            <Input id="brand" name="brand" maxLength={80} defaultValue={v.brand ?? ""} />
          </Field>
        )}
      </div>
      <Field label="Reason for the correction" htmlFor="reason" error={fe.reason} hint="Recorded in the audit trail with the old and new values.">
        <Textarea id="reason" name="reason" required minLength={5} maxLength={500} placeholder="e.g. Supplier CoA shows expiry 2027-03-31, typed wrongly at receipt" />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" disabled={pending} className="w-full sm:w-auto">{pending ? "Saving…" : "Save correction"}</Button>
    </form>
  );
}
