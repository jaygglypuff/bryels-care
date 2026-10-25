"use client";
import { useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/qty";
import { Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createPaymentAction } from "../../actions";

type OpenDoc = { documentType: string; documentId: string; number: string; dueDate: string | null; open: string };

/**
 * Payment entry. The counterparty decides the direction (customer = money in; supplier or claimant = money
 * out). Allocation: oldest due first (A-FIN-07, default) or chosen amounts per open document; the server
 * re-checks every amount (V-FIN-APPLY) and shows field errors.
 */
export function PaymentForm({ parties, open, methods, today, initial }: { parties: { value: string; label: string }[]; open: Record<string, OpenDoc[]>; methods: { value: string; label: string }[]; today: string; initial: string }) {
  const [party, setParty] = useState(initial);
  const [manual, setManual] = useState(false);
  const docs = open[party.split(":")[1]] ?? [];
  const isCustomer = party.startsWith("customer:");
  return (
    <ActionForm action={createPaymentAction} hidden={{ allocation: manual ? "manual" : "oldest_first" }} submit="Save payment draft" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="flex flex-col gap-3">
            <CardTitle>Payment</CardTitle>
            <Field label="Counterparty" htmlFor="p-party" error={fe.counterparty}>
              <Select id="p-party" name="counterparty" value={party} onChange={(e) => setParty(e.target.value)}>
                {parties.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Paid on" htmlFor="p-date" error={fe.paidOn} hint="The date the money moved (posting date).">
                <Input id="p-date" name="paidOn" type="date" max={today} defaultValue={today} required />
              </Field>
              <Field label="Method" htmlFor="p-method" error={fe.method}>
                <Select id="p-method" name="method" defaultValue="bank_transfer">
                  {methods.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" htmlFor="p-amount" error={fe.amount}>
                <Input id="p-amount" name="amount" inputMode="decimal" required placeholder="0.00" />
              </Field>
              {isCustomer && (
                <Field label="Withheld by the customer (optional)" htmlFor="p-wh" error={fe.withheldAmount} hint="Amount the customer withheld; the certificate stays with the accountant.">
                  <Input id="p-wh" name="withheldAmount" inputMode="decimal" placeholder="0.00" />
                </Field>
              )}
              <Field label="Reference (OR, deposit slip)" htmlFor="p-ref" error={fe.reference}>
                <Input id="p-ref" name="reference" maxLength={80} />
              </Field>
              <Field label="Bank reference" htmlFor="p-bank" error={fe.bankReference}>
                <Input id="p-bank" name="bankReference" maxLength={80} />
              </Field>
            </div>
            <Field label="Notes" htmlFor="p-notes" error={fe.notes}>
              <Textarea id="p-notes" name="notes" maxLength={500} className="min-h-[56px]" />
            </Field>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>Apply to</CardTitle>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="alloc-mode" checked={!manual} onChange={() => setManual(false)} /> Oldest due first (default)
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="alloc-mode" checked={manual} onChange={() => setManual(true)} /> Choose amounts
            </label>
            {fe.applications && <p className="text-[12px] text-[var(--bad-fg)]">{fe.applications}</p>}
            {docs.length === 0 ? (
              <p className="text-[13px] text-muted">No open documents for this counterparty: the payment stays unapplied on account.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.documentId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="font-medium">{d.number}</span> · due {fmtDate(d.dueDate)} · open {fmtMoney(d.open)}
                    </span>
                    {manual && <Input aria-label={`Amount for ${d.number}`} name={`apply:${d.documentType}:${d.documentId}`} inputMode="decimal" placeholder="0.00" className="w-32" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </ActionForm>
  );
}
