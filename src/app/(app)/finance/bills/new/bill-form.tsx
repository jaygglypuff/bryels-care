"use client";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { fmtMoney } from "@/lib/qty";
import { Button, Card, CardTitle, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { createBillAction } from "../../actions";

type Receipt = { id: string; supplierId: string; label: string; lines: { id: string; lineNo: number | null; material: string; uom: string; qtyUnbilled: string }[] };
type Line = { key: number; uom?: string; chargeKind: string; goodsReceiptLineId: string | null; description: string; qty: string; unitAmount: string; taxCode: string };

const KINDS = [
  ["goods", "Goods"],
  ["freight", "Delivery fee"],
  ["duties", "Import duties"],
  ["brokerage", "Broker fee"],
  ["other", "Other charge / service"],
] as const;

/**
 * Supplier bill entry (grade-5: supplier, delivery, their bill number, date, prices). Choosing a delivery fills
 * one goods line per unbilled delivery line (quantity in the item's base unit); the user types the supplier's
 * prices. Kind (bill / money back), note, line kind and tax sit under "More details". The server re-validates
 * everything (receipt ownership, categories, tax codes, duplicates) and checks the bill against the order and the
 * delivery when it is sent for approval.
 */
export function BillForm({
  suppliers,
  receipts,
  categories,
  taxCodes,
  defaultTaxCode,
  creditable,
  today,
}: {
  suppliers: { id: string; code: string; name: string }[];
  receipts: Receipt[];
  categories: string[];
  taxCodes: { code: string; label: string }[];
  defaultTaxCode: string | null;
  creditable: { id: string; billNumber: string; supplierId: string; supplierReference: string; open: string }[];
  today: string;
  poConnected?: boolean;
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
    setLines(r.lines.filter((l) => Number(l.qtyUnbilled) > 0).map((l, i) => ({ key: seq + i, uom: l.uom, chargeKind: "goods", goodsReceiptLineId: l.id, description: l.material, qty: String(Number(l.qtyUnbilled)), unitAmount: "", taxCode: tax })));
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
    <ActionForm action={createBillAction} hidden={{ lines: payload, billKind: kind, goodsReceiptId: kind === "bill" ? receiptId : "" }} submit="Save the supplier bill" variant="cta" pending="Saving…">
      {(fe) => (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <CardTitle>The bill</CardTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {kind === "bill" ? (
                <Field label="Which delivery is this bill for?" htmlFor="b-gr" error={fe.goodsReceiptId} hint="Its items are filled in below; you type the prices.">
                  <Select id="b-gr" value={receiptId} onChange={(e) => chooseReceipt(e.target.value)}>
                    <option value="">Not for a delivery (a service, rent, fuel…)</option>
                    {supplierReceipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Which of their bills does this lower?" htmlFor="b-credit" error={fe.creditForBillId}>
                  <Select id="b-credit" name="creditForBillId">
                    {creditable
                      .filter((b) => b.supplierId === supplierId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          Their bill {b.supplierReference} · still to pay {fmtMoney(b.open)} ({b.billNumber})
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field label="Bill number on their paper" htmlFor="b-ref" error={fe.supplierReference} hint="Copy it from the supplier's bill, so the same bill is not entered twice.">
                <Input id="b-ref" name="supplierReference" required maxLength={60} />
              </Field>
              <Field label="Date on the bill" htmlFor="b-date" error={fe.billDate} hint="Its month must not be closed.">
                <Input id="b-date" name="billDate" type="date" defaultValue={today} required />
              </Field>
              {kind === "bill" && !receiptId && (
                <Field label="What was it for?" htmlFor="b-cat" error={fe.categoryCode}>
                  <Select id="b-cat" name="categoryCode" defaultValue={categories[0]}>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <MoreDetails>
              <Field label="Kind of paper" htmlFor="b-kind">
                <Select id="b-kind" value={kind} onChange={(e) => setKind(e.target.value as "bill" | "credit")}>
                  <option value="bill">A bill (we owe them money)</option>
                  <option value="credit">Money back from the supplier (lowers one of their bills)</option>
                </Select>
              </Field>
              <Field label="Note" htmlFor="b-notes">
                <Textarea id="b-notes" name="notes" maxLength={500} className="min-h-[56px]" />
              </Field>
            </MoreDetails>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>What they charge</CardTitle>
            {fe.lines && <p className="text-[13px] text-[var(--bad-fg)]">{fe.lines}</p>}
            {lines.map((l, i) => {
              const err = fe[`lines.${i}.qty`] ?? fe[`lines.${i}.unitAmount`] ?? fe[`lines.${i}.description`] ?? fe[`lines.${i}.goodsReceiptLineId`] ?? fe.taxCode;
              return (
                <div key={l.key} className="flex flex-col gap-2 rounded-[12px] border border-line p-3" data-testid="bill-line">
                  {l.goodsReceiptLineId ? (
                    <p className="font-medium">{l.description}</p>
                  ) : (
                    <Field label="What for" htmlFor={`bl-d-${l.key}`}>
                      <Input id={`bl-d-${l.key}`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} placeholder="For example: delivery fee" />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={l.uom ? `How many (${l.uom})` : "How many"} htmlFor={`bl-q-${l.key}`}>
                      <Input id={`bl-q-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} />
                    </Field>
                    <Field label={l.uom ? `Price per ${l.uom} (₱)` : "Price each (₱)"} htmlFor={`bl-p-${l.key}`}>
                      <Input id={`bl-p-${l.key}`} inputMode="decimal" value={l.unitAmount} onChange={(e) => set(l.key, { unitAmount: e.target.value })} placeholder="0.00" />
                    </Field>
                  </div>
                  <p className="text-right text-[14px] tabular-nums text-fg-2">{fmtMoney(num(l.qty).times(num(l.unitAmount)))}</p>
                  <details>
                    <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">Kind and tax (you can skip this)</summary>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Field label="Kind" htmlFor={`bl-k-${l.key}`}>
                        <Select id={`bl-k-${l.key}`} value={l.chargeKind} onChange={(e) => set(l.key, { chargeKind: e.target.value })} disabled={!!l.goodsReceiptLineId}>
                          {KINDS.map(([v, t]) => (
                            <option key={v} value={v}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Tax" htmlFor={`bl-t-${l.key}`}>
                        <Select id={`bl-t-${l.key}`} value={l.taxCode} onChange={(e) => set(l.key, { taxCode: e.target.value })}>
                          <option value="">No tax</option>
                          {taxCodes.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  </details>
                  {lines.length > 1 && (
                    <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                      Remove this line
                    </Button>
                  )}
                  {err && <p className="text-[13px] text-[var(--bad-fg)]">{err}</p>}
                </div>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLines([...lines, { key: seq, chargeKind: "freight", goodsReceiptLineId: null, description: "", qty: "1", unitAmount: "", taxCode: tax }]);
                  setSeq(seq + 1);
                }}
              >
                Add a charge (delivery fee…)
              </Button>
              <span className="text-[15px] font-semibold tabular-nums">Before tax: {fmtMoney(total)}</span>
            </div>
          </Card>
        </div>
      )}
    </ActionForm>
  );
}
