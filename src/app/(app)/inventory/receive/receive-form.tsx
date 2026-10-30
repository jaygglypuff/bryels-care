"use client";
import { useActionState, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Button, Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveReceiptAction } from "./actions";

type Material = {
  id: string;
  code: string;
  name: string;
  baseUom: string;
  shelfLifeDays: number | null;
  storageConditions: string | null;
  requiresCoa: boolean;
  requiresIncomingInspection: boolean;
  units: string[];
  brand: string | null;
  standardPackQty: string | null;
  standardPackUom: string | null;
};
type SupplierPack = { supplierId: string; materialId: string; brand: string | null; packQty: string | null; packUom: string | null };
type Location = { id: string; code: string; name: string; kind: string };
type Supplier = { id: string; code: string; name: string; qualityStatus: string };
type ReasonCode = { code: string; label: string };

export type ReceiptFormLine = {
  lineId?: string;
  materialId: string;
  qty: string;
  uom: string;
  supplierLotNumber: string;
  brand: string;
  manufacturedOn: string;
  expiresOn: string;
  retestOn: string;
  containerCount: string;
  storageConditionsConfirmed: boolean;
  locationId: string;
  discrepancyKind: string;
  discrepancyNote: string;
};
export type ReceiptFormInitial = {
  receiptId: string;
  supplierName: string;
  supplierDocumentNumber: string;
  unplannedReasonCode: string;
  notes: string;
  lines: ReceiptFormLine[];
};

/** `packs`: form-only helper (number of standard packs); never sent. */
type Line = ReceiptFormLine & { key: number; expiryTouched: boolean; packs: string };

/** "18.000000" → "18". */
const plain = (v: string) => v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/** packs × pack size, exact for the decimals a form uses (scaled integers, no floating point). */
function times(packs: string, size: string): string {
  if (!/^\d{1,6}$/.test(packs) || !/^\d+(\.\d{1,6})?$/.test(size)) return "";
  const [i, f = ""] = size.split(".");
  const scaled = BigInt(i + f.padEnd(6, "0")) * BigInt(packs);
  const s = scaled.toString().padStart(7, "0");
  return plain(`${s.slice(0, -6)}.${s.slice(-6)}`);
}

const DISCREPANCIES = [
  ["", "No discrepancy"],
  ["short", "Short delivery"],
  ["over", "Over-delivery (needs procurement approval before posting)"],
  ["damaged", "Damaged"],
  ["wrong_item", "Wrong item (needs procurement approval before posting)"],
  ["missing_documents", "Missing documents"],
] as const;

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
function locationsFor(mat: Material | undefined, all: Location[]) {
  const kinds = mat && !mat.requiresIncomingInspection ? ["receiving", "quarantine", "storage"] : ["receiving", "quarantine", "hold"];
  return all.filter((l) => kinds.includes(l.kind));
}

export function ReceiveForm({
  idempotencyKey,
  materials,
  locations,
  suppliers,
  supplierPacks = [],
  reasonCodes,
  defaultLocationId,
  canPost,
  initial,
}: {
  idempotencyKey: string;
  materials: Material[];
  locations: Location[];
  suppliers: Supplier[];
  supplierPacks?: SupplierPack[];
  reasonCodes: ReasonCode[];
  defaultLocationId: string;
  canPost: boolean;
  initial?: ReceiptFormInitial;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveReceiptAction, null);
  const blank = (key: number): Line => ({
    key,
    materialId: "",
    qty: "",
    uom: "",
    supplierLotNumber: "",
    brand: "",
    packs: "",
    manufacturedOn: "",
    expiresOn: "",
    retestOn: "",
    containerCount: "",
    storageConditionsConfirmed: false,
    locationId: defaultLocationId,
    discrepancyKind: "",
    discrepancyNote: "",
    expiryTouched: false,
  });
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines.length ? initial.lines.map((l, i) => ({ ...l, key: i + 1, expiryTouched: true, packs: "" })) : [blank(1)]));
  const [nextKey, setNextKey] = useState((initial?.lines.length ?? 1) + 1);
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const fe = state?.fieldErrors ?? {};
  const supplier = suppliers.find((s) => s.name.toLowerCase() === supplierName.trim().toLowerCase() || s.code.toLowerCase() === supplierName.trim().toLowerCase());

  /** ADR-076: this supplier's brand and pack for the material, else the material's usual brand and standard pack. */
  function packOf(mat: Material | undefined) {
    if (!mat) return null;
    const sp = supplier ? supplierPacks.find((p) => p.supplierId === supplier.id && p.materialId === mat.id) : undefined;
    const qty = sp?.packQty ?? mat.standardPackQty;
    const uom = sp?.packQty ? sp.packUom : mat.standardPackUom;
    return { brand: sp?.brand ?? mat.brand ?? "", qty: qty && uom && mat.units.includes(uom) ? plain(qty) : null, uom: qty && uom && mat.units.includes(uom) ? uom : null };
  }

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = { ...l, ...patch };
        const mat = materials.find((m) => m.id === n.materialId);
        const pack = packOf(mat);
        if ("packs" in patch && pack?.qty && pack.uom) {
          n.uom = pack.uom;
          n.qty = times(n.packs, pack.qty);
          if (/^\d{1,5}$/.test(n.packs) && Number(n.packs) > 0) n.containerCount = n.packs;
        }
        if ("materialId" in patch) {
          n.uom = mat?.baseUom ?? "";
          n.brand = pack?.brand ?? "";
          n.packs = "";
          if (pack?.qty && pack.uom) {
            n.uom = pack.uom;
            n.packs = "1";
            n.qty = pack.qty;
            n.containerCount = "1";
          }
          const allowed = locationsFor(mat, locations);
          if (!allowed.some((x) => x.id === n.locationId)) n.locationId = allowed[0]?.id ?? "";
        }
        if (!n.expiryTouched && ("materialId" in patch || "manufacturedOn" in patch)) n.expiresOn = defaultExpiry(mat, n.manufacturedOn);
        return n;
      }),
    );
  }

  const payload = JSON.stringify(lines.map(({ key: _k, expiryTouched: _e, packs: _p, lineId, ...rest }) => ({ ...rest, lineId: lineId ?? "" })));
  const today = manilaToday();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="receiptId" value={initial?.receiptId ?? ""} />
      <input type="hidden" name="lines" value={payload} />

      <Card>
        <h2 className="mb-3 text-[15px] font-semibold">Delivery</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Supplier"
            htmlFor="supplierName"
            error={fe.supplierName ?? fe.supplierId}
            hint={supplier ? `${supplier.code}${supplier.qualityStatus === "suspended" ? " · SUSPENDED: posting is blocked" : ""}` : supplierName.trim().length > 1 ? "Not in the supplier list: procurement must link it before QA can release." : "Type or pick from the supplier list."}
          >
            <Input id="supplierName" name="supplierName" required autoComplete="off" list="supplier-options" placeholder="e.g. Laguna Oleo Supply" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <datalist id="supplier-options">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name}>{s.code}</option>
              ))}
            </datalist>
          </Field>
          <Field label="Supplier delivery document no." htmlFor="supplierDocumentNumber" error={fe.supplierDocumentNumber} hint="The supplier's DR or invoice number on the paperwork.">
            <Input id="supplierDocumentNumber" name="supplierDocumentNumber" required autoComplete="off" defaultValue={initial?.supplierDocumentNumber} />
          </Field>
          <Field label="Why no purchase order?" htmlFor="unplannedReasonCode" error={fe.unplannedReasonCode} hint="Unplanned receipt reason (purchasing is not in the system yet).">
            <Select id="unplannedReasonCode" name="unplannedReasonCode" defaultValue={initial?.unplannedReasonCode || reasonCodes[0]?.code}>
              {reasonCodes.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)" htmlFor="notes" error={fe.notes}>
            <Textarea id="notes" name="notes" maxLength={1000} placeholder="Condition of the delivery, seals, temperature…" defaultValue={initial?.notes} />
          </Field>
        </div>
      </Card>

      {lines.map((l, i) => {
        const mat = materials.find((m) => m.id === l.materialId);
        const err = (f: string) => fe[`lines.${i}.${f}`];
        const id = (f: string) => `line-${l.key}-${f}`;
        const locs = locationsFor(mat, locations);
        const pack = packOf(mat);
        const expired = !!l.expiresOn && l.expiresOn <= today;
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
              <Field label="Material" htmlFor={id("material")} error={err("materialId")} hint={mat?.requiresCoa ? "This material needs a CoA: attach it on the receipt page." : undefined}>
                <Select id={id("material")} value={l.materialId} onChange={(e) => update(l.key, { materialId: e.target.value })} required>
                  <option value="" disabled>Choose material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.code} · {m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor={id("qty")} error={err("qty") ?? err("uom")} hint={mat ? `Stored in ${mat.baseUom}${mat.baseUom === "g" ? " (25 kg = 25000 g)" : ""}.` : "Choose a material first."}>
                <div className="flex items-center gap-2">
                  <Input id={id("qty")} inputMode="decimal" autoComplete="off" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} required className="tabular" />
                  <Select id={id("uom")} aria-label={`Line ${i + 1} unit`} value={l.uom || mat?.baseUom || ""} onChange={(e) => update(l.key, { uom: e.target.value })} className="w-[88px]">
                    {(mat?.units ?? [""]).map((u) => (
                      <option key={u} value={u}>{u || "—"}</option>
                    ))}
                  </Select>
                </div>
              </Field>
              {pack?.qty && (
                <Field label="Number of packs" htmlFor={id("packs")} hint={`One pack = ${pack.qty} ${pack.uom}. The quantity is worked out for you; you can still change it.`}>
                  <Input id={id("packs")} inputMode="numeric" autoComplete="off" value={l.packs} onChange={(e) => update(l.key, { packs: e.target.value })} className="tabular" />
                </Field>
              )}
              <Field label="Brand (optional)" htmlFor={id("brand")} error={err("brand")} hint="The brand printed on the containers.">
                <Input id={id("brand")} autoComplete="off" maxLength={80} value={l.brand} onChange={(e) => update(l.key, { brand: e.target.value })} />
              </Field>
              <Field label="Supplier lot no." htmlFor={id("slot")} error={err("supplierLotNumber")}>
                <Input id={id("slot")} autoComplete="off" value={l.supplierLotNumber} onChange={(e) => update(l.key, { supplierLotNumber: e.target.value })} required />
              </Field>
              <Field label="Containers (optional)" htmlFor={id("containers")} error={err("containerCount")} hint="Drums, sacks or boxes: one label each.">
                <Input id={id("containers")} inputMode="numeric" value={l.containerCount} onChange={(e) => update(l.key, { containerCount: e.target.value })} />
              </Field>
              <Field label="Manufacture date (optional)" htmlFor={id("mfg")} error={err("manufacturedOn")}>
                <Input id={id("mfg")} type="date" value={l.manufacturedOn} onChange={(e) => update(l.key, { manufacturedOn: e.target.value })} />
              </Field>
              <Field label="Expiry date" htmlFor={id("exp")} error={err("expiresOn")} hint={mat?.shelfLifeDays ? `Default: ${l.manufacturedOn ? "manufacture date" : "today"} + ${mat.shelfLifeDays} days shelf life. Use the date on the supplier label if different.` : "Enter the date on the supplier label."}>
                <Input id={id("exp")} type="date" value={l.expiresOn} onChange={(e) => update(l.key, { expiresOn: e.target.value, expiryTouched: true })} required />
              </Field>
              <Field label="Retest date (optional)" htmlFor={id("retest")} error={err("retestOn")}>
                <Input id={id("retest")} type="date" value={l.retestOn} onChange={(e) => update(l.key, { retestOn: e.target.value })} />
              </Field>
              <Field label="Receiving location" htmlFor={id("loc")} error={err("locationId")} hint={mat && !mat.requiresIncomingInspection ? "This material is released on receipt (QA setting)." : "New lots are quarantined until QA releases them."}>
                <Select id={id("loc")} value={l.locationId} onChange={(e) => update(l.key, { locationId: e.target.value })} required>
                  {locs.map((x) => (
                    <option key={x.id} value={x.id}>{x.code} · {x.name} ({x.kind})</option>
                  ))}
                </Select>
              </Field>
            </div>
            {mat?.storageConditions && (
              <label className="mt-4 flex items-start gap-2 text-[14px]">
                <input type="checkbox" className="mt-1 size-4" checked={l.storageConditionsConfirmed} onChange={(e) => update(l.key, { storageConditionsConfirmed: e.target.checked })} />
                <span>
                  Storage conditions checked: {mat.storageConditions}
                  {err("storageConditionsConfirmed") && <span className="block text-[13px] text-[var(--bad-fg)]">{err("storageConditionsConfirmed")}</span>}
                </span>
              </label>
            )}
            {expired && (
              <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[var(--bad-fg)]">
                <AlertTriangle size={14} /> Expired or expiring today: record a discrepancy below; QA decides (reject candidate).
              </p>
            )}
            <details className="mt-4 rounded-[12px] border border-line p-3" open={!!l.discrepancyKind || expired}>
              <summary className="cursor-pointer text-[14px] font-medium">Discrepancy {l.discrepancyKind ? "· recorded" : "(short, over, damaged, wrong item, missing documents)"}</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Type" htmlFor={id("disc")} error={err("discrepancyKind")}>
                  <Select id={id("disc")} value={l.discrepancyKind} onChange={(e) => update(l.key, { discrepancyKind: e.target.value })}>
                    {DISCREPANCIES.map(([v, t]) => (
                      <option key={v} value={v}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="What was wrong" htmlFor={id("discnote")} error={err("discrepancyNote")}>
                  <Input id={id("discnote")} value={l.discrepancyNote} onChange={(e) => update(l.key, { discrepancyNote: e.target.value })} disabled={!l.discrepancyKind} />
                </Field>
              </div>
            </details>
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
          {lines.length} {lines.length === 1 ? "line" : "lines"} · posting creates {lines.length} {lines.length === 1 ? "lot" : "lots"}
        </p>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <SubmitButton name="intent" value="draft" variant="secondary" size="lg" pendingText="Saving…" className="flex-1 sm:flex-none" formNoValidate>
            Save draft
          </SubmitButton>
          {canPost && (
            <SubmitButton name="intent" value="post" variant="cta" size="lg" pendingText="Posting receipt…" className="flex-1 sm:flex-none">
              Post receipt
            </SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}
