"use client";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import type { PortalCatalogItem } from "@/modules/portal";
import { Card, CardTitle, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { portalPlaceOrder } from "../../actions";

type Address = { id: string; label: string; text: string; isDefault: boolean };

const fmt = (d: Decimal, currency: string) => `${currency} ${d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function priceFor(item: PortalCatalogItem, qty: Decimal): Decimal | null {
  const hit = [...item.priceBreaks].reverse().find((b) => new Decimal(b.minQty).lte(qty));
  return hit ? new Decimal(hit.unitAmount) : null;
}

/**
 * The order form (ADR-043 pattern: `useInPlaceAction` adds the idempotency key, so a double tap or a
 * retry places one order; the server action redirects to the new order). The estimate is shown with
 * decimal arithmetic for the customer's information only — the server prices the order.
 */
export function OrderForm({ catalogue, addresses, today, prefill }: { catalogue: PortalCatalogItem[]; addresses: Address[]; today: string; prefill: Record<string, string> }) {
  const [state, action] = useInPlaceAction(portalPlaceOrder);
  const [qty, setQty] = useState<Record<string, string>>(prefill);
  const fe = state?.fieldErrors ?? {};
  const currency = catalogue[0]?.currency ?? "PHP";
  const { total, count } = useMemo(() => {
    let t = new Decimal(0);
    let n = 0;
    for (const item of catalogue) {
      const raw = (qty[item.productId] ?? "").trim();
      if (!/^\d+$/.test(raw) || raw === "0") continue;
      const q = new Decimal(raw);
      const p = priceFor(item, q);
      if (p) t = t.plus(p.times(q));
      n += 1;
    }
    return { total: t, count: n };
  }, [qty, catalogue]);
  const defaultAddress = addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? "";
  // Controlled, so a refused order keeps what was typed (React resets uncontrolled fields after an action).
  const [head, setHead] = useState({ requestedDeliveryOn: "", shipToAddressId: defaultAddress, customerPoNumber: "", note: "" });
  const bind = (k: keyof typeof head) => ({ name: k, value: head[k], onChange: (e: { target: { value: string } }) => setHead((h) => ({ ...h, [k]: e.target.value })) });

  return (
    <form action={action} className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <CardTitle>Products</CardTitle>
        <ul className="flex flex-col divide-y divide-line">
          {catalogue.map((item, i) => {
            const raw = (qty[item.productId] ?? "").trim();
            const q = /^\d+$/.test(raw) ? new Decimal(raw) : null;
            const unit = q && q.gt(0) ? priceFor(item, q) : null;
            const belowMoq = q && q.gt(0) && item.moq && q.lt(item.moq);
            const err = fe[`lines.${i}.qty`] ?? fe[`lines.${i}.productId`];
            return (
              <li key={item.productId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <input type="hidden" name={`lines.${i}.productId`} value={item.productId} />
                <div className="min-w-0">
                  <p className="font-medium text-fg">{item.name}</p>
                  <p className="text-[12px] text-muted">
                    <span className="font-mono">{item.sku}</span>
                    {item.customerItemCode ? ` · your code ${item.customerItemCode}` : ""} · {item.unitsPerBox} pcs per box
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-2">
                    {item.priceBreaks.map((b, k) => (
                      <span key={b.minQty} className={cx(k > 0 && "ml-2")}>
                        {new Decimal(b.minQty).gt(0) ? `from ${b.minQty} pcs ` : ""}
                        <span className="font-semibold">{fmt(new Decimal(b.unitAmount), item.currency)}</span>
                        {k === 0 ? " / pc" : ""}
                      </span>
                    ))}
                  </p>
                  {(item.moq || item.leadTimeDays) && (
                    <p className="text-[11.5px] text-muted">
                      {item.moq ? `Minimum order ${item.moq} pcs` : ""}
                      {item.moq && item.leadTimeDays ? " · " : ""}
                      {item.leadTimeDays ? `lead time ${item.leadTimeDays} days` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-1 sm:w-[150px]">
                  <label htmlFor={`qty-${i}`} className="sr-only">
                    Quantity of {item.name} in pieces
                  </label>
                  <Input
                    id={`qty-${i}`}
                    name={`lines.${i}.qty`}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0 pcs"
                    value={qty[item.productId] ?? ""}
                    onChange={(e) => setQty((s) => ({ ...s, [item.productId]: e.target.value.replace(/[^0-9]/g, "") }))}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `qty-${i}-err` : undefined}
                  />
                  {unit && q && <p className="text-right text-[11.5px] text-muted tabular">{fmt(unit.times(q), item.currency)}</p>}
                  {belowMoq && !err && <p className="text-[11.5px] text-[var(--warn-fg)]">Below your minimum of {item.moq} pcs</p>}
                  {err && (
                    <p id={`qty-${i}-err`} className="text-[11.5px] text-[var(--bad-fg)]">
                      {err}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardTitle>Delivery</CardTitle>
          <div className="flex flex-col gap-3">
            <Field label="Deliver by" htmlFor="requestedDeliveryOn" error={fe.requestedDeliveryOn}>
              <Input id="requestedDeliveryOn" type="date" min={today} required {...bind("requestedDeliveryOn")} />
            </Field>
            {addresses.length > 0 && (
              <Field label="Deliver to" htmlFor="shipToAddressId" error={fe.shipToAddressId}>
                <Select id="shipToAddressId" {...bind("shipToAddressId")}>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.text}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Your PO number (optional)" htmlFor="customerPoNumber" error={fe.customerPoNumber}>
              <Input id="customerPoNumber" maxLength={60} autoComplete="off" {...bind("customerPoNumber")} />
            </Field>
            <Field label="Note to Bryel's Care (optional)" htmlFor="note" error={fe.note}>
              <Textarea id="note" maxLength={500} rows={3} {...bind("note")} />
            </Field>
          </div>
        </Card>
        <Card className="lg:sticky lg:top-4">
          <CardTitle>Summary</CardTitle>
          <p className="text-[13px] text-muted">
            {count} product{count === 1 ? "" : "s"} · estimated before tax
          </p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular">{fmt(total, currency)}</p>
          <p className="mb-3 mt-1 text-[12px] text-muted">Prices come from your approved price list. Bryel&apos;s Care checks every order; you see its status under My orders.</p>
          <FormMessage state={state} />
          <div className="mt-3">
            <SubmitButton size="lg" variant="cta" className="w-full" pendingText="Sending your order…" disabled={count === 0}>
              Place order
            </SubmitButton>
          </div>
        </Card>
      </div>
    </form>
  );
}
