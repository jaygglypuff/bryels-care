"use client";
import { useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import type { OutboxEntry } from "@/lib/offline/store";
import { parseScan } from "@/lib/scan/payload";
import { Button, Card, CardTitle, EmptyState, Field, Input, Select, Textarea } from "@/ui/core";
import { Scanner } from "@/ui/scanner";
import { Chip, StatusChip } from "@/ui/status";
import type { Ref } from "./workspace";

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

/**
 * Blind count capture offline (US-7-04, docs/offline-sync.md §3 `stock_count`). Local checks on the
 * cached data: the count is open as cached, the location is in its scope, the lot is known at the
 * site (or the item is described as unlabelled), the quantity is a number. The server re-checks the
 * count is still open on replay (`count_closed` otherwise).
 */
export function CountCapture({ siteId, data, queue, onQueued }: { siteId: string; data: Ref; queue: OutboxEntry[]; onQueued: () => Promise<void> }) {
  const [countId, setCountId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lotId, setLotId] = useState<string | null>(null);
  const [unlabelled, setUnlabelled] = useState(false);
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const count = data.counts.find((c) => c.id === countId) ?? (data.counts.length === 1 ? data.counts[0] : null);
  const scope = data.locations.filter((l) => count?.locationIds.includes(l.id));
  const location = scope.find((l) => l.id === locationId) ?? (scope.length === 1 ? scope[0] : null);
  const lot = data.lots.find((l) => l.id === lotId) ?? null;
  const already = queue.filter((e) => e.type === "inventory.stock_count.record" && e.status !== "synced" && e.payload.countId === count?.id && e.payload.locationId === location?.id && e.payload.lotId === lot?.id && lot);

  function onScan(raw: string) {
    setMsg(null);
    const p = parseScan(raw);
    if (p.kind === "invalid") return setMsg({ ok: false, text: "That is not a label of ours. Scan the lot or location label, or type the number." });
    if (p.kind === "typed" && p.type === "LOC") {
      const l = scope.find((x) => x.code === p.value);
      return l ? setLocationId(l.id) : setMsg({ ok: false, text: `Location ${p.value} is not on this count sheet.` });
    }
    if (p.kind === "typed" && p.type !== "LOT") return setMsg({ ok: false, text: "Scan a lot label (BC:LOT:…) or a location label." });
    const lotNo = p.kind === "typed" ? p.value : p.value;
    const found = data.lots.find((l) => l.lotNumber === lotNo);
    if (!found) return setMsg({ ok: false, text: `Lot ${lotNo} is not in this device's data for this site. Count it as unlabelled, or refresh offline data when connected.` });
    setUnlabelled(false);
    setLotId(found.id);
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!count) e.count = "Choose the count.";
    if (!location) e.location = "Choose or scan the location.";
    if (!unlabelled && !lot) e.lot = "Scan the lot, or tick “No label”.";
    if (unlabelled && description.trim().length < 3) e.description = "Describe the item (at least 3 characters).";
    if (!QTY_RE.test(qty.trim())) e.qty = "Enter the counted quantity (0 or more, up to 6 decimals).";
    if (lot?.baseUom === "pcs" && QTY_RE.test(qty.trim()) && qty.includes(".")) e.qty = "This lot is counted in pieces; enter a whole number.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setMsg(null);
    try {
      await syncAgent().enqueue({
        type: "inventory.stock_count.record",
        siteId,
        payload: { countId: count!.id, locationId: location!.id, lotId: unlabelled ? null : lot!.id, unlabelledDescription: unlabelled ? description.trim() : null, qty: qty.trim(), note: note.trim() || null },
        summary: `Count ${count!.countNumber} · ${location!.code} · ${unlabelled ? `unlabelled: ${description.trim()}` : lot!.lotNumber} · ${qty.trim()} ${lot?.baseUom ?? ""}`.trim(),
      });
      setMsg({ ok: true, text: navigator.onLine ? "Saved. Sending now…" : "Saved on this device. It will sync when you are back online." });
      setLotId(null);
      setQty("");
      setNote("");
      setDescription("");
      await onQueued();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  if (data.counts.length === 0) {
    return (
      <Card>
        <EmptyState title="No open count for you on this device">Open counts where you are a counter are downloaded with the offline data. Refresh it when connected after the count is released.</EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Count (blind)</CardTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Count" htmlFor="oc-count" error={errors.count}>
          <Select id="oc-count" value={count?.id ?? ""} onChange={(e) => setCountId(e.target.value)}>
            {data.counts.length > 1 && <option value="">Choose…</option>}
            {data.counts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.countNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location" htmlFor="oc-location" error={errors.location}>
          <Select id="oc-location" value={location?.id ?? ""} onChange={(e) => setLocationId(e.target.value)}>
            {scope.length !== 1 && <option value="">Choose or scan…</option>}
            {scope.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Scanner onScan={onScan} label="Scan the lot (or the location)" placeholder="BC:LOT:L-2610-00001 · L-2610-00001" autoFocus={false} />
      </div>
      {lot && !unlabelled && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px]" data-testid="oc-lot">
          <span className="font-medium">{lot.lotNumber}</span> {lot.itemName} <StatusChip status={lot.qualityStatus} />
        </p>
      )}
      {errors.lot && <p className="mt-1 text-[12px] text-[var(--bad-fg)]">{errors.lot}</p>}
      <label className="mt-3 flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="checkbox" checked={unlabelled} onChange={(e) => setUnlabelled(e.target.checked)} className="size-5" /> No label: describe the item instead
      </label>
      {unlabelled && (
        <Field label="What you see" htmlFor="oc-desc" error={errors.description}>
          <Input id="oc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="White pail, no label, about 5 kg" maxLength={500} />
        </Field>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={`Counted quantity${lot ? ` (${lot.baseUom})` : ""}`} htmlFor="oc-qty" error={errors.qty}>
          <Input id="oc-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Note (optional)" htmlFor="oc-note">
          <Textarea id="oc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[44px]" />
        </Field>
      </div>
      {already.length > 0 && (
        <p className="mt-2 text-[13px] text-[var(--warn-fg)]">
          <Chip tone="warn">Already counted on this device</Chip> Saving again records a correction; the first entry is kept.
        </p>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-3 text-[13px] text-[var(--ok-fg)]" : "mt-3 text-[13px] text-[var(--bad-fg)]"}>
          {msg.text}
        </p>
      )}
      <div className="sticky bottom-3 mt-4">
        <Button size="lg" className="w-full sm:w-auto" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save count on this device"}
        </Button>
      </div>
    </Card>
  );
}
