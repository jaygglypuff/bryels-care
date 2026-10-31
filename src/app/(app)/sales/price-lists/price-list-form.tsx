"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardTitle, Field, Input, Select } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { NamePicker } from "../name-picker";
import { useActionForm } from "../use-action-form";
import { savePriceListAction } from "./actions";

type Line = { key: number; productId: string; minQtyUnits: string; unitAmount: string };
export type PriceListFormInitial = { priceListId: string; code: string; name: string; partyKind: "customer" | "general"; customerId: string; effectiveFrom: string; changeSummary: string; lines: Omit<Line, "key">[] };

/**
 * Prices for a customer or for everyone (US-4-03, ADR-088 grade-5 form): who, from when, and the price of each
 * product. The system names and numbers the list (the customer's list keeps its number, so this becomes its next
 * version); name, number and "what changed" sit under More details.
 */
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
  const productOptions = [...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, also: p.skuCode }));
  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4">
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ productId, minQtyUnits, unitAmount }) => ({ productId, minQtyUnits, unitAmount })))} />
      {initial && <input type="hidden" name="priceListId" value={initial.priceListId} />}
      {initial && <input type="hidden" name="code" value={initial.code} />}
      {initial && <input type="hidden" name="partyKind" value={initial.partyKind} />}
      {initial && <input type="hidden" name="customerId" value={initial.customerId} />}
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prices for" htmlFor="partyKind" error={fe.partyKind}>
            <Select id="partyKind" name={initial ? undefined : "partyKind"} value={v.partyKind} onChange={set("partyKind")} disabled={!!initial}>
              <option value="general">Everyone (customers without their own prices)</option>
              <option value="customer">One customer</option>
            </Select>
          </Field>
          {v.partyKind === "customer" && (
            <Field label="Customer" htmlFor="customerId" error={fe.customerId}>
              <NamePicker
                id="customerId"
                name={initial ? undefined : "customerId"}
                value={v.customerId}
                disabled={!!initial}
                required
                placeholder="Choose the customer…"
                searchLabel="Type part of the customer's name"
                options={customers.map((c) => ({ value: c.id, label: c.name, also: c.code }))}
                onChange={(id) => setV({ ...v, customerId: id })}
              />
            </Field>
          )}
          <Field label="Starts on" htmlFor="effectiveFrom" error={fe.effectiveFrom} hint="The old prices stop on this day">
            <Input id="effectiveFrom" name="effectiveFrom" type="date" value={v.effectiveFrom} onChange={set("effectiveFrom")} required />
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
              <Plus size={14} aria-hidden /> Add a product
            </Button>
          }
        >
          Price of each product (₱ per piece)
        </CardTitle>
        {fe.lines && <p className="mb-2 text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
        <ol className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-2 gap-3 rounded-[12px] border border-line p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="col-span-2 md:col-span-1">
                <Field label={`Product ${i + 1}`} htmlFor={`pl-p-${l.key}`} error={fe[`lines.${i}.productId`]}>
                  <NamePicker id={`pl-p-${l.key}`} value={l.productId} required placeholder="Choose a product…" searchLabel="Type part of the product name" options={productOptions} onChange={(id) => update(l.key, { productId: id })} />
                </Field>
              </div>
              <Field label="Price (₱)" htmlFor={`pl-u-${l.key}`} error={fe[`lines.${i}.unitAmount`]}>
                <Input id={`pl-u-${l.key}`} inputMode="decimal" value={l.unitAmount} onChange={(e) => update(l.key, { unitAmount: e.target.value })} required />
              </Field>
              <Field label="When they buy at least (pcs)" htmlFor={`pl-q-${l.key}`} error={fe[`lines.${i}.minQtyUnits`]} hint="0 = any amount">
                <Input id={`pl-q-${l.key}`} inputMode="numeric" value={l.minQtyUnits} onChange={(e) => update(l.key, { minQtyUnits: e.target.value })} />
              </Field>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove product ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 size={14} aria-hidden /> Remove
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>
      <MoreDetails open={!!(fe.name || fe.code || fe.changeSummary)}>
        <Field label="Name (optional)" htmlFor="name" error={fe.name} hint="Leave empty: “Prices for <customer>” or “General prices”.">
          <Input id="name" name="name" value={v.name} onChange={set("name")} maxLength={120} />
        </Field>
        <Field label="Number of these prices (optional)" htmlFor="code" error={fe.code} hint="Leave empty: the customer's prices keep their number, so this is their next version.">
          <Input id="code" name={initial ? undefined : "code"} value={v.code} onChange={set("code")} disabled={!!initial} maxLength={30} autoCapitalize="characters" placeholder="Given by the system" />
        </Field>
        <Field label="What changed (optional)" htmlFor="changeSummary" error={fe.changeSummary}>
          <Input id="changeSummary" name="changeSummary" value={v.changeSummary} onChange={set("changeSummary")} maxLength={300} placeholder="e.g. New soap prices from November" />
        </Field>
      </MoreDetails>
      <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="checkbox" name="submitNow" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} className="size-5" /> Send for approval after saving
      </label>
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="cta" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save the prices"}
        </Button>
      </div>
    </form>
  );
}
