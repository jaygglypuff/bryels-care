"use client";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { fmtMoney } from "@/lib/qty";
import { Button, Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { createBillAction } from "../../actions";

type Receipt = { id: string; supplierId: string; label: string; lines: { id: string; lineNo: number | null; material: string; uom: string; qtyUnbilled: string }[] };
type Line = { key: number; chargeKind: string; goodsReceiptLineId: string | null; description: string; qty: string; unitAmount: string; taxCode: string };

const KINDS = [
  ["goods", "Goods"],
  ["freight", "Freight"],
  ["duties", "Duties"],
  ["brokerage", "Brokerage"],
  ["other", "Other charge / service"],
] as const;

/**
 * Supplier bill entry. Choosing a receipt fills one goods line per unbilled receipt line (quantity in the
 * material's base unit); the user enters the supplier's unit prices. The server re-validates everything
 * (receipt ownership, categories, tax codes, duplicates) and runs the three-way match at submission.
 */
export function BillForm({
  suppliers,
  receipts,
  categories,
  taxCodes,
  defaultTaxCode,
  creditable,
  today,
  poConnected,
}: {
  suppliers: { id: string; code: string; name: string }[];
  receipts: Receipt[];
  categories: string[];
  taxCodes: { code: string; label: string }[];
  defaultTaxCode: string | null;
  creditable: { id: string; billNumber: string; supplierId: string; supplierReference: string; open: string }[];
  today: string;
  poConnected: boolean;
}) {
  const [kind, setKind] = useState<"bill" | "credit">("bill");
  const [supplierId, setSupplierId] = useState(receipts[0]?.supplierId ?? suppliers[0].id);
  const [receiptId, setReceiptId] = useState("");
  const [seq, setSeq] = useState(1);
  const tax = defaultTaxCode ?? "";
  const [lines, setLines] = useState<Line[]>([{ key: 0, chargeKind: "other", goodsReceiptLineId: null, description: "", qty: "1", unitAmount: "", taxCode: tax }]);
  const supplierReceipts = receipts.filter((r) => r.supplierId === supplierId);
  const chooseReceipt = (id: string) => {
    setReceiptId(id);
    const r = receipts.find((x) => x.id === id);
    if (!r) {
      setLines([{ key: seq, chargeKind: "other", goodsReceiptLineId: null, description: "", qty: "1", unitAmount: "", taxCode: tax }]);
      setSeq(seq + 1);
      return;
    }
    setLines(r.lines.filter((l) => Number(l.qtyUnbilled) > 0).map((l, i) => ({ key: seq + i, chargeKind: "goods", goodsReceiptLineId: l.id, description: l.material, qty: String(Number(l.qtyUnbilled)), unitAmount: "", taxCode: tax })));
    setSeq(seq + r.lines.length);
  };
  const set = (k: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const payload = useMemo(
    () => JSON.stringify(lines.map((l) => ({ chargeKind: l.chargeKind, goodsReceiptLineId: l.goodsReceiptLineId, description: l.description, qty: l.qty, unitAmount: l.unitAmount, taxCode: l.taxCode || null }))),
    [lines],
  );
  const num = (v: string) => (/^\d+(\.\d+)?$/.test(v.trim()) ? new Decimal(v.trim()) : new Decimal(0));
  const total = lines.reduce((s, l) => s.plus(num(l.qty).times(num(l.unitAmount))), new Decimal(0));
  return (
    <ActionForm action={createBillAction} hidden={{ lines: payload, billKind: kind, goodsReceiptId: kind === "bill" ? receiptId : "" }} submit="Save bill draft" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <CardTitle>Bill</CardTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Kind" htmlFor="b-kind">
                <Select id="b-kind" value={kind} onChange={(e) => setKind(e.target.value as "bill" | "credit")}>
                  <option value="bill">Bill (what we owe)</option>
                  <option value="credit">Supplier credit (reduces a bill)</option>
                </Select>
              </Field>
              <Field label="Supplier" htmlFor="b-supplier" error={fe.supplierId}>
                <Select
                  id="b-supplier"
                  name="supplierId"
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    chooseReceipt("");
                  }}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Supplier's bill number" htmlFor="b-ref" error={fe.supplierReference}>
                <Input id="b-ref" name="supplierReference" required maxLength={60} />
              </Field>
              <Field label="Bill date" htmlFor="b-date" error={fe.billDate} hint="The posting date: it must fall in an open period.">
                <Input id="b-date" name="billDate" type="date" defaultValue={today} required />
              </Field>
              {kind === "bill" ? (
                <>
                  <Field label="Goods receipt" htmlFor="b-gr" error={fe.goodsReceiptId} hint={poConnected ? undefined : "Purchase orders are not connected yet: the match checks the received quantity."}>
                    <Select id="b-gr" value={receiptId} onChange={(e) => chooseReceipt(e.target.value)}>
                      <option value="">No receipt (non-stock category)</option>
                      {supplierReceipts.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!receiptId && (
                    <Field label="Non-stock category" htmlFor="b-cat" error={fe.categoryCode}>
                      <Select id="b-cat" name="categoryCode" defaultValue={categories[0]}>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c.replace(/_/g, " ")}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </>
              ) : (
                <Field label="Bill this credit reduces" htmlFor="b-credit" error={fe.creditForBillId}>
                  <Select id="b-credit" name="creditForBillId">
                    {creditable
                      .filter((b) => b.supplierId === supplierId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.billNumber} ({b.supplierReference}) · open {fmtMoney(b.open)}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Notes" htmlFor="b-notes">
              <Textarea id="b-notes" name="notes" maxLength={500} className="min-h-[56px]" />
            </Field>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>Lines</CardTitle>
            {fe.lines && <p className="text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-1 gap-2 rounded-[12px] border border-line p-3 sm:grid-cols-[140px_minmax(0,1fr)_110px_120px_minmax(0,160px)_auto]">
                <Select aria-label="Line kind" value={l.chargeKind} onChange={(e) => set(l.key, { chargeKind: e.target.value })} disabled={!!l.goodsReceiptLineId}>
                  {KINDS.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </Select>
                <Input aria-label="Description" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} placeholder="Description" readOnly={!!l.goodsReceiptLineId} />
                <Input aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                <Input aria-label="Unit amount" inputMode="decimal" value={l.unitAmount} onChange={(e) => set(l.key, { unitAmount: e.target.value })} placeholder="Unit price" />
                <Select aria-label="Tax code" value={l.taxCode} onChange={(e) => set(l.key, { taxCode: e.target.value })}>
                  <option value="">No tax</option>
                  {taxCodes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
                  Remove
                </Button>
                {(fe[`lines.${i}.qty`] || fe[`lines.${i}.unitAmount`] || fe[`lines.${i}.description`] || fe[`lines.${i}.goodsReceiptLineId`] || fe.taxCode) && (
                  <p className="text-[12px] text-[var(--bad-fg)] sm:col-span-6">{fe[`lines.${i}.qty`] ?? fe[`lines.${i}.unitAmount`] ?? fe[`lines.${i}.description`] ?? fe[`lines.${i}.goodsReceiptLineId`] ?? fe.taxCode}</p>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLines([...lines, { key: seq, chargeKind: "freight", goodsReceiptLineId: null, description: "", qty: "1", unitAmount: "", taxCode: tax }]);
                  setSeq(seq + 1);
                }}
              >
                Add a charge line
              </Button>
              <span className="text-[13px] text-muted">Lines before tax: {fmtMoney(total)}</span>
            </div>
          </Card>
        </div>
      )}
    </ActionForm>
  );
}
