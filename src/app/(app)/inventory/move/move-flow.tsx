"use client";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Boxes, MapPin, RotateCcw, ScanLine } from "lucide-react";
import { Button, Card, Field, Select, Textarea, inputClass } from "@/ui/core";
import { baseToUnitText, fmtFriendly, friendlyUnitFor, toBaseQty } from "@/lib/units";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { Banner, StatusChip } from "@/ui/status";
import type { MoveResult } from "@/modules/inventory/moves";
import { lookupDestinationAction, lookupSourceAction, postMoveAction, undoMoveAction, type SourceInfo } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Scan field: a keyboard-wedge scanner types and presses Enter; typing works the same. */
function ScanField({ id, label, placeholder, onScan, busy, autoFocus }: { id: string; label: string; placeholder: string; onScan: (v: string) => void; busy: boolean; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = ref.current?.value ?? "";
        if (v.trim()) onScan(v);
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={id} className="flex items-center gap-2 text-[14px] font-semibold">
        <ScanLine size={16} /> {label}
      </label>
      <div className="flex gap-2">
        <input ref={ref} id={id} autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" placeholder={placeholder} className={`${inputClass} min-h-[52px] min-w-0 flex-1 font-mono text-[16px]`} />
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "…" : "Find"}
        </Button>
      </div>
    </form>
  );
}

function UndoToast({ result, onDone }: { result: MoveResult; onDone: () => void }) {
  const until = result.undo ? new Date(result.undo.until).getTime() : 0;
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; reversal?: boolean } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!result.undo) return;
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [result.undo, until]);
  const canUndo = !!result.undo && left > 0 && !msg?.ok;
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <Banner tone={result.alreadyMoved ? "info" : "ok"} title={result.alreadyMoved ? "Already moved" : `Saved ${result.transferNumber}`}>
        {result.message}
      </Banner>
      {msg && (
        <Banner tone={msg.ok ? "ok" : "warn"} title={msg.ok ? "Undone" : "Undo not possible"}>
          {msg.text}
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        {canUndo && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await undoMoveAction(result.transferId);
                // Joins the action's transition: the message and the refreshed page commit together (ADR-043).
                startTransition(() => setMsg({ ok: r.ok, text: r.message, reversal: r.offerReversalRequest }));
              })
            }
          >
            <RotateCcw size={16} /> {pending ? "Undoing…" : `Undo (${left}s)`}
          </Button>
        )}
        <Button type="button" variant="cta" onClick={onDone}>
          Next move
        </Button>
      </div>
    </div>
  );
}

export function MoveFlow({ locations, initialSource, initialDestination }: { locations: Loc[]; initialSource: SourceInfo | null; initialDestination: Loc | null }) {
  const [source, setSource] = useState<SourceInfo | null>(initialSource);
  const [fromId, setFromId] = useState<string>(initialSource?.kind === "lot" ? (initialSource.locations[0]?.id ?? "") : "");
  // Usability test 2026-10-30: the amount starts in the friendly unit (60 kg, not 60000 g).
  const startAmount = (src: SourceInfo | null, locId?: string) => {
    if (src?.kind !== "lot") return { qty: "", unit: "" };
    const l = src.locations.find((x) => x.id === locId) ?? src.locations[0];
    const u = friendlyUnitFor(l?.loose ?? "0", src.baseUom);
    return { qty: l ? baseToUnitText(l.loose, src.baseUom, u) : "", unit: u };
  };
  const [qty, setQty] = useState<string>(() => startAmount(initialSource).qty);
  const [unit, setUnit] = useState<string>(() => startAmount(initialSource).unit);
  const [dest, setDest] = useState<Loc | null>(initialDestination);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [busy, start] = useTransition();

  const allowed = useMemo(() => (source ? locations.filter((l) => source.allowedKinds.includes(l.kind)) : locations), [source, locations]);
  const fromLoc = source?.kind === "lot" ? source.locations.find((l) => l.id === fromId) : null;
  const sourceLocationId = source?.kind === "box" ? source.location?.id : fromId;
  const destWrongKind = !!(dest && source && !source.allowedKinds.includes(dest.kind));
  const parsedAmount = source?.kind === "lot" && qty.trim() ? toBaseQty(qty, unit, source.baseUom) : null;
  const moveAmountText = source?.kind === "lot" ? (parsedAmount?.ok ? fmtFriendly(parsedAmount.qtyBase, source.baseUom) : `${qty} ${unit}`) : "";
  const step = !source ? 1 : source.kind === "lot" && (!fromId || !qty) ? 2 : !dest ? 3 : 4;

  const reset = () => {
    setSource(null);
    setDest(null);
    setQty("");
    setUnit("");
    setFromId("");
    setReason("");
    setError(null);
    setResult(null);
    setKey(newKey());
  };

  if (result) return <UndoToast result={result} onDone={reset} />;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-[12px] font-medium text-muted" aria-label="Steps">
        {["Scan box or lot", "Quantity", "Scan destination", "Confirm"].map((s, i) => (
          <li key={s} className={`rounded-full border px-3 py-1 ${step === i + 1 ? "border-primary bg-primary-soft text-primary-text" : "border-line"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && (
        <Banner tone="bad" title="Not moved">
          {error}
        </Banner>
      )}

      <Card>
        {!source ? (
          <ScanField
            id="src"
            label="1 · Scan the box or lot label"
            placeholder="BC:BOX:BX-00000001 · L-2610-00001"
            busy={busy}
            autoFocus
            onScan={(v) =>
              start(async () => {
                setError(null);
                const r = await lookupSourceAction(v);
                if (!r.ok) return setError(r.message);
                setSource(r.data);
                if (r.data.kind === "lot") {
                  setFromId(r.data.locations[0]?.id ?? "");
                  const a = startAmount(r.data);
                  setQty(a.qty);
                  setUnit(a.unit);
                }
              })
            }
          />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] text-muted">{source.kind === "box" ? <Boxes size={15} /> : null} {source.kind === "box" ? "Box" : "Lot"}</p>
              <p className="font-mono text-[18px] font-semibold">{source.kind === "box" ? source.number : source.lotNumber}</p>
              {source.kind === "box" ? (
                <ul className="mt-1 text-[13px]">
                  {source.contents.map((c) => (
                    <li key={c.lotNumber}>
                      {fmtFriendly(c.qty, c.uom)} {c.itemName} · lot {c.lotNumber} <StatusChip status={c.status} />
                    </li>
                  ))}
                  <li className="text-muted">At {source.location?.code ?? "—"}</li>
                </ul>
              ) : (
                <p className="text-[13px]">
                  {source.itemName} <StatusChip status={source.status} />
                </p>
              )}
            </div>
            <Button type="button" variant="ghost" onClick={reset}>
              Change
            </Button>
          </div>
        )}
        {source?.kind === "box" && source.blockedReason && (
          <div className="mt-3">
            <Banner tone="warn" title="This box cannot be moved">
              {source.blockedReason}
            </Banner>
          </div>
        )}
      </Card>

      {source?.kind === "lot" && (
        <Card>
          {source.locations.length === 0 ? (
            <p className="text-[13px] text-muted">This lot has no stock left at any location.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="2 · Take it from" htmlFor="from">
                <Select
                  id="from"
                  value={fromId}
                  onChange={(e) => {
                    setFromId(e.target.value);
                    const a = startAmount(source, e.target.value);
                    setQty(a.qty);
                    setUnit(a.unit);
                  }}
                >
                  {source.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {fmtFriendly(l.loose, source.baseUom)} not in a box
                      {Number(l.boxed) > 0 ? ` (+${fmtFriendly(l.boxed, source.baseUom)} in boxes)` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How much?" htmlFor="qty" hint={fromLoc ? `${fmtFriendly(fromLoc.loose, source.baseUom)} not in a box at ${fromLoc.code}. Stock in a box moves with its box.` : undefined}>
                <QtyUnitInput id="qty" baseUom={source.baseUom} qty={qty} onQtyChange={setQty} unit={unit || undefined} onUnitChange={setUnit} unitLabel="Unit for the amount" />
              </Field>
            </div>
          )}
        </Card>
      )}

      {source && (
        <Card>
          {!dest ? (
            <div className="space-y-3">
              <ScanField
                id="dst"
                label="3 · Scan the destination location"
                placeholder="BC:LOC:A-01 · A-01"
                busy={busy}
                autoFocus={source.kind === "box"}
                onScan={(v) =>
                  start(async () => {
                    setError(null);
                    const r = await lookupDestinationAction(v);
                    if (!r.ok) return setError(r.message);
                    setDest(r.data);
                  })
                }
              />
              <Field label="…or choose" htmlFor="destPick">
                <Select id="destPick" defaultValue="" onChange={(e) => setDest(locations.find((l) => l.id === e.target.value) ?? null)}>
                  <option value="" disabled>
                    Choose a location…
                  </option>
                  {allowed
                    .filter((l) => l.id !== sourceLocationId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name} ({l.kind})
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2">
                <MapPin size={16} /> <span className="font-mono text-[18px] font-semibold">{dest.code}</span> <span className="text-[13px] text-muted">{dest.name}</span>
              </p>
              <Button type="button" variant="ghost" onClick={() => setDest(null)}>
                Change
              </Button>
            </div>
          )}
          {destWrongKind && (
            <div className="mt-3">
              <Banner tone="warn" title="This stock cannot go there">
                {dest!.code} is a {dest!.kind} place. Choose a place from the list above, or scan another shelf.
              </Banner>
            </div>
          )}
        </Card>
      )}

      {source && dest && !destWrongKind && (
        <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:rounded-[24px] sm:border-0 sm:p-5 sm:shadow-[var(--shadow-card)]">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            Move <strong className="font-mono">{source.kind === "box" ? source.number : `${moveAmountText} of ${source.lotNumber}`}</strong>
            {source.kind === "lot" && fromLoc ? <> from {fromLoc.code}</> : source.kind === "box" ? <> from {source.location?.code}</> : null}
            <ArrowRight size={16} /> <strong className="font-mono">{dest.code}</strong>?
          </p>
          <Textarea aria-label="Reason (optional)" placeholder="Reason (optional), e.g. put-away after receiving" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="min-h-[52px]" />
          <Button
            type="button"
            variant="cta"
            size="lg"
            className="w-full sm:w-auto"
            disabled={busy || (source.kind === "box" && !!source.blockedReason)}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await postMoveAction({
                  idempotencyKey: key,
                  source: source.kind === "box" ? { kind: "box", containerId: source.id } : { kind: "lot", lotId: source.id, fromLocationId: fromId, qty, qtyUom: unit || undefined },
                  toLocationId: dest.id,
                  reason: reason || undefined,
                });
                // Joins the action's transition: the result and the refreshed page commit together (ADR-043).
                startTransition(() => (r.ok ? setResult(r.result) : setError(r.message)));
              })
            }
          >
            {busy ? "Saving the move…" : "Confirm move"}
          </Button>
          <p className="text-[12px] text-muted">
            Tapping twice or reloading never saves twice. Wrong scan? You can undo your own move for a short time afterwards. <Link href="/inventory/scan" className="text-primary-text hover:underline">Look up instead</Link>
          </p>
        </div>
      )}
    </div>
  );
}
