"use client";
import { useActionState, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { SECTION_LABELS, isSection } from "@/lib/location-sections";
import { Button, Card, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveReceiptAction } from "./actions";

/*
 * Tablet-first receive form (S6, ADR-077). One card per item with only what the operator must enter
 * (quantity, supplier lot no., expiry date, the brand slot); everything else (manufacture and retest
 * dates, containers, the place, problems with the delivery) is under "More details" with sensible
 * defaults. Layout uses container queries (@container) so the fields never overlap at 768–1180 px,
 * whatever the width of the side navigation.
 */

type Material = {
  id: string;
  code: string;
  name: string;
  baseUom: string;
  shelfLifeDays: number | null;
  storageConditions: string | null;
  requiresCoa: boolean;
  requiresIncomingInspection: boolean;
  section?: string;
  units: string[];
  brand?: string | null;
};
type Location = { id: string; code: string; name: string; kind: string; section?: string };
type Supplier = { id: string; code: string; name: string; qualityStatus: string };
type ReasonCode = { code: string; label: string };

/** A purchase order line offered for receiving (PO mode). */
export type PoFormLine = { purchaseOrderLineId: string; lineNo: number; materialId: string; orderedText: string; openText: string; defaultQty: string; uom: string };
export type PoFormContext = { purchaseOrderId: string; poNumber: string; supplierName: string; lines: PoFormLine[] };

export type ReceiptFormLine = {
  lineId?: string;
  materialId: string;
  qty: string;
  uom: string;
  supplierLotNumber: string;
  /** ADR-076: brand on the delivered containers; blank = the material's usual brand. */
  brand?: string;
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

type Line = ReceiptFormLine & { key: number; expiryTouched: boolean; purchaseOrderLineId?: string; po?: PoFormLine; skip?: boolean; notOnPo?: boolean };

const DISCREPANCIES = [
  ["", "No problem"],
  ["short", "Less than ordered"],
  ["over", "More than ordered (purchasing must approve first)"],
  ["damaged", "Damaged"],
  ["wrong_item", "Wrong item (purchasing must approve first)"],
  ["missing_documents", "Papers missing"],
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
/** Suggested place: an allowed place in the item's own section, else the default (the QA area). */
function suggestedLocation(mat: Material | undefined, all: Location[], fallback: string) {
  const allowed = locationsFor(mat, all);
  const own = mat?.section ? allowed.find((l) => l.section === mat.section) : undefined;
  return own?.id ?? (allowed.some((l) => l.id === fallback) ? fallback : allowed[0]?.id ?? "");
}
const sectionName = (s: string | undefined) => (isSection(s) ? SECTION_LABELS[s] : "Other areas");

export function ReceiveForm({
  idempotencyKey,
  materials,
  locations,
  suppliers,
  reasonCodes,
  defaultLocationId,
  canPost,
  printLabels = false,
  initial,
  po,
  storageBySection = {},
}: {
  idempotencyKey: string;
  materials: Material[];
  locations: Location[];
  suppliers: Supplier[];
  reasonCodes: ReasonCode[];
  defaultLocationId: string;
  canPost: boolean;
  /** Posting then opens the receipt's labels (consultant review: "Save and print labels"). */
  printLabels?: boolean;
  initial?: ReceiptFormInitial;
  po?: PoFormContext;
  storageBySection?: Record<string, string[]>;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveReceiptAction, null);
  const matOf = (id: string) => materials.find((m) => m.id === id);
  const blank = (key: number, materialId = ""): Line => {
    const mat = matOf(materialId);
    return {
      key,
      materialId,
      qty: "",
      uom: mat?.baseUom ?? "",
      supplierLotNumber: "",
      manufacturedOn: "",
      expiresOn: defaultExpiry(mat, ""),
      retestOn: "",
      containerCount: "",
      storageConditionsConfirmed: false,
      locationId: suggestedLocation(mat, locations, defaultLocationId),
      discrepancyKind: "",
      discrepancyNote: "",
      expiryTouched: false,
    };
  };
  const [lines, setLines] = useState<Line[]>(() => {
    if (initial?.lines.length) return initial.lines.map((l, i) => ({ ...l, key: i + 1, expiryTouched: true }));
    if (po) return po.lines.map((pl, i) => ({ ...blank(i + 1, pl.materialId), qty: pl.defaultQty, uom: pl.uom, purchaseOrderLineId: pl.purchaseOrderLineId, po: pl }));
    return [blank(1)];
  });
  const [nextKey, setNextKey] = useState(lines.length + 1);
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const fe = state?.fieldErrors ?? {};
  const supplier = suppliers.find((s) => s.name.toLowerCase() === supplierName.trim().toLowerCase() || s.code.toLowerCase() === supplierName.trim().toLowerCase());

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const n = { ...l, ...patch };
        const mat = matOf(n.materialId);
        if ("materialId" in patch) {
          n.uom = mat?.baseUom ?? "";
          n.locationId = suggestedLocation(mat, locations, defaultLocationId);
        }
        if (!n.expiryTouched && ("materialId" in patch || "manufacturedOn" in patch)) n.expiresOn = defaultExpiry(mat, n.manufacturedOn);
        return n;
      }),
    );
  }

  const sent = lines.filter((l) => !l.skip);
  // Lines are sent in screen order (skipped PO lines left out); field errors come back as lines.<index>.<field>.
  const indexOf = new Map(sent.map((l, i) => [l.key, i]));
  const payload = JSON.stringify(
    sent.map(({ key: _k, expiryTouched: _e, po: _p, skip: _s, notOnPo, lineId, purchaseOrderLineId, ...rest }) => ({
      ...rest,
      brand: rest.brand?.trim() || matOf(rest.materialId)?.brand || "",
      lineId: lineId ?? "",
      ...(po ? { purchaseOrderLineId: purchaseOrderLineId ?? "" } : {}),
      ...(notOnPo ? { discrepancyKind: "wrong_item" } : {}),
    })),
  );
  const today = manilaToday();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="receiptId" value={initial?.receiptId ?? ""} />
      <input type="hidden" name="purchaseOrderId" value={po?.purchaseOrderId ?? ""} />
      <input type="hidden" name="lines" value={payload} />

      <Card className="@container">
        <h2 className="mb-3 text-[16px] font-semibold">Delivery</h2>
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
          {po ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] font-medium">Supplier</span>
              <p className="min-h-[44px] rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[14px]">
                {po.supplierName} <span className="text-muted">· order {po.poNumber}</span>
              </p>
            </div>
          ) : (
            <Field
              label="Supplier"
              htmlFor="supplierName"
              error={fe.supplierName ?? fe.supplierId}
              hint={supplier ? `${supplier.code}${supplier.qualityStatus === "suspended" ? " · STOPPED: this delivery cannot be posted" : ""}` : supplierName.trim().length > 1 ? "Not in the supplier list yet. Purchasing links it later." : "Type or pick from the list."}
            >
              <Input id="supplierName" name="supplierName" required autoComplete="off" list="supplier-options" placeholder="e.g. Laguna Oleo Supply" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <datalist id="supplier-options">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.code}</option>
                ))}
              </datalist>
            </Field>
          )}
          <Field label="Delivery receipt or invoice no." htmlFor="supplierDocumentNumber" error={fe.supplierDocumentNumber} hint="The number on the supplier's paper.">
            <Input id="supplierDocumentNumber" name="supplierDocumentNumber" required autoComplete="off" defaultValue={initial?.supplierDocumentNumber} />
          </Field>
          {!po && (
            <Field label="Why no purchase order?" htmlFor="unplannedReasonCode" error={fe.unplannedReasonCode} hint="Purchasing can make the PO later from the receipt.">
              <Select id="unplannedReasonCode" name="unplannedReasonCode" defaultValue={initial?.unplannedReasonCode || reasonCodes[0]?.code}>
                {reasonCodes.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <details className="group mt-3" open={!!fe.notes || !!initial?.notes}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[14px] font-medium text-primary-text">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" /> More details
          </summary>
          <Field label="Notes (optional)" htmlFor="notes" error={fe.notes}>
            <Textarea id="notes" name="notes" maxLength={1000} placeholder="Condition of the delivery, seals, temperature…" defaultValue={initial?.notes} />
          </Field>
        </details>
      </Card>

      {lines.map((l, pos) => {
        const mat = matOf(l.materialId);
        const i = indexOf.get(l.key) ?? -1;
        const err = (f: string) => (i >= 0 ? fe[`lines.${i}.${f}`] : undefined);
        const id = (f: string) => `line-${l.key}-${f}`;
        const locs = locationsFor(mat, locations);
        const place = locations.find((x) => x.id === l.locationId);
        const expired = !!l.expiresOn && l.expiresOn <= today;
        const storeIn = mat?.section ? storageBySection[mat.section] ?? [] : [];
        const moreErrors = ["manufacturedOn", "retestOn", "containerCount", "locationId", "discrepancyKind", "discrepancyNote"].some((f) => err(f));
        const title = mat ? `${mat.name}` : `Item ${pos + 1}`;
        return (
          <Card key={l.key} className={`@container ${l.skip ? "opacity-60" : ""}`} aria-labelledby={id("title")} data-testid={`receipt-line-${pos + 1}`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 id={id("title")} className="text-[16px] font-semibold leading-tight">
                  {title} {mat && <span className="text-[13px] font-normal text-muted">· {mat.code}</span>}
                </h2>
                {l.po && (
                  <p className="text-[13px] text-muted">
                    Ordered {l.po.orderedText} · still to come <strong className="text-fg">{l.po.openText}</strong>
                  </p>
                )}
              </div>
              {l.po ? (
                <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
                  <input type="checkbox" className="size-5" checked={!!l.skip} onChange={(e) => update(l.key, { skip: e.target.checked })} />
                  Not in this delivery
                </label>
              ) : (
                lines.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove item ${pos + 1}`}>
                    <Trash2 size={14} /> Remove
                  </Button>
                )
              )}
            </div>

            {!l.skip && (
              <>
                {!l.po && (
                  <div className="mb-4">
                    <Field label="Item" htmlFor={id("material")} error={err("materialId")} hint={mat?.requiresCoa ? "Needs the supplier's certificate (CoA): attach it on the receipt page." : undefined}>
                      <Select id={id("material")} value={l.materialId} onChange={(e) => update(l.key, { materialId: e.target.value })} required>
                        <option value="" disabled>Choose the item…</option>
                        {materials.map((m) => (
                          <option key={m.id} value={m.id}>{m.code} · {m.name}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}

                {/* Main fields: 1 column on a phone, 2 on a portrait tablet card, 3–4 on a wide card. */}
                <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-4">
                  <Field label="Quantity received" htmlFor={id("qty")} error={err("qty") ?? err("uom")} hint={mat ? (mat.baseUom === "g" ? "e.g. 25 kg" : `Counted in ${mat.baseUom}`) : undefined}>
                    {/* Fixed-width unit box beside a flexible number box: no overlap at any width. */}
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_96px] items-center gap-2">
                      <Input id={id("qty")} inputMode="decimal" autoComplete="off" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} required className="tabular" />
                      <Select id={id("uom")} aria-label={`Item ${pos + 1} unit`} value={l.uom || mat?.baseUom || ""} onChange={(e) => update(l.key, { uom: e.target.value })}>
                        {[...new Set([...(mat?.units ?? []), l.uom].filter(Boolean))].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                        {!mat && !l.uom && <option value="">—</option>}
                      </Select>
                    </div>
                  </Field>
                  <Field label="Supplier lot no." htmlFor={id("slot")} error={err("supplierLotNumber")} hint="From the label on the sack, drum or box.">
                    <Input id={id("slot")} autoComplete="off" value={l.supplierLotNumber} onChange={(e) => update(l.key, { supplierLotNumber: e.target.value })} required />
                  </Field>
                  <Field label="Expiry date" htmlFor={id("exp")} error={err("expiresOn")} hint={mat?.shelfLifeDays && !l.expiryTouched ? `Filled in from the ${mat.shelfLifeDays}-day shelf life. Change it to the date on the label.` : "The date on the supplier's label."}>
                    <Input id={id("exp")} type="date" value={l.expiresOn} onChange={(e) => update(l.key, { expiresOn: e.target.value, expiryTouched: true })} required className="min-w-0" />
                  </Field>
                  <Field label="Brand" htmlFor={id("brand")} error={err("brand")} hint={mat?.brand ? `Usual brand: ${mat.brand}. Change it if another brand came.` : "As printed on the container (optional)."}>
                    <Input id={id("brand")} autoComplete="off" value={l.brand ?? ""} placeholder={mat?.brand ?? ""} onChange={(e) => update(l.key, { brand: e.target.value })} />
                  </Field>
                </div>

                {mat?.storageConditions && (
                  <label className="mt-4 flex min-h-[44px] items-start gap-3 rounded-[12px] border border-line p-3 text-[14px]">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={l.storageConditionsConfirmed} onChange={(e) => update(l.key, { storageConditionsConfirmed: e.target.checked })} />
                    <span className="min-w-0">
                      I checked the storage: {mat.storageConditions}
                      {err("storageConditionsConfirmed") && <span className="block text-[13px] text-[var(--bad-fg)]">{err("storageConditionsConfirmed")}</span>}
                    </span>
                  </label>
                )}

                {l.notOnPo && (
                  <div className="mt-4">
                    <Field label="Why did this come? (not on the order)" htmlFor={id("whynot")} error={err("discrepancyNote")} hint="Saved as a draft; purchasing approves it before posting.">
                      <Input id={id("whynot")} value={l.discrepancyNote} onChange={(e) => update(l.key, { discrepancyNote: e.target.value })} required />
                    </Field>
                  </div>
                )}

                {expired && (
                  <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[var(--bad-fg)]">
                    <AlertTriangle size={14} className="shrink-0" /> Expired or expiring today: note it under More details. QA decides.
                  </p>
                )}

                {mat && (
                  <p className="mt-3 text-[13px] text-muted" data-testid={`receipt-line-${pos + 1}-place`}>
                    Goes to <strong className="text-fg">{place ? `${place.code} · ${sectionName(place.section)}` : "—"}</strong>
                    {mat.section && place?.section !== mat.section ? ` · then store in ${sectionName(mat.section)}${storeIn.length ? ` (${storeIn.join(", ")})` : ""}` : ""}
                  </p>
                )}

                <details className="group mt-2" open={moreErrors || !!l.discrepancyKind || expired}>
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[14px] font-medium text-primary-text">
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" /> More details
                    <span className="text-[12px] font-normal text-muted">(dates, containers, place, problems)</span>
                  </summary>
                  <div className="mt-2 grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-3">
                    <Field label="Made on (optional)" htmlFor={id("mfg")} error={err("manufacturedOn")}>
                      <Input id={id("mfg")} type="date" value={l.manufacturedOn} onChange={(e) => update(l.key, { manufacturedOn: e.target.value })} className="min-w-0" />
                    </Field>
                    <Field label="Retest date (optional)" htmlFor={id("retest")} error={err("retestOn")}>
                      <Input id={id("retest")} type="date" value={l.retestOn} onChange={(e) => update(l.key, { retestOn: e.target.value })} className="min-w-0" />
                    </Field>
                    <Field label="Containers (optional)" htmlFor={id("containers")} error={err("containerCount")} hint="Sacks, drums or boxes: one label each.">
                      <Input id={id("containers")} inputMode="numeric" value={l.containerCount} onChange={(e) => update(l.key, { containerCount: e.target.value })} />
                    </Field>
                    <Field label="Put it in" htmlFor={id("loc")} error={err("locationId")} hint={mat && !mat.requiresIncomingInspection ? "This item can be used right away (no QA check)." : "New lots wait for the QA check."}>
                      <Select id={id("loc")} value={l.locationId} onChange={(e) => update(l.key, { locationId: e.target.value })} required>
                        {[...new Set(locs.map((x) => x.section ?? "other"))].map((s) => (
                          <optgroup key={s} label={sectionName(s)}>
                            {locs
                              .filter((x) => (x.section ?? "other") === s)
                              .map((x) => (
                                <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
                              ))}
                          </optgroup>
                        ))}
                      </Select>
                    </Field>
                    {!l.notOnPo && (
                      <>
                        <Field label="Problem with the delivery?" htmlFor={id("disc")} error={err("discrepancyKind")}>
                          <Select id={id("disc")} value={l.discrepancyKind} onChange={(e) => update(l.key, { discrepancyKind: e.target.value })}>
                            {DISCREPANCIES.map(([v, t]) => (
                              <option key={v} value={v}>{t}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="What was wrong" htmlFor={id("discnote")} error={err("discrepancyNote")}>
                          <Input id={id("discnote")} value={l.discrepancyNote} onChange={(e) => update(l.key, { discrepancyNote: e.target.value })} disabled={!l.discrepancyKind} />
                        </Field>
                      </>
                    )}
                  </div>
                </details>
              </>
            )}
          </Card>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => {
          setLines((ls) => [...ls, { ...blank(nextKey), notOnPo: !!po }]);
          setNextKey((k) => k + 1);
        }}
      >
        <Plus size={16} /> {po ? "Add an item not on the order" : "Add another item"}
      </Button>

      {fe.lines && <p className="text-[13px] text-[var(--bad-fg)]">{fe.lines}</p>}
      <FormMessage state={state} />
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap lg:bottom-0 items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[16px] sm:border">
        <p className="text-[13px] text-muted">
          {sent.length} {sent.length === 1 ? "item" : "items"} · posting makes {sent.length} {sent.length === 1 ? "lot" : "lots"}
        </p>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <SubmitButton name="intent" value="draft" variant="secondary" size="lg" pendingText="Saving…" className="flex-1 sm:flex-none" formNoValidate>
            Save draft
          </SubmitButton>
          {canPost && (
            <SubmitButton name="intent" value="post" variant="cta" size="lg" pendingText="Posting…" className="flex-1 sm:flex-none">
              {printLabels ? "Save and print labels" : "Post receipt"}
            </SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}
