"use client";
import { useState } from "react";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createCreditNoteAction } from "../../actions";

export function CreditNoteForm({ invoiceId, reasons, returns, canVoid }: { invoiceId: string; reasons: { code: string; label: string }[]; returns: { id: string; label: string }[]; canVoid: boolean }) {
  const [voids, setVoids] = useState(false);
  const [ret, setRet] = useState("");
  return (
    <Card>
      <ActionForm action={createCreditNoteAction} hidden={{ invoiceId }} submit="Save credit note draft" variant="cta" pending="Saving…">
        {(fe) => (
          <>
            <Field label="Reason" htmlFor="cn-reason-code" error={fe.reasonCode}>
              <Select id="cn-reason-code" name="reasonCode" defaultValue={reasons[0]?.code}>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Explanation" htmlFor="cn-reason" error={fe.reason}>
              <Textarea id="cn-reason" name="reason" required minLength={3} maxLength={500} className="min-h-[56px]" />
            </Field>
            {returns.length > 0 && (
              <Field label="From a customer return (optional)" htmlFor="cn-return" error={fe.customerReturnId} hint="The amount defaults to the returned quantity × the invoiced price.">
                <Select id="cn-return" name="customerReturnId" value={ret} onChange={(e) => setRet(e.target.value)}>
                  <option value="">No return</option>
                  {returns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {canVoid && (
              <label className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" name="voidsInvoice" checked={voids} onChange={(e) => setVoids(e.target.checked)} /> Credit the whole invoice (voids it)
              </label>
            )}
            {!voids && (
              <Field label={ret ? "Amount (optional, defaults to the return value)" : "Amount to credit (incl. tax)"} htmlFor="cn-amount" error={fe.amount}>
                <Input id="cn-amount" name="amount" inputMode="decimal" placeholder="0.00" required={!ret} />
              </Field>
            )}
          </>
        )}
      </ActionForm>
    </Card>
  );
}
