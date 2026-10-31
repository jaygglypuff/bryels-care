"use client";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, Boxes, MapPin, RotateCcw } from "lucide-react";
import { Button, Card, Field, Textarea } from "@/ui/core";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { baseToUnitText, fmtFriendly, friendlyUnitFor, toBaseQty } from "@/lib/units";
import { QtyUnitInput } from "@/ui/qty-unit-input";
import { Banner } from "@/ui/status";
import type { MoveResult } from "@/modules/inventory/moves";
import { LOCATION_KIND_WORDS, LotStatusChip } from "@/ui/inventory/bits";
import { lookupSourceAction, postMoveAction, undoMoveAction, type LotMatch, type SourceInfo } from "./actions";

type Loc = { id: string; code: string; name: string; kind: string };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

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

export function MoveFlow({ locations, initialSource, initialDestination, lots = [] }: { locations: Loc[]; initialSource: SourceInfo | null; initialDestination: Loc | null; lots?: PickCandidate[] }) {
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
  const [matches, setMatches] = useState<LotMatch[]>([]);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [busy, start] = useTransition();

  const allowed = useMemo(() => (source ? locations.filter((l) => source.allowedKinds.includes(l.kind)) : locations), [source, locations]);
  const fromLoc = source?.kind === "lot" ? source.locations.find((l) => l.id === fromId) : null;
  const sourceLocationId = source?.kind === "box" ? source.location?.id : fromId;
  const destWrongKind = !!(dest && source && !source.allowedKinds.includes(dest.kind));
  const parsedAmount = source?.kind === "lot" && qty.trim() ? toBaseQty(qty, unit, source.baseUom) : null;
  const moveAmountText = source?.kind === "lot" ? (parsedAmount?.ok ? fmtFriendly(parsedAmount.qtyBase, source.baseUom) : `${qty} ${unit}`) : "";
  const step = !source ? 1 : source.kind === "lot" && (!fromId || !qty) ? 2 : !dest ? 3 : 4;

  const pickSource = (v: string) =>
    start(async () => {
      setError(null);
      const r = await lookupSourceAction(v);
      if (!r.ok) {
        setMatches(r.matches ?? []);
        return setError(r.matches?.length ? null : r.message);
      }
      setMatches([]);
      setSource(r.data);
      if (r.data.kind === "lot") {
        setFromId(r.data.locations[0]?.id ?? "");
        const a = startAmount(r.data);
        setQty(a.qty);
        setUnit(a.unit);
      }
    });

  const reset = () => {
    setMatches([]);
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
        {["What", "How much", "Which shelf", "Confirm"].map((s, i) => (
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
          <div className="space-y-3">
            <ScanOrPick
              mode="emit"
              kind="lot"
              alsoAccept={["container"]}
              id="move-src"
              label="1 · What are you moving?"
              hint="Tap the lot, scan the label of the sack, box or lot, or find the item by name."
              candidates={lots}
              candidatesLabel="Lots with stock here"
              pending={busy}
              onEmit={(v, c) => pickSource(c?.code ? `BC:LOT:${c.code}` : v)}
            />
            {matches.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Matching lots">
                {matches.map((m) => (
                  <li key={m.lotNumber}>
                    <button type="button" onClick={() => pickSource(`BC:LOT:${m.lotNumber}`)} className="flex min-h-[52px] w-full flex-col items-start rounded-[12px] border border-line px-3 py-2 text-left hover:bg-surface-2">
                      <span className="text-[14px] font-semibold">{m.title} <span className="font-mono text-[12px] font-normal text-muted">{m.lotNumber}</span></span>
                      <span className="text-[13px] text-muted">{m.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] text-muted">{source.kind === "box" ? <Boxes size={15} /> : null} {source.kind === "box" ? "Box" : "Lot"}</p>
              <p className="text-[18px] font-semibold">{source.kind === "box" ? <span className="font-mono">{source.number}</span> : source.itemName}</p>
              {source.kind === "box" ? (
                <ul className="mt-1 text-[13px]">
                  {source.contents.map((c) => (
                    <li key={c.lotNumber}>
                      {fmtFriendly(c.qty, c.uom)} {c.itemName} · lot {c.lotNumber} <LotStatusChip status={c.status} />
                    </li>
                  ))}
                  <li className="text-muted">At {source.location?.code ?? "—"}</li>
                </ul>
              ) : (
                <p className="text-[13px]">
                  <span className="font-mono text-[12px] text-muted">{source.lotNumber}</span> <LotStatusChip status={source.status} />
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
            <p className="text-[13px] text-muted">This lot has no stock left on any shelf.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <ScanOrPick
                kind="location"
                id="move-from"
                label="2 · Take it from"
                candidates={source.locations.map((l) => ({ value: l.id, title: l.code, detail: `${fmtFriendly(l.loose, source.baseUom)} not in a box${Number(l.boxed) > 0 ? ` (+${fmtFriendly(l.boxed, source.baseUom)} in boxes)` : ""}`, code: l.code, codes: [l.code] }))}
                value={fromId}
                hideWhenSingle
                onlyCandidates
                search={false}
                onChange={(v) => {
                  if ((v ?? "") === fromId) return;
                  setFromId(v ?? "");
                  const a = startAmount(source, v ?? undefined);
                  setQty(a.qty);
                  setUnit(a.unit);
                }}
              />
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
            <ScanOrPick
              kind="location"
              id="move-dst"
              label="3 · Which shelf does it go to?"
              candidates={allowed
                .filter((l) => l.id !== sourceLocationId)
                .map((l) => ({ value: l.id, title: l.name, detail: `${l.code}${l.kind !== "storage" ? ` · ${LOCATION_KIND_WORDS[l.kind] ?? l.kind}` : ""}`, code: l.code, codes: [l.code] }))}
              candidatesLabel="Shelves it may go to"
              onChange={(v) => {
                if (!v) return;
                const l = locations.find((x) => x.id === v);
                if (l) {
                  setError(null);
                  setDest(l);
                } else setError("That shelf is not in use at this site. Tap one of the shelves above.");
              }}
            />
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
                {dest!.name} is a place for “{(LOCATION_KIND_WORDS[dest!.kind] ?? dest!.kind).toLowerCase()}”. Choose a shelf from the list above, or scan another shelf.
              </Banner>
            </div>
          )}
        </Card>
      )}

      {source && dest && !destWrongKind && (
        <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:rounded-[24px] sm:border-0 sm:p-5 sm:shadow-[var(--shadow-card)]">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            Move <strong>{source.kind === "box" ? <span className="font-mono">{source.number}</span> : `${moveAmountText} of ${source.itemName}`}</strong>
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
