"use client";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { syncAgent } from "@/lib/offline/agent";
import type { ReferenceLot } from "@/lib/offline/protocol";
import type { OutboxEntry } from "@/lib/offline/store";
import { parseScan } from "@/lib/scan/payload";
import { Button, Card, CardTitle, EmptyState, Field, Input, Select } from "@/ui/core";
import { Scanner } from "@/ui/scanner";
import { Banner, Chip, StatusChip } from "@/ui/status";
import type { Ref } from "./workspace";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** Same window as the server's toleranceRange: an absolute tolerance wins over the percentage. */
function range(theo: string, pct: string, abs: string | null) {
  const t = new Decimal(theo);
  const band = abs !== null ? new Decimal(abs) : t.mul(pct).div(100);
  return { min: t.minus(band), max: t.plus(band) };
}

function lotProblem(lot: ReferenceLot, materialId: string, materialName: string, reserved: string[], names: Map<string, string>): string | null {
  if (lot.materialId !== materialId) return `This is ${lot.itemName ?? names.get(lot.materialId ?? "") ?? "another item"}, not ${materialName}.`;
  if (reserved.length && !reserved.includes(lot.id)) return `Lot ${lot.lotNumber} is not the lot reserved for this batch.`;
  if (lot.qualityStatus !== "released") return `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace(/_/g, " ")} (as of the offline data); it cannot be weighed.`;
  if (lot.expiresOn && lot.expiresOn < today()) return `Lot ${lot.lotNumber} expired on ${lot.expiresOn}.`;
  return null;
}

/**
 * Weighing capture offline (US-7-04, A-OFF-04): only on a registered device, for a batch in
 * weighing as cached. Local checks: right material, reserved lot, released and in date as cached,
 * line total within tolerance. Out-of-tolerance weights are not queued (an exception needs QA
 * online); the server re-checks lot status, tolerance and the scale on replay and parks anything
 * that changed. The checker signs the weighing online after it syncs (ADR-030 co-sign needs a password check).
 */
export function WeighCapture({ siteId, data, queue, onQueued }: { siteId: string; data: Ref; queue: OutboxEntry[]; onQueued: () => Promise<void> }) {
  const batches = data.batches.filter((b) => b.status === "in_process" && b.weighing);
  const [batchId, setBatchId] = useState("");
  const [lineId, setLineId] = useState("");
  const [lotId, setLotId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");
  const [partial, setPartial] = useState(false);
  const [scale, setScale] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const batch = batches.find((b) => b.id === batchId) ?? (batches.length === 1 ? batches[0] : null);
  const queuedFor = (id: string) => queue.filter((e) => e.type === "production.dispense_record.create" && e.payload.batchMaterialId === id && e.status !== "synced" && e.status !== "conflict");
  const lines = (batch?.lines ?? []).filter((l) => l.status === "pending" || l.status === "partial");
  const line = lines.find((l) => l.id === lineId) ?? null;
  const lot = data.lots.find((l) => l.id === lotId) ?? null;
  const names = useMemo(() => new Map(data.materials.map((m) => [m.id, m.name])), [data.materials]);
  const problem = line && lot ? lotProblem(lot, line.materialId, line.materialName, line.reservedLotIds, names) : null;
  const places = lot ? lot.balances.filter((b) => new Decimal(b.qty).gt(0)) : [];
  const place = places.find((b) => b.locationId === locationId) ?? (places.length === 1 ? places[0] : null);
  const locCode = (id: string) => data.locations.find((l) => l.id === id)?.code ?? "?";
  const fefo = line
    ? data.lots
        .filter((l) => !lotProblem(l, line.materialId, line.materialName, line.reservedLotIds, names) && l.balances.some((b) => new Decimal(b.qty).gt(0)))
        .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999"))[0]
    : null;

  let check: { tone: "ok" | "bad" | "warn"; text: string } | null = null;
  let net: Decimal | null = null;
  if (line && qty.trim()) {
    try {
      net = new Decimal(qty.trim().replace(/,/g, ""));
      if (!net.isFinite() || net.lte(0)) throw new Error();
      const { min, max } = range(line.theoreticalQtyG, line.tolerancePct, line.toleranceAbsG);
      const total = new Decimal(line.dispensedQtyG).plus(net);
      const win = `${min.toDecimalPlaces(3)}–${max.toDecimalPlaces(3)} ${line.baseUom}`;
      if (place && net.gt(place.qty)) check = { tone: "bad", text: `Only ${place.qty} ${line.baseUom} of this lot at ${locCode(place.locationId)} (as of the offline data).` };
      else if (partial) check = total.gt(max) ? { tone: "bad", text: `The line total ${total} would be above ${win}.` } : total.gte(min) ? { tone: "warn", text: `This completes the line (${total} within ${win}): untick “another lot follows”.` } : { tone: "ok", text: `Partial: line total ${total} of ${win}.` };
      else check = total.gte(min) && total.lte(max) ? { tone: "ok", text: `Within tolerance (${win}).` } : { tone: "bad", text: `Outside tolerance: line total ${total}, allowed ${win}. Re-weigh. An exception needs QA online.` };
    } catch {
      check = { tone: "bad", text: "Enter the weight as a number." };
      net = null;
    }
  }

  function onScan(raw: string) {
    setMsg(null);
    const p = parseScan(raw);
    if (p.kind === "invalid") return setMsg({ ok: false, text: "That is not a label of ours. Scan the container's lot label." });
    if (p.kind === "typed" && p.type === "EQP") return setScale(p.value);
    if (p.kind === "typed" && p.type === "LOC") {
      const l = data.locations.find((x) => x.code === p.value);
      return l ? setLocationId(l.id) : setMsg({ ok: false, text: `Location ${p.value} is not at this site.` });
    }
    if (p.kind === "typed" && p.type !== "LOT") return setMsg({ ok: false, text: "Scan the lot label of the container you weigh from." });
    const found = data.lots.find((l) => l.lotNumber === p.value);
    if (!found) return setMsg({ ok: false, text: `Lot ${p.value} is not in this device's data for this site.` });
    setLotId(found.id);
    setLocationId("");
  }

  async function save() {
    if (!batch || !line) return setMsg({ ok: false, text: "Choose the batch and the ingredient." });
    if (!lot) return setMsg({ ok: false, text: "Scan the lot." });
    if (problem) return setMsg({ ok: false, text: problem });
    if (!place) return setMsg({ ok: false, text: places.length ? "Choose the location you take it from." : `Lot ${lot.lotNumber} has no stock at this site (as of the offline data).` });
    if (!net || !check || check.tone !== "ok") return setMsg({ ok: false, text: check?.text ?? "Enter the weight." });
    const needScale = batch.weighing?.requiresEquipment;
    if (needScale && !scale) return setMsg({ ok: false, text: "Choose or scan the scale." });
    if (!partial && queuedFor(line.id).length) return setMsg({ ok: false, text: `${line.materialName} already has a weighing waiting to sync on this device.` });
    setBusy(true);
    setMsg(null);
    try {
      await syncAgent().enqueue({
        type: "production.dispense_record.create",
        siteId,
        payload: { batchId: batch.id, batchMaterialId: line.id, lotRef: `BC:LOT:${lot.lotNumber}`, locationRef: `BC:LOC:${locCode(place.locationId)}`, qty: net.toString(), uom: line.baseUom, equipmentRef: scale || null, partial },
        summary: `Weigh ${batch.batchNumber} · ${line.materialName} · ${net.toString()} ${line.baseUom} from ${lot.lotNumber}`,
      });
      setMsg({ ok: true, text: navigator.onLine ? "Saved. Sending now… The checker signs it online after it syncs." : "Saved on this device. It syncs when you are back online; the checker signs it then." });
      setQty("");
      setLotId(null);
      setPartial(false);
      setLineId("");
      await onQueued();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  if (!batches.length) {
    return (
      <Card>
        <EmptyState title="No batch in weighing on this device">Batches in process at this site are downloaded with the offline data. Refresh it when connected after the line clearance is signed.</EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Weighing</CardTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Batch" htmlFor="ow-batch">
          <Select id="ow-batch" value={batch?.id ?? ""} onChange={(e) => (setBatchId(e.target.value), setLineId(""))}>
            {batches.length > 1 && <option value="">Choose…</option>}
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNumber} · {b.productName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ingredient" htmlFor="ow-line">
          <Select id="ow-line" value={line?.id ?? ""} onChange={(e) => setLineId(e.target.value)}>
            <option value="">Choose…</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lineNo}. {l.materialName} · target {new Decimal(l.theoreticalQtyG).toDecimalPlaces(3).toString()} {l.baseUom}
                {queuedFor(l.id).length ? " · queued" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {line && (
        <>
          {fefo && <p className="mt-2 text-[13px] text-muted">Suggested (FEFO, as cached): {fefo.lotNumber}{fefo.expiresOn ? `, expires ${fefo.expiresOn}` : ""}</p>}
          <div className="mt-3">
            <Scanner onScan={onScan} label="Scan the container's lot label" placeholder="BC:LOT:L-2610-00001" autoFocus={false} />
          </div>
          {lot && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px]" data-testid="ow-lot">
              <span className="font-medium">{lot.lotNumber}</span> {lot.itemName} <StatusChip status={lot.qualityStatus} />
            </p>
          )}
          {problem && <Banner tone="bad" title="This lot cannot be used">{problem}</Banner>}
          {lot && !problem && places.length > 1 && (
            <Field label="Taken from" htmlFor="ow-loc">
              <Select id="ow-loc" value={place?.locationId ?? ""} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose…</option>
                {places.map((b) => (
                  <option key={b.locationId} value={b.locationId}>
                    {locCode(b.locationId)} · {b.qty} {lot.baseUom}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={`Net weight (${line.baseUom})`} htmlFor="ow-qty">
              <Input id="ow-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" autoComplete="off" />
            </Field>
            {batch?.weighing?.requiresEquipment && (
              <Field label="Scale" htmlFor="ow-scale">
                <Select id="ow-scale" value={scale} onChange={(e) => setScale(e.target.value)}>
                  <option value="">Choose or scan…</option>
                  {batch.scales.map((x) => (
                    <option key={x.id} value={x.code}>
                      {x.code} · {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[14px]">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="size-5" /> Another lot follows for this ingredient
          </label>
          {check && (
            <p className="mt-1">
              <Chip tone={check.tone}>{check.text}</Chip>
            </p>
          )}
        </>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-3 text-[13px] text-[var(--ok-fg)]" : "mt-3 text-[13px] text-[var(--bad-fg)]"}>
          {msg.text}
        </p>
      )}
      <div className="sticky bottom-3 mt-4">
        <Button size="lg" className="w-full sm:w-auto" onClick={() => void save()} disabled={busy || !line}>
          {busy ? "Saving…" : "Save weighing on this device"}
        </Button>
      </div>
    </Card>
  );
}
