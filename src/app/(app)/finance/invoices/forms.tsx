"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createInvoiceAction, financeCommandAction } from "../actions";

/** R-01: create the invoice draft of a dispatched shipment (redirects to the draft). */
export function CreateInvoiceButton({ shipmentId }: { shipmentId: string }) {
  return <ActionForm action={createInvoiceAction} hidden={{ shipmentId }} submit="Create invoice" variant="secondary" size="sm" pending="Creating…" messageBelow />;
}

/** Draft edits: notes and the reviewed tax code of the lines. */
export function EditInvoiceDraft({ id, notes, taxCode, options }: { id: string; notes: string | null; taxCode: string | null; options: { code: string; label: string }[] }) {
  return (
    <ActionForm action={financeCommandAction} hidden={{ entity: "invoice", id, command: "edit" }} submit="Save draft" variant="secondary" pending="Saving…">
      {(fe) => (
        <>
          <Field label="Tax code (reviewed configuration)" htmlFor="inv-tax" error={fe.taxCode} hint="No tax line unless a reviewed code is chosen.">
            <Select id="inv-tax" name="taxCode" defaultValue={taxCode ?? ""}>
              <option value="">No tax line</option>
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes on the invoice" htmlFor="inv-notes" error={fe.notes}>
            <Input id="inv-notes" name="notes" defaultValue={notes ?? ""} maxLength={300} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
