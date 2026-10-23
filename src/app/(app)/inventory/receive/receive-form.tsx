"use client";
import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Button, Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { postReceiptAction } from "./actions";

type Material = { id: string; code: string; name: string; baseUom: string; shelfLifeDays: number | null };
type Location = { id: string; code: string; name: string; kind: string };
type Line = { key: number; materialId: string; qty: string; supplierLotNumber: string; manufacturedOn: string; expiresOn: string; expiryTouched: boolean; locationId: string };

function manilaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
/** Default expiry = (manufacture date or today) + the material's shelf life; the operator can override. */
function defaultExpiry(mat: Material | undefined, mfg: string): string {
  if (!mat?.shelfLifeDays) return "";
  return addDays(mfg || manilaToday(), mat.shelfLifeDays);
}

export function ReceiveForm({ idempotencyKey, materials, locations, defaultLocationId }: { idempotencyKey: string; materials: Material[]; locations: Location[]; defaultLocationId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(postReceiptAction, null);
  const blank = (key: number): Line => ({ key, materialId: "", qty: "", supplierLotNumber: "", manufacturedOn: "", expiresOn: "", expiryTouched: false, locationId: defaultLocationId });
  const [lines, setLines] = useState<Line[]>([blank(1)]);
  const [nextKey, setNextKey] = useState(2);
  const fe = state?.fieldErrors ?? {};

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = { ...l, ...patch };
        if (!n.expiryTouched && ("materialId" in patch || "manufacturedOn" in patch)) {
          n.expiresOn = defaultExpiry(materials.find((m) => m.id === n.materialId), n.manufacturedOn);
        }
        return n;
      }),
    );
  }

  const payload = JSON.stringify(lines.map(({ materialId, qty, supplierLotNumber, manufacturedOn, expiresOn, locationId }) => ({ materialId, qty, supplierLotNumber, manufacturedOn, expiresOn, locationId })));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lines" value={payload} />

      <Card>
        <h2 className="mb-3 text-[15px] font-semibold">Delivery</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier name" htmlFor="supplierName" error={fe.supplierName}>
            <Input id="supplierName" name="supplierName" required autoComplete="organization" placeholder="e.g. Laguna Oleo Supply" />
          </Field>
          <Field label="Supplier delivery document no." htmlFor="supplierDocumentNumber" error={fe.supplierDocumentNumber} hint="The supplier's DR or invoice number on the paperwork.">
            <Input id="supplierDocumentNumber" name="supplierDocumentNumber" required autoComplete="off" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes (optional)" htmlFor="notes" error={fe.notes}>
            <Textarea id="notes" name="notes" maxLength={1000} placeholder="Condition of the delivery, seals, temperature…" />
          </Field>
        </div>
      </Card>

      {lines.map((l, i) => {
        const mat = materials.find((m) => m.id === l.materialId);
        const err = (f: string) => fe[`lines.${i}.${f}`];
        const id = (f: string) => `line-${l.key}-${f}`;
        return (
          <Card key={l.key} aria-labelledby={id("title")} data-testid={`receipt-line-${i + 1}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id={id("title")} className="text-[15px] font-semibold">Line {i + 1}</h2>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
                  <Trash2 size={14} /> Remove
                </Button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Material" htmlFor={id("material")} error={err("materialId")}>
                <Select id={id("material")} value={l.materialId} onChange={(e) => update(l.key, { materialId: e.target.value })} required>
                  <option value="" disabled>Choose material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} · {m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={`Quantity${mat ? ` (${mat.baseUom})` : ""}`} htmlFor={id("qty")} error={err("qty")} hint={mat ? `Counted in the material's base unit: ${mat.baseUom === "g" ? "grams (25 kg = 25000)" : mat.baseUom}.` : "Choose a material first."}>
                <div className="flex items-center gap-2">
                  <Input id={id("qty")} inputMode="decimal" autoComplete="off" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} required className="tabular" />
                  <span className="min-w-[36px] text-[14px] font-medium text-muted">{mat?.baseUom ?? ""}</span>
                </div>
              </Field>
              <Field label="Supplier lot no." htmlFor={id("slot")} error={err("supplierLotNumber")}>
                <Input id={id("slot")} autoComplete="off" value={l.supplierLotNumber} onChange={(e) => update(l.key, { supplierLotNumber: e.target.value })} required />
              </Field>
              <Field label="Manufacture date (optional)" htmlFor={id("mfg")} error={err("manufacturedOn")}>
                <Input id={id("mfg")} type="date" value={l.manufacturedOn} onChange={(e) => update(l.key, { manufacturedOn: e.target.value })} />
              </Field>
              <Field label="Expiry date" htmlFor={id("exp")} error={err("expiresOn")} hint={mat?.shelfLifeDays ? `Default: ${l.manufacturedOn ? "manufacture date" : "today"} + ${mat.shelfLifeDays} days shelf life. Use the date on the supplier label if different.` : "Enter the date on the supplier label."}>
                <Input id={id("exp")} type="date" value={l.expiresOn} onChange={(e) => update(l.key, { expiresOn: e.target.value, expiryTouched: true })} required />
              </Field>
              <Field label="Receiving location" htmlFor={id("loc")} error={err("locationId")} hint="New lots are quarantined until QA releases them.">
                <Select id={id("loc")} value={l.locationId} onChange={(e) => update(l.key, { locationId: e.target.value })} required>
                  {locations.map((x) => (
                    <option key={x.id} value={x.id}>{x.code} · {x.name} ({x.kind})</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => {
          setLines((ls) => [...ls, blank(nextKey)]);
          setNextKey((k) => k + 1);
        }}
      >
        <Plus size={16} /> Add line
      </Button>

      {fe.lines && <p className="text-[13px] text-[var(--bad-fg)]">{fe.lines}</p>}
      <FormMessage state={state} />
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[16px] sm:border">
        <p className="text-[13px] text-muted">
          {lines.length} {lines.length === 1 ? "line" : "lines"} · creates {lines.length} quarantined {lines.length === 1 ? "lot" : "lots"}
        </p>
        <SubmitButton variant="cta" size="lg" pendingText="Posting receipt…" className="w-full sm:w-auto">
          Post receipt
        </SubmitButton>
      </div>
    </form>
  );
}
