"use client";
import { useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { MoreDetails } from "@/ui/guide";
import { friendlyUnit } from "@/lib/units";
import { useActionForm } from "../_kit/forms";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { createAdjustmentAction, type AdjustmentLotOption } from "./actions";

type Reason = { code: string; label: string; requiresNote: boolean };
type Row = { key: number; search: string; lot: AdjustmentLotOption | null; options: AdjustmentLotOption[]; message: string | null; locationId: string; direction: "decrease" | "increase"; qty: string; unit: string };

const blankRow = (key: number): Row => ({ key, search: "", lot: null, options: [], message: null, locationId: "", direction: "decrease", qty: "", unit: "" });

/** A lot found by <ScanOrPick> (tap, scan or name), with the shelves that hold it at this site. */
function toOption(c: PickCandidate): AdjustmentLotOption {
  return {
    id: c.value,
    lotNumber: c.code ?? "",
    itemName: c.title,
    baseUom: c.uom ?? "pcs",
    detail: c.detail ?? "",
    shelves: (c.places ?? []).map((p) => ({ id: p.value, code: p.code ?? "", qtyBase: "", text: (p.detail ?? "").split(" · ")[1]?.replace(/ here$/, "") ?? "" })),
  };
}

/** One lot of the adjustment: scan the label or find it by name, pick the shelf that holds it, Take away / Add, how much. */
function LotLine({ i, row, set, remove, canRemove, fe }: { i: number; row: Row; set: (p: Partial<Row>) => void; remove: () => void; canRemove: boolean; fe: Record<string, string> }) {
  const choose = (lot: AdjustmentLotOption) => set({ lot, options: [], message: null, locationId: lot.shelves[0]?.id ?? "", unit: friendlyUnit(lot.baseUom) });
  const id = (f: string) => `${f}_${i}`;
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-[16px] border border-line p-3" data-testid={`adjustment-line-${i + 1}`}>
      <legend className="px-1 text-[13px] font-medium text-muted">Lot {i + 1}</legend>
      <input type="hidden" name={id("note")} value="" />
      <ScanOrPick
        kind="lot"
        name={id("lotId")}
        id={id("lot")}
        label="Which lot?"
        hint="Scan the label on the sack or box, or find the item by name."
        value={row.lot?.id ?? null}
        onChange={(_v, c) => (c ? choose(toOption(c)) : set({ lot: null, locationId: "", options: [], message: null }))}
        error={fe[`lotId_${i}`]}
      />

      {row.lot && (
        <div className="grid gap-3 sm:grid-cols-2">
          {row.lot.shelves.length === 0 ? (
            <p className="text-[13px] text-muted sm:col-span-2">This lot is on no shelf now. Ask your manager how to add found stock.</p>
          ) : (
            <div className="sm:col-span-2">
              <ScanOrPick
                kind="location"
                name={id("locationId")}
                id={id("shelf")}
                label="Which shelf?"
                candidates={row.lot.shelves.map((sh) => ({ value: sh.id, title: sh.code, detail: `${sh.text} there now`, code: sh.code, codes: [sh.code] }))}
                value={row.locationId}
                hideWhenSingle
                onlyCandidates
                search={false}
                onChange={(v) => v !== row.locationId && set({ locationId: v ?? "" })}
                error={fe[`locationId_${i}`]}
              />
            </div>
          )}
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-[13px] font-medium">Take away or add?</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {(
                [
                  ["decrease", "Take away", <Minus key="m" size={16} />],
                  ["increase", "Add", <Plus key="p" size={16} />],
                ] as const
              ).map(([v, t, icon]) => (
                <label key={v} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[12px] border border-line px-3 text-[14px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:font-semibold">
                  <input type="radio" name={id("direction")} value={v} checked={row.direction === v} onChange={() => set({ direction: v })} className="size-5 accent-[var(--primary)]" />
                  {icon} {t}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={row.direction === "decrease" ? "How much to take away?" : "How much to add?"} htmlFor={id("qty")} error={fe[`qty_${i}`] ?? fe[`qtyUom_${i}`]}>
            <QtyUnitInput id={id("qty")} name={id("qty")} unitName={id("qtyUom")} baseUom={row.lot.baseUom} qty={row.qty} onQtyChange={(v) => set({ qty: v })} unit={row.unit || undefined} onUnitChange={(u) => set({ unit: u })} required />
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails open={!!fe[`unitCost_${i}`]}>
              <Field label={`Cost per ${row.lot.baseUom} in ₱`} htmlFor={id("unitCost")} error={fe[`unitCost_${i}`]} hint="Leave empty if you do not know it.">
                <Input id={id("unitCost")} name={id("unitCost")} inputMode="decimal" autoComplete="off" />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
      {canRemove && (
        <div>
          <Button type="button" variant="ghost" onClick={remove} aria-label={`Remove lot ${i + 1}`}>
            <Trash2 size={16} /> Remove this lot
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Fix stock (usability test 2026-10-30): what happened, then one card per lot ("Scan or type the lot";
 * only the shelves that hold it), and ONE main button "Send to manager" (save + send in one step).
 * "Save for later" keeps it unfinished. The server checks every rule again.
 */
export function AdjustmentForm({ reasons, idempotencyKey }: { reasons: readonly Reason[]; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(createAdjustmentAction);
  const [sending, setSending] = useState<"send" | "draft">("send");
  const [rows, setRows] = useState<Row[]>([blankRow(0)]);
  const [reason, setReason] = useState("");
  const fe = state?.fieldErrors ?? {};
  const needsNote = reasons.find((r) => r.code === reason)?.requiresNote ?? false;
  return (
    <form
      onSubmit={(e) => {
        // The clicked button decides: send to the manager, or save for later.
        const sub = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = e.currentTarget.elements.namedItem("intent") as HTMLInputElement | null;
        if (intent) intent.value = sub?.value === "draft" ? "draft" : "send";
        setSending(sub?.value === "draft" ? "draft" : "send");
        onSubmit(e);
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lineCount" value={rows.length} />
      <input type="hidden" name="intent" defaultValue="send" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened?" htmlFor="reasonCode" error={fe.reasonCode}>
          <Select id="reasonCode" name="reasonCode" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="" disabled>Choose…</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label={needsNote ? "Tell us more (needed)" : "Tell us more (optional)"} htmlFor="reasonNote" error={fe.reasonNote}>
          <Input id="reasonNote" name="reasonNote" maxLength={500} required={needsNote} placeholder="e.g. Drum dented during unloading" />
        </Field>
      </div>
      {rows.map((r, i) => (
        <LotLine
          key={r.key}
          i={i}
          row={r}
          fe={fe}
          canRemove={rows.length > 1}
          set={(p) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, ...p } : x)))}
          remove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
        />
      ))}
      <div>
        <Button type="button" variant="secondary" onClick={() => setRows((rs) => [...rs, blankRow(Date.now())])} disabled={rows.length >= 100}>
          <Plus size={16} /> Add another lot
        </Button>
      </div>
      <p className="text-[13px] text-muted">Nothing changes in stock until a manager approves it. Stock found without any label is added by a site manager.</p>
      <FormMessage state={state} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" value="send" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending && sending === "send" ? "Sending…" : "Send to manager"}
        </Button>
        <Button type="submit" value="draft" variant="secondary" size="lg" disabled={pending} className="w-full sm:w-auto" formNoValidate>
          {pending && sending === "draft" ? "Saving…" : "Save for later"}
        </Button>
      </div>
    </form>
  );
}
