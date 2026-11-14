"use client";
import Decimal from "decimal.js";
import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { fmtFriendly, toBaseQty, unitChoices } from "@/lib/units";
import { belowMinimum, startingOrderQty } from "@/lib/po-amount";
import { suggestArrival, isSunday } from "@/lib/arrive-date";
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
type LastPrice = { materialId: string; unitAmount: string; uom: string; poNumber: string; orderDate: string };
type Row = { key: number; materialId: string; qty: string; unit: string; unitAmount: string; requestLineId: string | null; requestNumber: string | null; priceFrom: string | null };

const STEP_NAMES = ["Supplier", "Items", "When", "Check and save"] as const;

/** Where you are in the four steps (shared by the server page for step 1). */
export function WizardSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol aria-label="Steps" className="mb-4 grid grid-cols-4 gap-1.5 text-[12px] sm:text-[13px]">
      {STEP_NAMES.map((n, i) => {
        const k = i + 1;
        return (
          <li key={n} aria-current={k === current ? "step" : undefined} className={cx("flex min-h-[40px] flex-col items-center justify-center rounded-[6px] border px-1 text-center leading-tight", k === current ? "border-ring bg-primary-soft font-semibold text-fg" : k < current ? "border-line text-fg-2" : "border-line text-muted")}>
            <span className="inline-flex items-center gap-1">
              {k < current ? <Check size={12} aria-hidden /> : `${k}.`} {n}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const peso = (d: Decimal) => "₱" + d.toNumber().toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const niceDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const isPrice = (v: string) => /^\d+(\.\d{1,4})?$/.test(v.trim());

function defaultUnit(m: Mat | undefined): string {
  if (!m) return "";
  const c = unitChoices(m.baseUom);
  if (m.packUom && c.includes(m.packUom)) return m.packUom;
  if (m.priceUom && c.includes(m.priceUom)) return m.priceUom;
  return c[0];
}
/** Starts at the larger of the supplier's minimum order and one pack (UX audit B #13), in the line's starting unit. */
function defaultQty(m: Mat | undefined): string {
  if (!m) return "";
  return startingOrderQty(m, defaultUnit(m));
}

/**
 * ADR-131 (C-office problem 8): the price a line starts with, per the line's unit, and where it came from: the last
 * price paid to this supplier, else the supplier's price list, else nothing (the clerk types it). Never hidden.
 */
function startingPrice(m: Mat | undefined, unit: string, last: LastPrice | undefined): { amount: string; from: string | null } {
  if (!m || !unit) return { amount: "", from: null };
  const per = (fromAmount: string, fromUom: string): string | null => {
    const a = toBaseQty("1", unit, m.baseUom);
    const b = toBaseQty("1", fromUom, m.baseUom);
    if (!a.ok || !b.ok || b.qtyBase.lte(0)) return null;
    return a.qtyBase.div(b.qtyBase).times(fromAmount).toDecimalPlaces(4).toString();
  };
  if (last) {
    const v = per(last.unitAmount, last.uom);
    if (v) return { amount: v, from: `Last time ${peso(new Decimal(last.unitAmount))} per ${last.uom} on ${last.poNumber}` };
  }
  if (m.unitPrice && m.priceUom) {
    const v = per(m.unitPrice, m.priceUom);
    if (v) return { amount: v, from: `Supplier price ${peso(new Decimal(m.unitPrice))} per ${m.priceUom}` };
  }
  return { amount: "", from: null };
}

/** About how much one row costs; null when it cannot be worked out here. */
function estimate(r: Row, m: Mat | undefined): Decimal | null {
  if (!m || !r.qty.trim() || !isPrice(r.unitAmount)) return null;
  const q = toBaseQty(r.qty, r.unit, m.baseUom);
  const p = toBaseQty("1", r.unit, m.baseUom);
  if (!q.ok || !p.ok || p.qtyBase.lte(0)) return null;
  return q.qtyBase.div(p.qtyBase).times(r.unitAmount.trim());
}

/**
 * Steps 2–4 of the new purchase order. Every field sits in ONE form so nothing typed is lost between steps;
 * hidden steps keep their inputs. No field in a hidden step is `required` (the browser cannot show the
 * message); the "Next" buttons check here, in words, under the field, and the server checks everything again on
 * save. A server error on a line brings the clerk back to step 2 with the message under that line.
 */
export function NewOrderWizard({
  supplier,
  materials,
  fromRequests,
  lastPrices,
  warehouses,
  prices,
  today,
  neededBy,
  approvedAmount,
  changeHref,
  canSubmit,
}: {
  supplier: { id: string; name: string; paymentTermsDays: number | null };
  materials: Mat[];
  fromRequests: { id: string; materialId: string; requestNumber: string; qty: string; uom: string; price: string | null }[];
  lastPrices: LastPrice[];
  warehouses: { id: string; name: string; code: string }[];
  prices: boolean;
  today: string;
  neededBy: string | null;
  approvedAmount: number | null;
  changeHref: string;
  canSubmit: boolean;
}) {
  const [state, dispatch] = useInPlaceAction(createOrderAction);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const lastOf = new Map(lastPrices.map((p) => [p.materialId, p]));
  const firstRow = (key: number, m: Mat | undefined): Row => {
    const unit = defaultUnit(m);
    const p = prices ? startingPrice(m, unit, m ? lastOf.get(m.id) : undefined) : { amount: "", from: null };
    return { key, materialId: m?.id ?? "", qty: defaultQty(m), unit, unitAmount: p.amount, requestLineId: null, requestNumber: null, priceFrom: p.from };
  };
  const initial: Row[] = fromRequests.length
    ? fromRequests.map((l, i) => {
        const m = byId.get(l.materialId);
        const p = l.price ? { amount: l.price, from: `From the request ${l.requestNumber}` } : prices ? startingPrice(m, l.uom, lastOf.get(l.materialId)) : { amount: "", from: null };
        return { key: i, materialId: l.materialId, qty: l.qty, unit: l.uom, unitAmount: p.amount, requestLineId: l.id, requestNumber: l.requestNumber, priceFrom: p.from };
      })
    : [firstRow(0, materials.length === 1 ? materials[0] : undefined)];
  const [rows, setRows] = useState<Row[]>(initial);
  const [seq, setSeq] = useState(initial.length);
  const [step, setStep] = useState<2 | 3 | 4>(2);
  const [problem, setProblem] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const chosen = rows.filter((r) => r.materialId && r.qty.trim());
  const lead = Math.max(0, ...chosen.map((r) => byId.get(r.materialId)?.leadTimeDays ?? 0));
  const suggestion = suggestArrival({ today, leadDays: lead, neededBy });
  const [arrive, setArrive] = useState<string | null>(null); // null = follows the suggested date
  const arriveOn = arrive ?? suggestion.date;
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const total = chosen.reduce<Decimal | null>((s, r) => {
    const e = estimate(r, byId.get(r.materialId));
    return s && e ? s.plus(e) : null;
  }, new Decimal(0));
  const fe = { ...lineErrors, ...(state?.fieldErrors ?? {}) };
  // A server refusal on an item (price, amount, unit) belongs to step 2: go back there so the message sits under it.
  useEffect(() => {
    if (state?.fieldErrors && Object.keys(state.fieldErrors).some((k) => k.startsWith("lines."))) setStep(2);
  }, [state]);
  const covered = approvedAmount !== null && total !== null && total.lte(approvedAmount);

  const goTo = (n: 2 | 3 | 4) => {
    if (n > 2) {
      const errs: Record<string, string> = {};
      if (!chosen.length) return setProblem("Pick at least one item and type how much.");
      chosen.forEach((r) => {
        const i = rows.indexOf(r);
        const m = byId.get(r.materialId)!;
        const q = toBaseQty(r.qty, r.unit, m.baseUom);
        if (!q.ok) errs[`lines.${i}.qty`] = `${m.name}: ${q.message}`;
        else if (q.qtyBase.lte(0)) errs[`lines.${i}.qty`] = `Type how much ${m.name} to buy (more than zero).`;
        if (prices && !isPrice(r.unitAmount)) errs[`lines.${i}.unitAmount`] = r.unitAmount.trim() ? `Type the price of ${m.name} as a number, for example 9.50.` : `Type the price of ${m.name}.`;
      });
      setLineErrors(errs);
      if (Object.keys(errs).length) return setProblem(Object.values(errs)[0]);
    }
    if (n > 3 && arriveOn <= today) return setProblem("Choose a day after today for the delivery.");
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
          <a className="text-primary-text underline" href={changeHref}>
            change
          </a>
        </p>

        {/* Step 2: items, with the price visible (it is needed) */}
        <section hidden={step !== 2} aria-label="Items">
          <CardTitle>2. What do we buy?</CardTitle>
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const m = byId.get(r.materialId);
              const est = estimate(r, m);
              const last = m ? lastOf.get(m.id) : undefined;
              const lastPer = m && last ? startingPrice(m, r.unit, last).amount : "";
              const differs = prices && lastPer && isPrice(r.unitAmount) && !new Decimal(r.unitAmount).eq(lastPer);
              return (
                <li key={r.key} className="rounded-[8px] border border-line p-3" data-testid="po-item">
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
                          const unit = defaultUnit(nm);
                          const p = prices ? startingPrice(nm, unit, nm ? lastOf.get(nm.id) : undefined) : { amount: "", from: null };
                          set(r.key, { materialId: e.target.value, unit, qty: r.qty || defaultQty(nm), unitAmount: p.amount, priceFrom: p.from });
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
                      <QtyUnitInput
                        id={`qty-${r.key}`}
                        baseUom={m?.baseUom ?? "*"}
                        name={`lines.${i}.qty`}
                        unitName={`lines.${i}.uom`}
                        qty={r.qty}
                        onQtyChange={(v) => set(r.key, { qty: v })}
                        unit={r.unit}
                        onUnitChange={(u) => {
                          // Keep the price per the new unit (₱185 per kg → ₱0.185 per g), never silently wrong.
                          const conv = m && isPrice(r.unitAmount) ? (() => {
                            const a = toBaseQty("1", u, m.baseUom);
                            const b = toBaseQty("1", r.unit, m.baseUom);
                            return a.ok && b.ok && b.qtyBase.gt(0) ? a.qtyBase.div(b.qtyBase).times(r.unitAmount).toDecimalPlaces(4).toString() : r.unitAmount;
                          })() : r.unitAmount;
                          set(r.key, { unit: u, unitAmount: conv });
                        }}
                      />
                    </Field>
                  </div>
                  {prices && (
                    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                      <Field label={`Price per ${r.unit || "unit"} (₱) (needed)`} htmlFor={`price-${r.key}`} error={fe[`lines.${i}.unitAmount`]} hint={r.priceFrom ?? (m ? "No price yet from this supplier: type the price they told you." : undefined)}>
                        <Input id={`price-${r.key}`} name={`lines.${i}.unitAmount`} inputMode="decimal" value={r.unitAmount} onChange={(e) => set(r.key, { unitAmount: e.target.value, priceFrom: r.priceFrom })} placeholder="0.00" data-testid="po-price" />
                      </Field>
                      <div className="flex min-w-0 flex-col justify-end gap-1 pb-1 text-[14px]">
                        {est && <p className="font-medium tabular-nums">About {peso(est)}</p>}
                        {differs && last && (
                          <p role="status" className="rounded-[8px] bg-[var(--warn-bg)] px-2 py-1 text-[13px] text-[var(--warn-fg)]" data-testid="price-differs">
                            Last time it was {peso(new Decimal(lastPer))} per {r.unit} ({last.poNumber}). Check the price with the supplier.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {m && (
                    <p className="mt-1 text-[13px] text-fg-2">
                      {m.packQty && m.packUom ? `Comes in ${Number(m.packQty).toLocaleString("en-PH")} ${m.packUom} packs. ` : ""}
                      {m.moqQty ? `Order at least ${Number(m.moqQty).toLocaleString("en-PH")} ${m.moqUom ?? ""}. ` : ""}
                      {m.leadTimeDays !== null ? `Takes about ${m.leadTimeDays === 1 ? "1 day" : `${m.leadTimeDays} days`} to arrive. ` : ""}
                      {r.requestNumber ? ` From request to buy ${r.requestNumber}.` : ""}
                    </p>
                  )}
                  {rows.length > 1 && (
                    <div className="mt-2">
                      <Button type="button" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${m?.name ?? "this item"}`}>
                        <Trash2 size={16} aria-hidden /> Remove
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRows((rs) => [...rs, { key: seq, materialId: "", qty: "", unit: "", unitAmount: "", requestLineId: null, requestNumber: null, priceFrom: null }]);
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
          <Field
            label="Arrives on"
            htmlFor="arrive"
            hint={
              suggestion.why === "request"
                ? `Suggested: the day the request needs it (${niceDate(suggestion.date)}).`
                : suggestion.why === "lead_time"
                  ? `Suggested: ${niceDate(suggestion.date)}, the longest time the supplier needs for these items (${lead === 1 ? "1 day" : `${lead} days`}).`
                  : `Suggested: ${niceDate(suggestion.date)} (never today or a Sunday).`
            }
          >
            <Input id="arrive" type="date" min={today} value={arriveOn} onChange={(e) => setArrive(e.target.value || null)} />
          </Field>
          <p className="mt-1 text-[14px] text-fg-2" aria-live="polite">
            {niceDate(arriveOn)}
            {isSunday(arriveOn) ? " · this is a Sunday: is the supplier open?" : ""}
          </p>
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

        {/* Step 4: check and save */}
        <section hidden={step !== 4} aria-label="Check and save">
          <CardTitle>4. Check and save</CardTitle>
          <ul className="flex flex-col divide-y divide-line rounded-[8px] border border-line">
            {chosen.map((r) => {
              const m = byId.get(r.materialId)!;
              const q = toBaseQty(r.qty, r.unit, m.baseUom);
              const est = estimate(r, m);
              const low = belowMinimum(m, r.qty, r.unit);
              return (
                <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.name}</span>
                    <span className="text-[13px] text-fg-2">
                      {q.ok ? fmtFriendly(q.qtyBase, m.baseUom) : r.qty}
                      {prices && isPrice(r.unitAmount) ? ` at ${peso(new Decimal(r.unitAmount))} per ${r.unit}` : ""}
                    </span>
                    {low && (
                      <span role="status" className="mt-1 block rounded-[8px] bg-[var(--warn-bg)] px-2 py-1 text-[13px] text-[var(--warn-fg)]" data-testid="below-minimum">
                        Less than the supplier&apos;s minimum order ({Number(m.moqQty).toLocaleString("en-PH")} {m.moqUom ?? m.baseUom}). They may refuse it or charge more. Go back to change it, or ask them first.
                      </span>
                    )}
                  </span>
                  {prices && est && <span className="shrink-0 text-right font-semibold tabular-nums">{peso(est)}</span>}
                </li>
              );
            })}
            {prices && total && (
              <li className="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2.5 font-semibold">
                <span>Total before tax</span>
                <span className="tabular-nums">{peso(total)}</span>
              </li>
            )}
          </ul>
          <p className="mt-3 text-[15px]">
            Arrives on <strong>{niceDate(arriveOn)}</strong> from <strong>{supplier.name}</strong>.
          </p>
          <p className="mt-1 text-[14px] text-fg-2" data-testid="po-approval-words">
            {!canSubmit
              ? "Saving keeps it as a draft; someone who may send orders for approval does that next."
              : covered
                ? "The request's approval covers this order: after saving, you can send it to the supplier straight away."
                : approvedAmount !== null && total !== null
                  ? "This is more than the request was approved for, so saving asks the manager for an OK. After the OK you send it to the supplier."
                  : "Saving asks the manager for an OK. After the OK you send it to the supplier."}
          </p>
        </section>

        {problem && (
          <p role="alert" className="mt-3 rounded-[6px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[14px] text-[var(--bad-fg)]">
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
                  {covered ? "Save the order" : "Save and ask for an OK"}
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
