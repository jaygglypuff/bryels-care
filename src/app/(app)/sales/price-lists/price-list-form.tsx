"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Input, Select } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../use-action-form";
import { savePriceListAction } from "./actions";

type Line = { key: number; productId: string; minQtyUnits: string; unitAmount: string };
export type PriceListFormInitial = { priceListId: string; code: string; name: string; partyKind: "customer" | "general"; customerId: string; effectiveFrom: string; changeSummary: string; lines: Omit<Line, "key">[] };

/** Draft a price list version (US-4-03): customer or general, effective date, prices with quantity breaks. */
export function PriceListForm({ customers, products, today, initial, initialCustomerId }: { customers: { id: string; code: string; name: string }[]; products: { id: string; skuCode: string; name: string }[]; today: string; initial?: PriceListFormInitial; initialCustomerId?: string }) {
  const { state, pending, onSubmit } = useActionForm(savePriceListAction);
  const [v, setV] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    partyKind: initial?.partyKind ?? (initialCustomerId ? "customer" : "general"),
    customerId: initial?.customerId ?? initialCustomerId ?? "",
    effectiveFrom: initial?.effectiveFrom ?? today,
    changeSummary: initial?.changeSummary ?? "",
  });
  const [lines, setLines] = useState<Line[]>((initial?.lines.length ? initial.lines : [{ productId: "", minQtyUnits: "0", unitAmount: "" }]).map((l, i) => ({ ...l, key: i + 1 })));
  const [nextKey, setNextKey] = useState(lines.length + 1);
  const [submitNow, setSubmitNow] = useState(false);
  const fe = state?.fieldErrors ?? {};
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4">
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ productId, minQtyUnits, unitAmount }) => ({ productId, minQtyUnits, unitAmount })))} />
      {initial && <input type="hidden" name="priceListId" value={initial.priceListId} />}
      {initial && <input type="hidden" name="code" value={initial.code} />}
      {initial && <input type="hidden" name="partyKind" value={initial.partyKind} />}
      {initial && <input type="hidden" name="customerId" value={initial.customerId} />}
      <Card>
        <CardTitle>List</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="code" error={fe.code} hint="Same code = new version of the same list">
            <Input id="code" name={initial ? undefined : "code"} value={v.code} onChange={set("code")} disabled={!!initial} required maxLength={30} autoCapitalize="characters" />
          </Field>
          <Field label="Name" htmlFor="name" error={fe.name}>
            <Input id="name" name="name" value={v.name} onChange={set("name")} required maxLength={120} />
          </Field>
          <Field label="For" htmlFor="partyKind" error={fe.partyKind}>
            <Select id="partyKind" name={initial ? undefined : "partyKind"} value={v.partyKind} onChange={set("partyKind")} disabled={!!initial}>
              <option value="general">All customers without their own list (general)</option>
              <option value="customer">One customer</option>
            </Select>
          </Field>
          {v.partyKind === "customer" && (
            <Field label="Customer" htmlFor="customerId" error={fe.customerId}>
              <Select id="customerId" name={initial ? undefined : "customerId"} value={v.customerId} onChange={set("customerId")} disabled={!!initial} required>
                <option value="">Choose…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Effective from" htmlFor="effectiveFrom" error={fe.effectiveFrom} hint="The previous approved version ends on this date">
            <Input id="effectiveFrom" name="effectiveFrom" type="date" value={v.effectiveFrom} onChange={set("effectiveFrom")} required />
          </Field>
          <Field label="What changed (optional)" htmlFor="changeSummary" error={fe.changeSummary}>
            <Input id="changeSummary" name="changeSummary" value={v.changeSummary} onChange={set("changeSummary")} maxLength={300} />
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
                setLines((ls) => [...ls, { key: nextKey, productId: "", minQtyUnits: "0", unitAmount: "" }]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus size={14} /> Add price
            </Button>
          }
        >
          Prices (₱ per piece)
        </CardTitle>
        {fe.lines && <p className="mb-2 text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
        <ol className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-2 gap-3 rounded-[12px] border border-line p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="col-span-2 md:col-span-1">
                <Field label={`Product (line ${i + 1})`} htmlFor={`pl-p-${l.key}`} error={fe[`lines.${i}.productId`]}>
                  <Select id={`pl-p-${l.key}`} value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value })} required>
                    <option value="">Choose…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.skuCode} · {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="From qty (pcs)" htmlFor={`pl-q-${l.key}`} error={fe[`lines.${i}.minQtyUnits`]}>
                <Input id={`pl-q-${l.key}`} inputMode="numeric" value={l.minQtyUnits} onChange={(e) => update(l.key, { minQtyUnits: e.target.value })} />
              </Field>
              <Field label="Price (₱)" htmlFor={`pl-u-${l.key}`} error={fe[`lines.${i}.unitAmount`]}>
                <Input id={`pl-u-${l.key}`} inputMode="decimal" value={l.unitAmount} onChange={(e) => update(l.key, { unitAmount: e.target.value })} required />
              </Field>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 size={14} /> Remove
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="submitNow" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} /> Send for approval after saving
      </label>
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="cta" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
