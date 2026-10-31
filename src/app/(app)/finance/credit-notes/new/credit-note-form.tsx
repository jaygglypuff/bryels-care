"use client";
import { useState } from "react";
import { Card, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { createCreditNoteAction } from "../../actions";

/** A credit (money back) on one sent invoice: why, how much; the rest folded. The number is made when it is saved to the books. */
export function CreditNoteForm({ invoiceId, reasons, returns, canVoid, openAmount }: { invoiceId: string; reasons: { code: string; label: string }[]; returns: { id: string; label: string }[]; canVoid: boolean; openAmount?: string }) {
  const [voids, setVoids] = useState(false);
  const [ret, setRet] = useState("");
  return (
    <Card>
      <ActionForm action={createCreditNoteAction} hidden={{ invoiceId }} submit="Save the credit" variant="cta" pending="Saving…">
        {(fe) => (
          <>
            <Field label="Why" htmlFor="cn-reason-code" error={fe.reasonCode}>
              <Select id="cn-reason-code" name="reasonCode" defaultValue={reasons[0]?.code}>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Explain in a few words" htmlFor="cn-reason" error={fe.reason}>
              <Textarea id="cn-reason" name="reason" required minLength={3} maxLength={500} className="min-h-[56px]" />
            </Field>
            {!voids && (
              <Field label={ret ? "How much (empty = the value of the returned goods)" : "How much money back, with tax (₱)"} htmlFor="cn-amount" error={fe.amount} hint={openAmount ? `The customer still owes ₱${Number(openAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })} on this invoice.` : undefined}>
                <Input id="cn-amount" name="amount" inputMode="decimal" placeholder="0.00" required={!ret} />
              </Field>
            )}
            {(returns.length > 0 || canVoid) && (
              <MoreDetails open={returns.length > 0}>
                {returns.length > 0 && (
                  <Field label="Goods the customer sent back" htmlFor="cn-return" error={fe.customerReturnId} hint="The amount is worked out from the returned amount × the invoice price.">
                    <Select id="cn-return" name="customerReturnId" value={ret} onChange={(e) => setRet(e.target.value)}>
                      <option value="">None</option>
                      {returns.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {canVoid && (
                  <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
                    <input type="checkbox" name="voidsInvoice" className="h-5 w-5" checked={voids} onChange={(e) => setVoids(e.target.checked)} /> Give back the whole invoice (it is cancelled, kept on record)
                  </label>
                )}
              </MoreDetails>
            )}
          </>
        )}
      </ActionForm>
    </Card>
  );
}
