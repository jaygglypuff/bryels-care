"use client";
import Decimal from "decimal.js";
import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { fmtFriendly, toBaseQty, unitChoices } from "@/lib/units";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { createOrderAction } from "../../actions";

type Mat = {
  id: string;
  name: string;
  code: string;
  baseUom: string;
  leadTimeDays: number | null;
  moqQty: string | null;
  moqUom: string | null;
  packQty: string | null;
  packUom: string | null;
  priceUom: string | null;
  unitPrice: string | null;
  brand: string | null;
};
type Row = { key: number; materialId: string; qty: string; unit: string; unitAmount: string; requestLineId: string | null; requestNumber: string | null };

const STEP_NAMES = ["Supplier", "Items", "When", "Check and send"] as const;

/** Where you are in the four steps (shared by the server page for step 1). */
export function WizardSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol aria-label="Steps" className="mb-4 grid grid-cols-4 gap-1.5 text-[12px] sm:text-[13px]">
      {STEP_NAMES.map((n, i) => {
        const k = i + 1;
        return (
          <li key={n} aria-current={k === current ? "step" : undefined} className={cx("flex min-h-[40px] flex-col items-center justify-center rounded-[10px] border px-1 text-center leading-tight", k === current ? "border-ring bg-primary-soft font-semibold text-fg" : k < current ? "border-line text-fg-2" : "border-line text-muted")}>
            <span className="inline-flex items-center gap-1">
              {k < current ? <Check size={12} aria-hidden /> : `${k}.`} {n}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const peso = (d: Decimal) => "₱" + d.toNumber().toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const niceDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function defaultUnit(m: Mat | undefined): string {
  if (!m) return "";
  const c = unitChoices(m.baseUom);
  if (m.packUom && c.includes(m.packUom)) return m.packUom;
  if (m.priceUom && c.includes(m.priceUom)) return m.priceUom;
  return c[0];
}
function defaultQty(m: Mat | undefined): string {
  if (!m?.packQty) return "";
  if (m.packUom && unitChoices(m.baseUom).includes(m.packUom)) return String(Number(m.packQty));
  return "";
}

/** About how much one row costs, from the supplier price (kg/g, L/mL, pcs only); null when it cannot be worked out here. */
function estimate(r: Row, m: Mat | undefined): Decimal | null {
  if (!m || !r.qty.trim()) return null;
  const q = toBaseQty(r.qty, r.unit, m.baseUom);
  if (!q.ok) return null;
  if (r.unitAmount.trim()) {
    const p = toBaseQty("1", r.unit, m.baseUom);
    if (!p.ok || !/^\d+(\.\d+)?$/.test(r.unitAmount.trim())) return null;
    return q.qtyBase.div(p.qtyBase).times(r.unitAmount.trim());
  }
  if (!m.unitPrice || !m.priceUom) return null;
  const per = toBaseQty("1", m.priceUom, m.baseUom);
  if (!per.ok) return null;
  return q.qtyBase.div(per.qtyBase).times(m.unitPrice);
}

/**
 * Steps 2–4 of the new purchase order. Every field sits in ONE form so nothing typed is lost between steps;
 * hidden steps keep their inputs. No field in a hidden step is `required` (the browser cannot show the
 * message); the "Next" buttons check here and the server checks everything again on save.
 */
export function NewOrderWizard({
  supplier,
  materials,
  fromRequests,
  warehouses,
  prices,
  today,
  canSubmit,
}: {
  supplier: { id: string; name: string; paymentTermsDays: number | null };
  materials: Mat[];
  fromRequests: { id: string; materialId: string; requestNumber: string; qty: string; uom: string }[];
  warehouses: { id: string; name: string; code: string }[];
  prices: boolean;
  today: string;
  canSubmit: boolean;
}) {
  const [state, dispatch] = useInPlaceAction(createOrderAction);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const initial: Row[] = fromRequests.length
    ? fromRequests.map((l, i) => ({ key: i, materialId: l.materialId, qty: l.qty, unit: l.uom, unitAmount: "", requestLineId: l.id, requestNumber: l.requestNumber }))
    : [{ key: 0, materialId: materials.length === 1 ? materials[0].id : "", qty: defaultQty(materials.length === 1 ? materials[0] : undefined), unit: defaultUnit(materials.length === 1 ? materials[0] : undefined), unitAmount: "", requestLineId: null, requestNumber: null }];
  const [rows, setRows] = useState<Row[]>(initial);
  const [seq, setSeq] = useState(initial.length);
  const [step, setStep] = useState<2 | 3 | 4>(2);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = rows.filter((r) => r.materialId && r.qty.trim());
  const lead = Math.max(0, ...chosen.map((r) => byId.get(r.materialId)?.leadTimeDays ?? 0));
  const suggested = plusDays(today, lead);
  const [arrive, setArrive] = useState<string | null>(null); // null = follows the suggested date
  const arriveOn = arrive ?? suggested;
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const total = chosen.reduce<Decimal | null>((s, r) => {
    const e = estimate(r, byId.get(r.materialId));
    return s && e ? s.plus(e) : null;
  }, new Decimal(0));
  const fe = state?.fieldErrors ?? {};

  const goTo = (n: 2 | 3 | 4) => {
    if (n > 2) {
      if (!chosen.length) return setProblem("Pick at least one item and type how much.");
      for (const r of chosen) {
        const m = byId.get(r.materialId)!;
        const q = toBaseQty(r.qty, r.unit, m.baseUom);
        if (!q.ok) return setProblem(`${m.name}: ${q.message}`);
        if (q.qtyBase.lte(0)) return setProblem(`${m.name}: type an amount above zero.`);
      }
    }
    if (n > 3 && arriveOn < today) return setProblem("The delivery date cannot be before today.");
    setProblem(null);
    setStep(n);
  };

  return (
    <form action={dispatch} className="flex flex-col gap-4" data-testid="po-wizard">
      <input type="hidden" name="supplierId" value={supplier.id} />
      <Card>
        <WizardSteps current={step} />
        <p className="mb-3 text-[14px] text-fg-2">
          Supplier: <strong className="text-fg">{supplier.name}</strong> ·{" "}
          <a className="text-primary-text underline" href="/procurement/orders/new">
            change
          </a>
        </p>

        {/* Step 2: items */}
        <section hidden={step !== 2} aria-label="Items">
          <CardTitle>2. What do we buy?</CardTitle>
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const m = byId.get(r.materialId);
              const est = estimate(r, m);
              return (
                <li key={r.key} className="rounded-[14px] border border-line p-3" data-testid="po-item">
                  {r.requestLineId && <input type="hidden" name={`lines.${i}.purchaseRequestLineId`} value={r.requestLineId} />}
                  <input type="hidden" name={`lines.${i}.expectedDate`} value={arriveOn} />
                  <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                    <Field label="Item" htmlFor={`item-${r.key}`} error={fe[`lines.${i}.materialId`]}>
                      <Select
                        id={`item-${r.key}`}
                        name={`lines.${i}.materialId`}
                        value={r.materialId}
                        onChange={(e) => {
                          const nm = byId.get(e.target.value);
                          set(r.key, { materialId: e.target.value, unit: defaultUnit(nm), qty: r.qty || defaultQty(nm) });
                        }}
                      >
                        <option value="">Pick an item…</option>
                        {materials.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.brand ? ` (${x.brand})` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="How much" htmlFor={`qty-${r.key}`} error={fe[`lines.${i}.qty`] ?? fe[`lines.${i}.uom`]}>
                      <QtyUnitInput id={`qty-${r.key}`} baseUom={m?.baseUom ?? "*"} name={`lines.${i}.qty`} unitName={`lines.${i}.uom`} qty={r.qty} onQtyChange={(v) => set(r.key, { qty: v })} unit={r.unit} onUnitChange={(u) => set(r.key, { unit: u })} />
                    </Field>
                  </div>
                  {m && (
                    <p className="mt-1 text-[13px] text-fg-2">
                      {m.packQty && m.packUom ? `Comes in ${Number(m.packQty).toLocaleString("en-PH")} ${m.packUom} packs. ` : ""}
                      {m.moqQty ? `Order at least ${Number(m.moqQty).toLocaleString("en-PH")} ${m.moqUom ?? ""}. ` : ""}
                      {m.leadTimeDays !== null ? `Takes about ${m.leadTimeDays} day(s) to arrive. ` : ""}
                      {prices && m.unitPrice && m.priceUom ? `Supplier price ${peso(new Decimal(m.unitPrice))} per ${m.priceUom}.` : ""}
                      {r.requestNumber ? ` From request to buy ${r.requestNumber}.` : ""}
                      <span className="ml-1 font-mono text-[12px] text-muted">{m.code}</span>
                    </p>
                  )}
                  {prices && est && <p className="mt-1 text-[14px] font-medium tabular-nums">About {peso(est)}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {prices && (
                      <details className="min-w-0 flex-1">
                        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">A different price (you can skip this)</summary>
                        <Field label={`Price per ${r.unit || "unit"} (₱)`} htmlFor={`price-${r.key}`} hint="Leave empty to use the supplier price." error={fe[`lines.${i}.unitAmount`]}>
                          <Input id={`price-${r.key}`} name={`lines.${i}.unitAmount`} inputMode="decimal" value={r.unitAmount} onChange={(e) => set(r.key, { unitAmount: e.target.value })} placeholder="0.00" />
                        </Field>
                      </details>
                    )}
                    {rows.length > 1 && (
                      <Button type="button" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${m?.name ?? "this item"}`}>
                        <Trash2 size={16} aria-hidden /> Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRows((rs) => [...rs, { key: seq, materialId: "", qty: "", unit: "", unitAmount: "", requestLineId: null, requestNumber: null }]);
                setSeq(seq + 1);
              }}
            >
              <Plus size={16} aria-hidden /> Add another item
            </Button>
            {prices && total && chosen.length > 0 && <span className="text-[14px] tabular-nums text-fg-2">Items so far: about {peso(total)}</span>}
          </div>
        </section>

        {/* Step 3: when */}
        <section hidden={step !== 3} aria-label="When">
          <CardTitle>3. When should it arrive?</CardTitle>
          <Field label="Arrives on" htmlFor="arrive" hint={lead ? `Suggested: today + ${lead} day(s), the longest time the supplier needs for these items.` : "Suggested: today."}>
            <Input id="arrive" type="date" min={today} value={arriveOn} onChange={(e) => setArrive(e.target.value || null)} />
          </Field>
          <div className="mt-4">
            <MoreDetails>
              <Field label="Deliver to" htmlFor="shipToWarehouseId">
                <Select id="shipToWarehouseId" name="shipToWarehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                  <option value="">The site&apos;s usual store room</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="We pay within (days)" htmlFor="paymentTermsDays" hint="From the supplier's terms." error={fe.paymentTermsDays}>
                <Input id="paymentTermsDays" name="paymentTermsDays" inputMode="numeric" defaultValue={supplier.paymentTermsDays ?? ""} />
              </Field>
              {prices && (
                <Field label="Tax on the supplier's quote (₱)" htmlFor="taxAmount" hint="Copy it from the quote. The system does not work out tax here; ask the accountant." error={fe.taxAmount}>
                  <Input id="taxAmount" name="taxAmount" inputMode="decimal" placeholder="0.00" />
                </Field>
              )}
              <Field label="Note for the supplier" htmlFor="notes">
                <Textarea id="notes" name="notes" rows={2} />
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
                <input type="checkbox" name="isUrgent" value="yes" className="h-5 w-5" /> Urgent (no request to buy; the owner is told)
              </label>
              <Field label="Why urgent" htmlFor="urgentReason" error={fe.urgentReason}>
                <Input id="urgentReason" name="urgentReason" />
              </Field>
            </MoreDetails>
          </div>
        </section>

        {/* Step 4: check and send */}
        <section hidden={step !== 4} aria-label="Check and send">
          <CardTitle>4. Check and send</CardTitle>
          <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {chosen.map((r) => {
              const m = byId.get(r.materialId)!;
              const q = toBaseQty(r.qty, r.unit, m.baseUom);
              const est = estimate(r, m);
              return (
                <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.name}</span>
                    <span className="text-[13px] text-fg-2">{q.ok ? fmtFriendly(q.qtyBase, m.baseUom) : r.qty}</span>
                  </span>
                  {prices && <span className="shrink-0 text-right font-semibold tabular-nums">{est ? peso(est) : "price on save"}</span>}
                </li>
              );
            })}
            {prices && (
              <li className="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2.5 font-semibold">
                <span>Total before tax</span>
                <span className="tabular-nums">{total ? `about ${peso(total)}` : "worked out on save"}</span>
              </li>
            )}
          </ul>
          <p className="mt-3 text-[15px]">
            Arrives on <strong>{niceDate(arriveOn)}</strong> from <strong>{supplier.name}</strong>.
          </p>
          <p className="mt-1 text-[14px] text-fg-2">{canSubmit ? "“Save and send for approval” saves the order and asks the manager to approve it. After approval you send it to the supplier." : "Saving keeps it as a draft; someone who may send orders for approval does that next."}</p>
        </section>

        {problem && (
          <p role="alert" className="mt-3 rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[14px] text-[var(--bad-fg)]">
            {problem}
          </p>
        )}
        <div className="mt-3">
          <FormMessage state={state} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {step > 2 && (
            <Button type="button" variant="secondary" onClick={() => goTo((step - 1) as 2 | 3)}>
              Back
            </Button>
          )}
          {step < 4 ? (
            <Button type="button" variant="cta" onClick={() => goTo((step + 1) as 3 | 4)}>
              Next
            </Button>
          ) : (
            <>
              {canSubmit && (
                <SubmitButton variant="cta" name="intent" value="submit" pendingText="Saving…">
                  Save and send for approval
                </SubmitButton>
              )}
              <SubmitButton variant={canSubmit ? "secondary" : "cta"} name="intent" value="draft" pendingText="Saving…">
                Save as draft
              </SubmitButton>
            </>
          )}
        </div>
      </Card>
    </form>
  );
}
