"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { createRequestAction } from "../../actions";

type Mat = { id: string; name: string; code: string; baseUom: string };

/**
 * "Ask to buy something" (purchase request, W04-02): item by name, how much in a friendly unit, needed by, why.
 * More items with one tap; supplier and price guesses folded away. The request number is made by the server.
 */
export function RequestForm({ materials, suppliers, prices, neededBy, today }: { materials: Mat[]; suppliers: { id: string; name: string }[]; prices: boolean; neededBy: string; today: string }) {
  const [rows, setRows] = useState([{ key: 0, materialId: "" }]);
  const [seq, setSeq] = useState(1);
  const byId = new Map(materials.map((m) => [m.id, m]));
  return (
    <ActionForm action={createRequestAction} submit="Save the request" pending="Saving…" variant="cta">
      {(fe) => (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const m = byId.get(r.materialId);
              return (
                <li key={r.key} className="grid min-w-0 gap-3 rounded-[14px] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]" data-testid="pr-item">
                  <Field label={i === 0 ? "What do you need?" : "Another item"} htmlFor={`m-${r.key}`} error={fe[`lines.${i}.materialId`]}>
                    <Select id={`m-${r.key}`} name={`lines.${i}.materialId`} value={r.materialId} required={i === 0} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, materialId: e.target.value } : x)))}>
                      <option value="">Pick an item…</option>
                      {materials.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="How much" htmlFor={`q-${r.key}`} error={fe[`lines.${i}.qty`] ?? fe[`lines.${i}.uom`]}>
                    <QtyUnitInput id={`q-${r.key}`} baseUom={m?.baseUom ?? "*"} name={`lines.${i}.qty`} unitName={`lines.${i}.uom`} required={i === 0} />
                  </Field>
                  <div className="sm:col-span-2">
                    <details>
                      <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">Supplier or price you know (you can skip this)</summary>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Supplier you suggest" htmlFor={`s-${r.key}`}>
                          <Select id={`s-${r.key}`} name={`lines.${i}.suggestedSupplierId`} defaultValue="">
                            <option value="">Purchasing chooses</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        {prices && (
                          <Field label="Price you expect per unit (₱)" htmlFor={`p-${r.key}`} error={fe[`lines.${i}.estimatedUnitAmount`]}>
                            <Input id={`p-${r.key}`} name={`lines.${i}.estimatedUnitAmount`} inputMode="decimal" placeholder="0.00" />
                          </Field>
                        )}
                      </div>
                    </details>
                    {m && <p className="font-mono text-[12px] text-muted">{m.code}</p>}
                    {rows.length > 1 && (
                      <Button type="button" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        <Trash2 size={16} aria-hidden /> Remove this item
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRows((rs) => [...rs, { key: seq, materialId: "" }]);
                setSeq(seq + 1);
              }}
            >
              <Plus size={16} aria-hidden /> Add another item
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Needed by" htmlFor="neededByDate" error={fe.neededByDate} hint="Suggested: one week from today. Change it if you need it sooner.">
              <Input id="neededByDate" type="date" name="neededByDate" min={today} defaultValue={neededBy} />
            </Field>
            <Field label="Why do we need it?" htmlFor="justification" error={fe.justification}>
              <Textarea id="justification" name="justification" rows={2} placeholder="For example: soap batch next week" />
            </Field>
          </div>
          <p className="text-[14px] text-fg-2">The request number is made for you. After saving, send it for approval on the next screen.</p>
        </>
      )}
    </ActionForm>
  );
}
