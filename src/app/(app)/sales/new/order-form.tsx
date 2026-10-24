"use client";
import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { Chip } from "@/ui/status";
import { fmtMoney, fmtQty } from "@/lib/qty";
import type { ActionState } from "@/lib/errors";
import { createOrderAction } from "../actions";
import { useActionForm } from "../use-action-form";

type CustomerOpt = { id: string; code: string; name: string; status?: string; shipToAddress: string; minShelfLifeDays: number; addresses?: { id: string; label: string; text: string; isDefaultShipTo: boolean; isDefaultBillTo: boolean }[] };
/** Per customer id, per product id: price breaks in force today (only for users who may see prices). */
export type PriceBooks = Record<string, Record<string, { minQtyUnits: string; unitAmount: string; code: string; kind: string }[]>>;
export type OrderFormInitial = { orderId: string; customerId: string; customerPoNumber: string; requestedDeliveryOn: string; notes: string; shipToAddressId: string; billToAddressId: string; lines: { productId: string; qtyUnits: string; unitPrice: string }[] };

function listPrice(book: PriceBooks[string] | undefined, productId: string, qty: string): string | null {
  const breaks = book?.[productId];
  if (!breaks?.length) return null;
  const n = Number(qty || "0");
  let hit: (typeof breaks)[number] | null = null;
  for (const b of breaks) if (Number(b.minQtyUnits) <= n) hit = b;
  return (hit ?? breaks[0]).unitAmount;
}
type ProductOpt = { id: string; skuCode: string; name: string; available: string };
type Line = { key: number; productId: string; qtyUnits: string; unitPrice: string };

const safeD = (v: string) => {
  try {
    return v.trim() ? new Decimal(v.trim()) : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};

export function NewOrderForm({
  customers,
  products,
  today,
  initialCustomerId,
  siteName,
  priceBooks,
  pricesVisible = true,
  initial,
  action,
}: {
  customers: CustomerOpt[];
  products: ProductOpt[];
  today: string;
  initialCustomerId?: string;
  siteName: string;
  priceBooks?: PriceBooks;
  pricesVisible?: boolean;
  initial?: OrderFormInitial;
  action?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const { state, pending, onSubmit } = useActionForm(action ?? createOrderAction);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? initialCustomerId ?? "");
  const [lines, setLines] = useState<Line[]>(initial ? initial.lines.map((l, i) => ({ key: i + 1, ...l })) : [{ key: 1, productId: "", qtyUnits: "", unitPrice: "" }]);
  const [nextKey, setNextKey] = useState((initial?.lines.length ?? 1) + 1);
  // Controlled fields so values survive a failed submit (React resets uncontrolled forms after an action).
  const [po, setPo] = useState(initial?.customerPoNumber ?? "");
  const [deliveryOn, setDeliveryOn] = useState(initial?.requestedDeliveryOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [shipToId, setShipToId] = useState(initial?.shipToAddressId ?? "");
  const [billToId, setBillToId] = useState(initial?.billToAddressId ?? "");
  const fe = state?.fieldErrors ?? {};
  const customer = customers.find((c) => c.id === customerId);
  const book = priceBooks?.[customerId];
  const addresses = customer?.addresses ?? [];
  const shipTo = addresses.find((a) => a.id === shipToId) ?? addresses.find((a) => a.isDefaultShipTo);
  /** Price shown: what the user typed, else the list price (the server resolves it again). */
  const effectivePrice = (l: Line) => (l.unitPrice.trim() ? l.unitPrice : (listPrice(book, l.productId, l.qtyUnits) ?? ""));

  const total = useMemo(() => lines.reduce((s, l) => s.plus(safeD(l.qtyUnits).times(safeD(effectivePrice(l)))), new Decimal(0)), [lines, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map(({ productId, qtyUnits, unitPrice }) => ({ productId, qtyUnits, unitPrice })));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 pb-24 sm:pb-0">
      <input type="hidden" name="lines" value={payload} />
      {initial && <input type="hidden" name="orderId" value={initial.orderId} />}
      {initial && <input type="hidden" name="customerId" value={initial.customerId} />}
      <Card>
        <CardTitle>Customer</CardTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Customer" htmlFor="customerId" error={fe.customerId}>
            <Select id="customerId" name={initial ? undefined : "customerId"} value={customerId} disabled={!!initial} onChange={(e) => { setCustomerId(e.target.value); setShipToId(""); setBillToId(""); }} required>
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <div className="rounded-[12px] border border-line bg-surface-2 px-3 py-2 text-[13px]" aria-live="polite">
            {customer ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ship to</p>
                <p className="text-fg">{shipTo?.text ?? customer.shipToAddress}</p>
                {customer.status === "on_hold" && (
                  <p className="mt-1.5">
                    <Chip tone="hold">Credit hold: the order will need approval</Chip>
                  </p>
                )}
                <p className="mt-1.5">
                  <Chip tone="info">Min shelf life at dispatch: {customer.minShelfLifeDays} days</Chip>
                </p>
              </>
            ) : (
              <p className="text-muted">Choose a customer to see the ship-to address and minimum shelf life.</p>
            )}
          </div>
          {addresses.length > 1 && (
            <>
              <Field label="Ship to" htmlFor="shipToAddressId" error={fe.shipToAddressId}>
                <Select id="shipToAddressId" name="shipToAddressId" value={shipToId} onChange={(e) => setShipToId(e.target.value)}>
                  <option value="">Default ship-to</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.text}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bill to" htmlFor="billToAddressId" error={fe.billToAddressId}>
                <Select id="billToAddressId" name="billToAddressId" value={billToId} onChange={(e) => setBillToId(e.target.value)}>
                  <option value="">Default bill-to</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label="Customer PO number" htmlFor="customerPoNumber" error={fe.customerPoNumber} hint="Optional">
            <Input id="customerPoNumber" name="customerPoNumber" maxLength={60} autoComplete="off" value={po} onChange={(e) => setPo(e.target.value)} />
          </Field>
          <Field label="Requested delivery date" htmlFor="requestedDeliveryOn" error={fe.requestedDeliveryOn}>
            <Input id="requestedDeliveryOn" name="requestedDeliveryOn" type="date" min={today} required value={deliveryOn} onChange={(e) => setDeliveryOn(e.target.value)} />
          </Field>
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
        {fe.lines && <p className="mb-3 text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
        <ol className="flex flex-col gap-3">
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            const over = p && l.qtyUnits && safeD(l.qtyUnits).gt(p.available);
            return (
              <li key={l.key} className="rounded-[12px] border border-line p-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
                  <div className="col-span-2 md:col-span-1">
                    <Field label={`Product (line ${i + 1})`} htmlFor={`p-${l.key}`} error={fe[`lines.${i}.productId`]}>
                      <Select id={`p-${l.key}`} value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })} required>
                        <option value="">Choose a product…</option>
                        {products.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.skuCode} · {x.name} — {fmtQty(x.available, "pcs", 0)} available
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {p && (
                      <p className="mt-1 text-[12px] text-muted">
                        Released and available at {siteName}: <span className="font-medium text-fg tabular">{fmtQty(p.available, "pcs", 0)}</span>
                      </p>
                    )}
                  </div>
                  <Field label="Qty (pcs)" htmlFor={`q-${l.key}`} error={fe[`lines.${i}.qtyUnits`]}>
                    <Input id={`q-${l.key}`} inputMode="numeric" pattern="[0-9]*" value={l.qtyUnits} onChange={(e) => update(l.key, { qtyUnits: e.target.value })} required />
                  </Field>
                  {pricesVisible ? (
                    <Field
                      label="Unit price (₱)"
                      htmlFor={`u-${l.key}`}
                      error={fe[`lines.${i}.unitPrice`]}
                      hint={listPrice(book, l.productId, l.qtyUnits) ? `List ${listPrice(book, l.productId, l.qtyUnits)} — leave empty to use it` : l.productId && customerId ? "No list price: enter the agreed price" : undefined}
                    >
                      <Input id={`u-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} placeholder={listPrice(book, l.productId, l.qtyUnits) ?? "0.00"} />
                    </Field>
                  ) : (
                    <p className="pt-6 text-[12px] text-muted">Price from the approved price list</p>
                  )}
                  <div className="col-span-2 flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end md:pt-6">
                    <span className="text-[13px] font-medium tabular">{pricesVisible ? fmtMoney(safeD(l.qtyUnits).times(safeD(effectivePrice(l)))) : ""}</span>
                    {lines.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 size={14} /> Remove
                      </Button>
                    )}
                  </div>
                </div>
                {over && (
                  <p className="mt-2 text-[12px] text-[var(--warn-fg)]">
                    More than the released stock available now. You can still save the order; allocation will report the shortfall.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex justify-end border-t border-line pt-3 text-[14px]">
          <span className="text-muted">Order value&nbsp;</span>
          <span className="font-semibold tabular">{pricesVisible ? fmtMoney(total) : "—"}</span>
        </div>
      </Card>

      <Card>
        <Field label="Notes" htmlFor="notes" error={fe.notes} hint="Optional — delivery instructions, contact on site">
          <Textarea id="notes" name="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <FormMessage state={state} />
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" variant="cta" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : initial ? "Save draft" : "Create draft order"}
        </Button>
      </div>
    </form>
  );
}
