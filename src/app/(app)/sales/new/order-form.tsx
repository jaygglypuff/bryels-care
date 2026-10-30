"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Decimal from "decimal.js";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { Chip } from "@/ui/status";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/qty";
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

/** Product choice with the name first and the free stock in plain words (owner mockup review). */
export function productOptionLabel(p: ProductOpt): string {
  const n = safeD(p.available);
  return n.gt(0) ? `${p.name} (${fmtQty(n, "", 0)} in stock)` : `${p.name} (none in stock — will be made)`;
}

const STEPS = [
  { n: 1, label: "Customer" },
  { n: 2, label: "Products" },
  { n: 3, label: "Check & send" },
] as const;
type Step = 1 | 2 | 3;

/** Which step holds a field the server rejected (so the form opens there). */
function stepOfField(f: string): Step {
  if (f.startsWith("lines")) return 2;
  if (f === "notes" || f === "form") return 3;
  return 1;
}

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
  // A new order is a three-step wizard (1 Customer · 2 Products · 3 Check & send); editing a draft keeps
  // the single page. Every field stays in the one form, so the server action and its rules are unchanged.
  const wizard = !initial;
  const [step, setStep] = useState<Step>(1);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [customerId, setCustomerId] = useState(initial?.customerId ?? initialCustomerId ?? "");
  const [lines, setLines] = useState<Line[]>(initial ? initial.lines.map((l, i) => ({ key: i + 1, ...l })) : [{ key: 1, productId: "", qtyUnits: "", unitPrice: "" }]);
  const [nextKey, setNextKey] = useState((initial?.lines.length ?? 1) + 1);
  // Controlled fields so values survive a failed submit (React resets uncontrolled forms after an action).
  const [po, setPo] = useState(initial?.customerPoNumber ?? "");
  const [deliveryOn, setDeliveryOn] = useState(initial?.requestedDeliveryOn ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [shipToId, setShipToId] = useState(initial?.shipToAddressId ?? "");
  const [billToId, setBillToId] = useState(initial?.billToAddressId ?? "");
  const fe = { ...stepErrors, ...(state?.fieldErrors ?? {}) };
  const customer = customers.find((c) => c.id === customerId);
  const book = priceBooks?.[customerId];
  const addresses = customer?.addresses ?? [];
  const shipTo = addresses.find((a) => a.id === shipToId) ?? addresses.find((a) => a.isDefaultShipTo);
  const sortedProducts = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  /** Price shown: what the user typed, else the list price (the server resolves it again). */
  const effectivePrice = (l: Line) => (l.unitPrice.trim() ? l.unitPrice : (listPrice(book, l.productId, l.qtyUnits) ?? ""));

  const total = useMemo(() => lines.reduce((s, l) => s.plus(safeD(l.qtyUnits).times(safeD(effectivePrice(l)))), new Decimal(0)), [lines, book]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map(({ productId, qtyUnits, unitPrice }) => ({ productId, qtyUnits, unitPrice })));

  // The server rejected something: open the step that holds the first field in error.
  useEffect(() => {
    if (!wizard || !state || state.ok) return;
    const keys = Object.keys(state.fieldErrors ?? {});
    if (keys.length) setStep(Math.min(...keys.map(stepOfField)) as Step);
  }, [state, wizard]);

  /** Client checks before moving on (the server checks everything again on save). */
  const check = (s: Step): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!customerId) e.customerId = "Choose the customer.";
      if (!deliveryOn) e.requestedDeliveryOn = "Choose the delivery date the customer asked for.";
      else if (deliveryOn < today) e.requestedDeliveryOn = "The delivery date cannot be in the past.";
    }
    if (s === 2) {
      lines.forEach((l, i) => {
        if (!l.productId) e[`lines.${i}.productId`] = "Choose a product.";
        if (!/^[1-9]\d*$/.test(l.qtyUnits.trim())) e[`lines.${i}.qtyUnits`] = "Enter how many pieces (a whole number).";
      });
    }
    return e;
  };
  const go = (to: Step) => {
    if (to > step) {
      for (let s = step; s < to; s++) {
        const e = check(s as Step);
        if (Object.keys(e).length) {
          setStepErrors(e);
          setStep(s as Step);
          return;
        }
      }
    }
    setStepErrors({});
    setStep(to);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (wizard && step < 3) {
      e.preventDefault();
      go((step + 1) as Step);
      return;
    }
    onSubmit(e);
  };
  const show = (s: Step) => !wizard || step === s;

  return (
    <form onSubmit={submit} noValidate={wizard} className="flex flex-col gap-4">
      <input type="hidden" name="lines" value={payload} />
      {initial && <input type="hidden" name="orderId" value={initial.orderId} />}
      {initial && <input type="hidden" name="customerId" value={initial.customerId} />}

      {wizard && (
        <nav aria-label="Steps">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] sm:gap-x-2 sm:text-[14px]">
            {STEPS.map((s, i) => (
              <li key={s.n} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (s.n < step ? go(s.n) : undefined)}
                  aria-current={step === s.n ? "step" : undefined}
                  disabled={s.n > step}
                  className={cx(
                    "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-1 font-medium disabled:cursor-default sm:px-2",
                    step === s.n ? "text-fg" : s.n < step ? "text-primary-text hover:underline" : "text-muted",
                  )}
                >
                  <span className={cx("inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold", step === s.n ? "bg-cta text-white" : s.n < step ? "bg-primary-soft text-primary-text" : "bg-surface-2 text-muted")}>{s.n}</span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <span className="text-muted" aria-hidden>·</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div hidden={!show(1)}>
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
            <Field label="Customer's order no." htmlFor="customerPoNumber" error={fe.customerPoNumber} hint="Optional — the number on the customer's purchase order">
              <Input id="customerPoNumber" name="customerPoNumber" maxLength={60} autoComplete="off" value={po} onChange={(e) => setPo(e.target.value)} />
            </Field>
            <Field label="Requested delivery date" htmlFor="requestedDeliveryOn" error={fe.requestedDeliveryOn}>
              <Input id="requestedDeliveryOn" name="requestedDeliveryOn" type="date" min={today} required value={deliveryOn} onChange={(e) => setDeliveryOn(e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <div hidden={!show(2)}>
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
                <Plus size={14} /> Add product
              </Button>
            }
          >
            {wizard ? `Products for ${customer?.name ?? "the customer"}` : "Lines"}
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
                          {sortedProducts.map((x) => (
                            <option key={x.id} value={x.id}>
                              {productOptionLabel(x)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {p && (
                        <p className="mt-1 text-[12px] text-muted">
                          {p.skuCode} · released and free at {siteName}: <span className="font-medium text-fg tabular">{fmtQty(p.available, "pcs", 0)}</span>
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
                      More than the released stock free now. You can still save the order; reserving stock will show what is missing, and you can have it made for this order.
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
      </div>

      {wizard && step === 3 && (
        <Card aria-labelledby="review-h">
          <h2 id="review-h" className="font-display text-[18px] font-semibold text-fg">Check the order</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-muted">Customer</dt>
              <dd className="font-medium text-fg">{customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Deliver by</dt>
              <dd className="font-medium text-fg">{deliveryOn ? fmtDate(deliveryOn) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Ship to</dt>
              <dd className="text-fg">{shipTo?.text ?? customer?.shipToAddress ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Customer&apos;s order no.</dt>
              <dd className="text-fg">{po || "—"}</dd>
            </div>
          </dl>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {lines.map((l) => {
              const p = products.find((x) => x.id === l.productId);
              return (
                <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-[14px]">
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{p?.name ?? "—"}</span> × {fmtQty(safeD(l.qtyUnits), "pcs", 0)}
                  </span>
                  {pricesVisible && <span className="tabular">{fmtMoney(safeD(l.qtyUnits).times(safeD(effectivePrice(l))))}</span>}
                </li>
              );
            })}
          </ul>
          {pricesVisible && (
            <p className="mt-2 flex justify-end gap-2 text-[15px]">
              <span className="text-muted">Order value</span>
              <span className="font-semibold tabular">{fmtMoney(total)}</span>
            </p>
          )}
          <p className="mt-3 text-[13px] text-fg-2">Saving creates the order as a draft. On the next screen you send it for confirmation (it may need approval, for example over the credit limit).</p>
        </Card>
      )}

      <div hidden={!show(3)}>
        <Card>
          <Field label="Notes" htmlFor="notes" error={fe.notes} hint="Optional — delivery instructions, contact on site">
            <Textarea id="notes" name="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Card>
      </div>

      <FormMessage state={state} />
      <div className="flex gap-2">
        {wizard && step > 1 && (
          <Button type="button" variant="secondary" size="lg" onClick={() => go((step - 1) as Step)}>
            <ArrowLeft size={16} aria-hidden /> Back
          </Button>
        )}
        {/* Distinct keys: React must not turn the clicked "Next" button into the submit button during the
            same click, or the browser would submit the form the moment step 3 opens. */}
        {wizard && step < 3 ? (
          <Button key="next" type="button" variant="cta" size="lg" className="flex-1 sm:flex-none" onClick={() => go((step + 1) as Step)}>
            Next: {STEPS.find((s) => s.n === step + 1)?.label} <ArrowRight size={16} aria-hidden />
          </Button>
        ) : (
          <Button key="submit" type="submit" variant="cta" size="lg" className="flex-1 sm:flex-none" disabled={pending}>
            {pending ? "Saving…" : initial ? "Save draft" : "Create draft order"}
          </Button>
        )}
      </div>
    </form>
  );
}
