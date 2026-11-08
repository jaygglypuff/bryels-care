"use client";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { fmtMoney } from "@/lib/qty";
import { toBaseQty, unitChoices } from "@/lib/units";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { LineName } from "@/ui/line-name";
import { changeBillLinesAction } from "../../../actions";

export type ChangeLine = { chargeKind: string; goodsReceiptLineId: string | null; purchaseOrderLineId: string | null; materialId: string | null; description: string; baseUom: string | null; qtyBase: string; unitAmountBase: string; taxCode: string | null };

const num = (v: string) => (/^\d+(\.\d+)?$/.test(v.trim()) ? new Decimal(v.trim()) : new Decimal(0));

/**
 * ADR-131 "Change the bill": each line in the unit people read on paper (kg for gram items), prefilled from what was
 * typed; the reason is required. The server checks everything again and the bill is checked against the order and
 * the delivery when it is sent.
 */
export function ChangeBillForm({ billId, lines: initial }: { billId: string; lines: ChangeLine[] }) {
  const start = initial.map((l, i) => {
    const unit = l.goodsReceiptLineId && l.baseUom ? unitChoices(l.baseUom)[0] : l.baseUom ?? "";
    const per = l.baseUom && unit && unit !== l.baseUom ? toBaseQty("1", unit, l.baseUom) : null;
    const f = per && per.ok ? per.qtyBase : new Decimal(1);
    return { key: i, ...l, unit, qty: new Decimal(l.qtyBase).div(f).toDecimalPlaces(4).toString(), price: new Decimal(l.unitAmountBase).times(f).toDecimalPlaces(4).toString() };
  });
  const [rows, setRows] = useState(start);
  const set = (k: number, patch: Partial<(typeof start)[number]>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const payload = useMemo(
    () => JSON.stringify(rows.map((r) => ({ chargeKind: r.chargeKind, goodsReceiptLineId: r.goodsReceiptLineId, purchaseOrderLineId: r.purchaseOrderLineId, materialId: r.materialId, description: r.description, qty: r.qty, uom: r.goodsReceiptLineId ? r.unit : null, unitAmount: r.price, taxCode: r.taxCode }))),
    [rows],
  );
  const total = rows.reduce((s, r) => s.plus(num(r.qty).times(num(r.price))), new Decimal(0));
  return (
    <ActionForm action={changeBillLinesAction} hidden={{ id: billId, lines: payload }} submit="Save the changed bill" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-col gap-2 rounded-[12px] border border-line p-3" data-testid="change-bill-line">
              <LineName description={r.description} className="block font-medium" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="How many" htmlFor={`cb-q-${r.key}`} error={fe[`lines.${i}.qty`]}>
                  <Input id={`cb-q-${r.key}`} inputMode="decimal" value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} />
                </Field>
                {r.goodsReceiptLineId && r.baseUom && unitChoices(r.baseUom).length > 1 ? (
                  <Field label="Unit" htmlFor={`cb-u-${r.key}`}>
                    <Select
                      id={`cb-u-${r.key}`}
                      value={r.unit}
                      onChange={(e) => {
                        const to = e.target.value;
                        const a = toBaseQty("1", to, r.baseUom!);
                        const b = toBaseQty("1", r.unit, r.baseUom!);
                        if (a.ok && b.ok && b.qtyBase.gt(0)) {
                          const k = a.qtyBase.div(b.qtyBase);
                          set(r.key, { unit: to, qty: num(r.qty).div(k).toDecimalPlaces(4).toString(), price: num(r.price).times(k).toDecimalPlaces(4).toString() });
                        }
                      }}
                    >
                      {unitChoices(r.baseUom).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <div />
                )}
                <Field label={r.unit ? `Price per ${r.unit} (₱)` : "Amount (₱)"} htmlFor={`cb-p-${r.key}`} error={fe[`lines.${i}.unitAmount`]}>
                  <Input id={`cb-p-${r.key}`} inputMode="decimal" value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} />
                </Field>
              </div>
              <p className="text-right text-[14px] tabular-nums text-fg-2">{fmtMoney(num(r.qty).times(num(r.price)))}</p>
            </div>
          ))}
          <p className="text-right text-[15px] font-semibold tabular-nums">Before tax: {fmtMoney(total)}</p>
          <Field label="What was wrong" htmlFor="cb-reason" error={fe.reason}>
            <Input id="cb-reason" name="reason" required minLength={5} maxLength={300} placeholder="For example: I typed the price per gram" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
