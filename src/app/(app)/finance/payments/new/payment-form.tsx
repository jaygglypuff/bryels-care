"use client";
import { useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/qty";
import { Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import type { PaymentPrefill } from "@/modules/finance";
import { createPaymentAction } from "../../actions";

type OpenDoc = { documentType: string; documentId: string; number: string; dueDate: string | null; open: string };

/**
 * Payment entry (grade-5: who, how much, when, how). The person or company decides the direction (customer =
 * money in; supplier or claimant = money out). What it pays: oldest due first (A-FIN-07, default) or chosen
 * amounts per open invoice or bill; the server re-checks every amount (V-FIN-APPLY) and shows field errors.
 * Opened from an invoice (`prefill`), the form starts on "Choose amounts" with that invoice and its open amount;
 * the amount applied follows the payment amount until it is typed over (a part payment needs one change).
 * Receipt numbers, bank reference, withheld amount and note sit under "More details".
 */
export function PaymentForm({ parties, open, methods, today, initial, prefill = null }: { parties: { value: string; label: string }[]; open: Record<string, OpenDoc[]>; methods: { value: string; label: string }[]; today: string; initial: string; prefill?: PaymentPrefill | null }) {
  const [party, setParty] = useState(initial);
  const [manual, setManual] = useState(!!prefill);
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [applied, setApplied] = useState<string | null>(null); // typed amount for the prefilled invoice; null = follows the payment amount
  const prefilledHere = !!prefill && party === prefill.counterparty;
  const docs = open[party.split(":")[1]] ?? [];
  const isCustomer = party.startsWith("customer:");
  return (
    <ActionForm action={createPaymentAction} hidden={{ allocation: manual ? "manual" : "oldest_first" }} submit="Save the payment" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="flex flex-col gap-3">
            <CardTitle>The payment</CardTitle>
            <Field label="Who" htmlFor="p-party" error={fe.counterparty} hint={isCustomer ? "A customer: money comes in." : "A supplier or a person: money goes out."}>
              <Select id="p-party" name="counterparty" value={party} onChange={(e) => setParty(e.target.value)}>
                {parties.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="How much (₱)" htmlFor="p-amount" error={fe.amount}>
                <Input id="p-amount" name="amount" inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="When the money moved" htmlFor="p-date" error={fe.paidOn}>
                <Input id="p-date" name="paidOn" type="date" max={today} defaultValue={today} required />
              </Field>
              <Field label="How" htmlFor="p-method" error={fe.method}>
                <Select id="p-method" name="method" defaultValue="bank_transfer">
                  {methods.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <MoreDetails>
              <Field label="Receipt or deposit slip number" htmlFor="p-ref" error={fe.reference}>
                <Input id="p-ref" name="reference" maxLength={80} />
              </Field>
              <Field label="Bank's reference" htmlFor="p-bank" error={fe.bankReference}>
                <Input id="p-bank" name="bankReference" maxLength={80} />
              </Field>
              {isCustomer && (
                <Field label="Kept back by the customer for tax (₱)" htmlFor="p-wh" error={fe.withheldAmount} hint="Only if the customer kept part back and gave a certificate; the accountant keeps the certificate.">
                  <Input id="p-wh" name="withheldAmount" inputMode="decimal" placeholder="0.00" />
                </Field>
              )}
              <Field label="Note" htmlFor="p-notes" error={fe.notes}>
                <Textarea id="p-notes" name="notes" maxLength={500} className="min-h-[56px]" />
              </Field>
            </MoreDetails>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>{isCustomer ? "Which invoices does it pay?" : "Which bills does it pay?"}</CardTitle>
            <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
              <input type="radio" name="alloc-mode" className="h-5 w-5" checked={!manual} onChange={() => setManual(false)} /> The oldest first (usual)
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
              <input type="radio" name="alloc-mode" className="h-5 w-5" checked={manual} onChange={() => setManual(true)} /> I choose the amounts
            </label>
            {prefilledHere && (
              <p className="text-[14px] text-fg-2" role="status">
                From invoice <b>{prefill!.number}</b>: still to pay {fmtMoney(prefill!.amount)}. Change the amount if they paid only part.
              </p>
            )}
            {fe.applications && <p className="text-[13px] text-[var(--bad-fg)]">{fe.applications}</p>}
            {docs.length === 0 ? (
              <p className="text-[14px] text-fg-2">Nothing open for them: the payment is kept for later (on their account).</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.documentId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                    <span className="min-w-0">
                      Due {fmtDate(d.dueDate)} · still to pay <b>{fmtMoney(d.open)}</b> <span className="font-mono text-[12px] text-muted">{d.number}</span>
                    </span>
                    {manual &&
                      (prefilledHere && d.documentId === prefill!.documentId ? (
                        <Input aria-label={`Amount for ${d.number}`} name={`apply:${d.documentType}:${d.documentId}`} inputMode="decimal" placeholder="0.00" className="w-32" value={applied ?? amount} onChange={(e) => setApplied(e.target.value)} />
                      ) : (
                        <Input aria-label={`Amount for ${d.number}`} name={`apply:${d.documentType}:${d.documentId}`} inputMode="decimal" placeholder="0.00" className="w-32" />
                      ))}
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
