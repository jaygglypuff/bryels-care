"use client";
import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { Plus, Trash2 } from "lucide-react";
import { fmtMoney } from "@/lib/qty";
import { Button, Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { Chip } from "@/ui/status";
import type { PriceBooks } from "../new/order-form";
import { useActionForm } from "../use-action-form";
import { saveQuoteAction } from "./actions";

type Line = { key: number; productId: string; qtyUnits: string; unitPrice: string };
type CustomerOpt = { id: string; code: string; name: string; status?: string; addresses?: { id: string; label: string; text: string; isDefaultShipTo: boolean }[] };
export type QuoteFormInitial = { quoteId: string; customerId: string; validUntil: string; shipToAddressId: string; notesCustomer: string; notesInternal: string; lines: Omit<Line, "key">[] };

const safeD = (v: string) => {
  try {
    return v.trim() ? new Decimal(v.trim()) : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function listPrice(book: PriceBooks[string] | undefined, productId: string, qty: string): string | null {
  const breaks = book?.[productId];
  if (!breaks?.length) return null;
  const n = Number(qty || "0");
  let hit: (typeof breaks)[number] | null = null;
  for (const b of breaks) if (Number(b.minQtyUnits) <= n) hit = b;
  return (hit ?? breaks[0]).unitAmount;
}

/** Quotation entry (W09-01): list prices fill in; a lower price is a discount that may need approval (more than 10 % by default). */
export function QuoteForm({ customers, products, priceBooks, defaultValidUntil, today, initial, initialCustomerId }: { customers: CustomerOpt[]; products: { id: string; skuCode: string; name: string }[]; priceBooks: PriceBooks; defaultValidUntil: string; today: string; initial?: QuoteFormInitial; initialCustomerId?: string }) {
  const { state, pending, onSubmit } = useActionForm(saveQuoteAction);
  const [key] = useState(newKey);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? initialCustomerId ?? "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? defaultValidUntil);
  const [shipTo, setShipTo] = useState(initial?.shipToAddressId ?? "");
  const [notesCustomer, setNotesCustomer] = useState(initial?.notesCustomer ?? "");
  const [notesInternal, setNotesInternal] = useState(initial?.notesInternal ?? "");
  const [lines, setLines] = useState<Line[]>((initial?.lines.length ? initial.lines : [{ productId: "", qtyUnits: "", unitPrice: "" }]).map((l, i) => ({ ...l, key: i + 1 })));
  const [nextKey, setNextKey] = useState(lines.length + 1);
  const fe = state?.fieldErrors ?? {};
  const book = priceBooks[customerId];
  const customer = customers.find((c) => c.id === customerId);
  const price = (l: Line) => (l.unitPrice.trim() ? l.unitPrice : (listPrice(book, l.productId, l.qtyUnits) ?? ""));
  const total = useMemo(() => lines.reduce((s, l) => s.plus(safeD(l.qtyUnits).times(safeD(price(l)))), new Decimal(0)), [lines, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4 pb-24 sm:pb-0">
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ productId, qtyUnits, unitPrice }) => ({ productId, qtyUnits, unitPrice })))} />
      {initial && <input type="hidden" name="quoteId" value={initial.quoteId} />}
      {initial && <input type="hidden" name="customerId" value={initial.customerId} />}
      <Card>
        <CardTitle>Customer</CardTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Customer" htmlFor="q-customer" error={fe.customerId}>
            <Select id="q-customer" name={initial ? undefined : "customerId"} value={customerId} disabled={!!initial} onChange={(e) => { setCustomerId(e.target.value); setShipTo(""); }} required>
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valid until" htmlFor="q-valid" error={fe.validUntil}>
            <Input id="q-valid" name="validUntil" type="date" min={today} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required />
          </Field>
          {(customer?.addresses?.length ?? 0) > 1 && (
            <Field label="Ship to" htmlFor="q-ship" error={fe.shipToAddressId}>
              <Select id="q-ship" name="shipToAddressId" value={shipTo} onChange={(e) => setShipTo(e.target.value)}>
                <option value="">Default ship-to</option>
                {customer!.addresses!.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} — {a.text}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {customer?.status === "on_hold" && (
            <p>
              <Chip tone="hold">Customer on credit hold</Chip>
            </p>
          )}
        </div>
      </Card>
      <Card>
        <CardTitle
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setLines((ls) => [...ls, { key: nextKey, productId: "", qtyUnits: "", unitPrice: "" }]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus size={14} /> Add line
            </Button>
          }
        >
          Lines
        </CardTitle>
        {fe.lines && <p className="mb-2 text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
        <ol className="flex flex-col gap-3">
          {lines.map((l, i) => {
            const lp = listPrice(book, l.productId, l.qtyUnits);
            const disc = lp && l.unitPrice.trim() ? new Decimal(lp).minus(safeD(l.unitPrice)).div(lp).times(100) : null;
            return (
              <li key={l.key} className="grid grid-cols-2 gap-3 rounded-[12px] border border-line p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
                <div className="col-span-2 md:col-span-1">
                  <Field label={`Product (line ${i + 1})`} htmlFor={`qp-${l.key}`} error={fe[`lines.${i}.productId`]}>
                    <Select id={`qp-${l.key}`} value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })} required>
                      <option value="">Choose a product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.skuCode} · {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Qty (pcs)" htmlFor={`qq-${l.key}`} error={fe[`lines.${i}.qtyUnits`]}>
                  <Input id={`qq-${l.key}`} inputMode="numeric" value={l.qtyUnits} onChange={(e) => update(l.key, { qtyUnits: e.target.value })} required />
                </Field>
                <Field label="Unit price (₱)" htmlFor={`qu-${l.key}`} error={fe[`lines.${i}.unitPrice`]} hint={lp ? `List ${lp}` : l.productId && customerId ? "No list price: enter one" : undefined}>
                  <Input id={`qu-${l.key}`} inputMode="decimal" value={l.unitPrice} placeholder={lp ?? "0.00"} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                </Field>
                <div className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end md:pt-6">
                  <span className="text-[13px] font-medium tabular">{fmtMoney(safeD(l.qtyUnits).times(safeD(price(l))))}</span>
                  {disc && disc.gt(0) && <Chip tone={disc.gt(10) ? "warn" : "info"}>{disc.toDecimalPlaces(1).toString()} % off</Chip>}
                  {lines.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 size={14} /> Remove
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex justify-end border-t border-line pt-3 text-[14px]">
          <span className="text-muted">Quotation value&nbsp;</span>
          <span className="font-semibold tabular">{fmtMoney(total)}</span>
        </div>
      </Card>
      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Note to the customer" htmlFor="q-notes" error={fe.notesCustomer} hint="Printed on the quotation">
            <Textarea id="q-notes" name="notesCustomer" value={notesCustomer} onChange={(e) => setNotesCustomer(e.target.value)} maxLength={1000} />
          </Field>
          <Field label="Internal note" htmlFor="q-internal" error={fe.notesInternal} hint="Never printed">
            <Textarea id="q-internal" name="notesInternal" value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)} maxLength={1000} />
          </Field>
        </div>
      </Card>
      <FormMessage state={state} />
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" variant="cta" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save draft quotation"}
        </Button>
      </div>
    </form>
  );
}
