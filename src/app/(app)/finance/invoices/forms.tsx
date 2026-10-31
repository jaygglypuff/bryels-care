"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createInvoiceAction, financeCommandAction } from "../actions";

/** R-01: create the invoice draft of a dispatched shipment (redirects to the draft). */
export function CreateInvoiceButton({ shipmentId }: { shipmentId: string }) {
  return <ActionForm action={createInvoiceAction} hidden={{ shipmentId }} submit="Make the invoice" variant="secondary" pending="Making…" messageBelow />;
}

/** Draft edits: notes and the reviewed tax code of the lines. */
export function EditInvoiceDraft({ id, notes, taxCode, options }: { id: string; notes: string | null; taxCode: string | null; options: { code: string; label: string }[] }) {
  return (
    <ActionForm action={financeCommandAction} hidden={{ entity: "invoice", id, command: "edit" }} submit="Save changes" variant="secondary" pending="Saving…">
      {(fe) => (
        <>
          <Field label="Tax" htmlFor="inv-tax" error={fe.taxCode} hint="Only rates the accountant checked are listed. “No tax” adds no tax line.">
            <Select id="inv-tax" name="taxCode" defaultValue={taxCode ?? ""}>
              <option value="">No tax</option>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note printed on the invoice" htmlFor="inv-notes" error={fe.notes}>
            <Input id="inv-notes" name="notes" defaultValue={notes ?? ""} maxLength={300} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
