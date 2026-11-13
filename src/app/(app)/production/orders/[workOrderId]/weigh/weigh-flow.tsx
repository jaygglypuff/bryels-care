"use client";
import Decimal from "decimal.js";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, CloudOff, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtDate, fmtQty } from "@/lib/qty";
import type { WeighView } from "@/modules/production";
import { plainNumber } from "@/modules/production/floor-words";
import { syncAgent } from "@/lib/offline/agent";
import { queuedWeighCommand } from "@/lib/offline/weigh-queue";
import { Button, cx, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction, type FormAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import { ScanOrPick, type PickVia } from "@/ui/scan-or-pick";
import { Chip } from "@/ui/status";
import { useClientKey } from "@/ui/use-client-key";
import { EquipmentWhy } from "../equipment-why";
import { checkerAfterSave, waitingForNames, type NextActors } from "@/lib/next-actors-words";
import {
  askOtherMaterialAction,
  takeAlternativeAction,
  withdrawAskAction,
  checkWeighingAction,
  stepDoneAction,
  weighAction,
  type FlowActionState,
} from "../flow-actions";

type Card = WeighView["cards"][number];
type Person = { id: string; displayName: string };

/** Base amount (grams for a gram material) → the unit the operator weighs in (round 5 problem 4). */
const factorOf = (card: Card) => (card.baseUom === "g" && card.unit === "kg" ? 1000 : 1);
const inUnit = (card: Card, base: Decimal.Value) => new Decimal(base || 0).div(factorOf(card));
const show = (card: Card, base: Decimal.Value) => `${plainNumber(inUnit(card, base).toDecimalPlaces(3))} ${card.unit}`;
const firstName = (name: string | null | undefined) => (name ?? "the operator").split(/\s+/)[0];

/**
 * Weigh screen (S4, round 5). Portrait: ingredient chips, the current card, the keypad under the field, Save under
 * the keypad. The weight is typed in the unit the scale shows (kg for 1 kg or more, stored in grams). After Save the
 * operator sees "✓ Saved" and goes on to the next ingredient; a weighing that needs a second check waits on the
 * checker's own list (ADR-130) — a checker standing here may sign with their own password when the company allows it.
 * With no signal, Save keeps what was typed and queues it on this phone when the phone may work offline (B6).
 */
export function WeighFlow(p: {
  batchId: string;
  siteId: string;
  stepNo: number | null;
  stepDone: boolean;
  canWeigh: boolean;
  /** Why Save is pale and the one button that fixes it (getWeighView.weighBlock; finding 2). */
  block?: { sentence: string; href: string | null; label: string | null } | null;
  lotConfirm: "last4" | "scan" | "none";
  /** ADR-126 (`scan.typed_code_counts_as_check`): false hides "type the lot number" (the server refuses it too). */
  typedChecks?: boolean;
  cards: Card[];
  scales: {
    id: string;
    code: string;
    name: string;
    usable: boolean;
    calibrationDueDate: string | null;
    why: string[];
    canRecordCleaning: boolean;
    fixHelp: string[];
  }[];
  requiresScale: boolean;
  checkers: Person[];
  /** ADR-130 `production.sign_off.same_device`: a checker standing here may type their own password. */
  sameDevice: boolean;
  totalWeighed: string;
  totalTarget: string;
  stepBlockers: string[];
  nextHref: string | null;
  /** "Done — go to <next step>" (round 5 problem 10). */
  nextLabel: string | null;
  /** "Other ways to weigh" for one ingredient (container weight, two lots, approval, undo): `${moreHref}&line=<id>`. */
  moreHref: string;
  /** The signed-in person: may they confirm a weighing in their own name (own phone)? */
  viewer: { userId: string; displayName: string; canCheck: boolean };
  /** ADR-104/106: one-tap reasons for another lot, and the ingredients that may be asked for by name. */
  reasons: { code: string; label: string }[];
  substitutes: { id: string; name: string; baseUom: string }[];
  /** Who can check a weighing of each weigher (docs/NEXT_APPROVER.md), by weigher's user id. */
  nextByOperator?: Record<string, NextActors | null>;
}) {
  // Lines saved on this phone while there was no signal (B6): shown as "waiting for signal", not weighed again.
  const [queued, setQueued] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const open = (c: Card) => !c.done && !queued[c.batchMaterialId];
  const firstOpen = Math.max(0, p.cards.findIndex(open));
  const [idx, setIdx] = useState(firstOpen);
  useEffect(() => setIdx(firstOpen), [firstOpen]);
  const card = p.cards[idx];
  const allDone = p.cards.every((c) => !open(c));
  const waiting = p.cards.flatMap((c) => c.waitingForCheck);
  const nextOpen = p.cards.findIndex((c, i) => i !== idx && open(c));
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <nav aria-label="Ingredients" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {p.cards.map((c, i) => {
          const w = c.waitingForCheck.length > 0;
          const q = !!queued[c.batchMaterialId];
          return (
            <button
              key={c.batchMaterialId}
              type="button"
              onClick={() => setIdx(i)}
              aria-current={i === idx}
              className={cx("flex min-h-[56px] min-w-[150px] shrink-0 items-center gap-2 rounded-[14px] border px-3 text-left text-[15px] lg:min-w-0", i === idx ? "border-ring bg-primary-soft" : "border-line bg-surface")}
            >
              {q ? (
                <CloudOff size={20} className="text-[var(--warn-fg)]" aria-label="Saved on this phone" />
              ) : c.done && !w ? (
                <CheckCircle2 size={20} className="text-[var(--ok-fg)]" aria-label="Weighed" />
              ) : w ? (
                <UserCheck size={20} className="text-[var(--warn-fg)]" aria-label="Waiting for the check" />
              ) : (
                <Circle size={20} className="text-muted" aria-label="Not weighed" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{c.materialName}</span>
                <span className="block text-[13px] tabular text-muted">{c.done ? show(c, c.weighed) : q ? "waiting for signal" : `weigh ${show(c, c.target)}`}</span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="grid min-w-0 content-start gap-3">
        {saved && (
          <p role="status" className="flex items-start gap-2 rounded-[14px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] p-3 text-[17px] font-semibold text-[var(--ok-fg)]" data-testid="weigh-saved">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden /> {saved}
          </p>
        )}
        {allDone ? (
          <WeighSummary {...p} queuedCount={Object.keys(queued).length} waitingCount={waiting.length} />
        ) : card ? (
          queued[card.batchMaterialId] ? (
            <p className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] p-5 text-[17px]" data-testid="weigh-queued">
              <CloudOff size={20} className="mr-2 inline" aria-hidden />
              {queued[card.batchMaterialId]}
            </p>
          ) : card.done ? (
            <DoneCard {...p} card={card} onNext={nextOpen >= 0 ? () => setIdx(nextOpen) : null} nextName={nextOpen >= 0 ? p.cards[nextOpen].materialName : null} />
          ) : card.waitingForQa ? (
            <WaitingForQa batchId={p.batchId} card={card} />
          ) : (
            <>
              <WeighCard
                key={card.batchMaterialId}
                {...p}
                card={card}
                onSaved={(msg) => setSaved(msg)}
                onQueued={(msg) => {
                  setQueued((q) => ({ ...q, [card.batchMaterialId]: msg }));
                  setSaved(msg);
                }}
              />
              <OtherIngredient key={`other-${card.batchMaterialId}`} batchId={p.batchId} card={card} substitutes={p.substitutes} />
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

/** True when the Save failed because the phone has no signal (the server action could not be reached). */
function noSignal(e: unknown) {
  return (typeof navigator !== "undefined" && !navigator.onLine) || e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message));
}

function WeighCard(p: Parameters<typeof WeighFlow>[0] & { card: Card; onSaved: (msg: string) => void; onQueued: (msg: string) => void }) {
  const { card } = p;
  const [lotIdx, setLotIdx] = useState(0);
  const [lotCode, setLotCode] = useState("");
  const [qty, setQty] = useState("");
  // Owner decision 2026-11-08 (A-SCAN-TYPED-01): the lot on the container is confirmed by scanning its label OR by
  // typing the lot number printed on it (all of it or the last 4), recorded as typed. A tap in the list is not a
  // confirmation (ADR-080 §3, A-SCAN-11).
  const [lotVia, setLotVia] = useState<PickVia | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // ADR-106 §3 one way to pick: the lots taken at Get materials first; other allowed lots only under "Use another lot".
  const [showOthers, setShowOthers] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const pickable = [
    ...card.lots.map((l) => ({ lotId: l.lotId, lotNumber: l.lotNumber, locationId: l.locationId, place: l.locationName || l.locationCode, expiresOn: l.expiresOn, qty: l.qty, offPlan: false })),
    ...card.otherLots.map((o) => ({ lotId: o.lotId, lotNumber: o.lotNumber, locationId: o.locationId, place: o.locationName || o.locationCode, expiresOn: o.expiresOn, qty: o.free, offPlan: true, useFirst: o.useFirst })),
  ];
  const takenNumbers = [...new Set(card.lots.map((l) => l.lotNumber))];
  const onScan = (raw: string, via: PickVia) => {
    const code = raw.trim().toUpperCase().replace(/^BC:LOT:/, "");
    const alnum = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const i = pickable.findIndex((l) => alnum(l.lotNumber) === alnum(code));
    if (i >= 0) {
      setLotIdx(i);
      setLotCode(`BC:LOT:${pickable[i].lotNumber}`);
      setLotVia(via);
      setScanNote(null);
      if (pickable[i].offPlan) setShowOthers(true);
    } else {
      setLotCode("");
      const want = pickable[lotIdx]?.lotNumber;
      setScanNote(`That label is not a lot of ${card.materialName} you may use here.${want ? ` Take lot …${want.slice(-4)} (${pickable[lotIdx].place}).` : ""} For another ingredient use "Ask to use something else".`);
    }
  };
  const [scale, setScale] = useState(p.scales.find((s) => s.usable)?.code ?? "");
  const lot = pickable[lotIdx];
  const offPlan = !!lot?.offPlan;
  const reasonOk = !offPlan || (!!reason && (reason !== "other" || reasonNote.trim().length >= 3));
  // Typed in the weighing unit (kg or g), at most gram resolution; compared in the base unit like the server.
  const entered = /^\d+(\.\d{1,3})?$/.test(qty) ? new Decimal(qty) : null;
  const enteredBase = entered ? entered.mul(factorOf(card)) : null;
  const total = enteredBase ? enteredBase.plus(card.weighed) : null;
  const tol = !total
    ? null
    : total.lt(card.min)
      ? { kind: "low" as const, by: new Decimal(card.min).minus(total) }
      : total.gt(card.max)
        ? { kind: "high" as const, by: total.minus(card.max) }
        : { kind: "ok" as const, by: new Decimal(0) };
  // While the first digits are typed the amount is always "too little": say so only once it could be a weight.
  const typingStill = tol?.kind === "low" && entered !== null && qty.length < String(inUnit(card, card.min).toFixed(0)).length;
  const lotOk = p.lotConfirm === "none" || lotCode.startsWith("BC:LOT:");
  const canSave = p.canWeigh && !!lot && !!entered && lotOk && tol?.kind === "ok" && reasonOk && (!p.requiresScale || !!scale);
  const whyNot = !p.canWeigh
    ? (p.block?.sentence ?? "You cannot weigh now.")
    : !lot
      ? null
      : !lotOk
        ? "Scan the lot label, or type its last 4 numbers, first."
        : !reasonOk
          ? "Tap why you use another lot first."
          : !entered
            ? "Type the weight first."
            : p.requiresScale && !scale
              ? "No scale can be used now. See why above."
              : null;
  // B6: no signal → queue on this phone (when it may work offline), never a full-page error; typed values stay.
  const offlineAware: FormAction<FlowActionState> = async (prev, fd) => {
    const queue = async (): Promise<FlowActionState> => {
      if (offPlan) return { ok: false, message: "No signal. What you typed is kept here. Tap Save again when you have signal." };
      try {
        await syncAgent().enqueue(
          queuedWeighCommand({ siteId: p.siteId, batchId: p.batchId, batchMaterialId: card.batchMaterialId, materialName: card.materialName, qty, unit: card.unit, lotCode, lotNumber: lot?.lotNumber ?? null, lotVia, locationId: lot?.locationId ?? null, requiresScale: !!p.requiresScale, scale }),
        );
        const msg = `${card.materialName}: saved on this phone. It will send when you have signal.`;
        p.onQueued(msg);
        return { ok: true, message: msg };
      } catch {
        return { ok: false, message: "No signal. What you typed is kept here. Tap Save again when you have signal. If it keeps happening, call your supervisor." };
      }
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
    try {
      const r = await weighAction(prev, fd);
      if (r?.ok) p.onSaved(`Saved: ${card.materialName} ${qty} ${card.unit}.${card.needsCheck ? " It waits for the second check." : ""}`);
      return r;
    } catch (e) {
      if (noSignal(e)) return queue();
      throw e;
    }
  };
  const [state, action] = useInPlaceAction<FlowActionState>(offlineAware);
  const fe = state?.fieldErrors ?? {};
  const last4 = lot ? lot.lotNumber.replace(/[^A-Za-z0-9]/g, "").slice(-4) : "";
  return (
    <section className="rounded-[20px] border border-line bg-surface p-4 sm:p-5" aria-label={`Weigh ${card.materialName}`} data-testid="weigh-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-title text-fg">{card.materialName}</h2>
        {card.needsCheck && <Chip tone="warn">Second check</Chip>}
      </div>
      <p className="mt-1 font-display text-readout leading-none tabular text-fg" data-testid="weigh-target">
        {show(card, card.target)}
      </p>
      <p className="mt-1 text-[16px] text-muted">
        OK from {show(card, card.minShown)} to {show(card, card.maxShown)}
        {new Decimal(card.weighed).gt(0) ? ` · already ${show(card, card.weighed)}` : ""}
      </p>
      {card.insteadOf && (
        <p className="mt-2 rounded-[12px] bg-[var(--info-bg,#eef4ff)] p-2 text-[14px]" data-testid="instead-of">Instead of {card.insteadOf.materialName} (for this batch only).</p>
      )}
      {/* Round 5 problem 4: the lot is shown ONCE: what to take and where, then the one way to confirm it. */}
      {lot ? (
        <div className={cx("mt-3 rounded-[14px] p-3 text-[16px]", offPlan ? "border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)]" : "bg-surface-2")} data-testid="weigh-lot">
          <p>
            Take lot <span className="font-mono text-[20px] font-bold">…{last4}</span> · {lot.place}
            {lot.expiresOn ? ` · expires ${fmtDate(lot.expiresOn)}` : ""}
          </p>
          <p className="text-[13px] text-muted">
            Full number {lot.lotNumber}
            {offPlan ? " · another lot" : lotIdx === 0 ? (card.lots.length > 1 ? " · use this one first" : "") : " · also taken"}
          </p>
          {offPlan && (
            <div className="mt-2 grid gap-2" data-testid="off-plan">
              <p className="text-[15px] font-semibold text-[var(--warn-fg)]">
                This is not the lot you took at Get materials{takenNumbers.length ? ` (${takenNumbers.join(", ")})` : ""}. You can continue — QA will see a note.
              </p>
              <p className="text-[14px]">Why?</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why another lot">
                {p.reasons.map((r) => (
                  <button key={r.code} type="button" role="radio" aria-checked={reason === r.code} onClick={() => setReason(r.code)} className={cx("min-h-[48px] rounded-full border px-4 text-[15px]", reason === r.code ? "border-ring bg-primary-soft font-semibold" : "border-line bg-surface")}>
                    {r.label}
                  </button>
                ))}
              </div>
              {reason === "other" && <Input aria-label="Write the reason" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="A few words" className="min-h-[48px]" />}
              {fe.offPlanReasonCode && <p className="text-[14px] text-[var(--bad-fg)]">{fe.offPlanReasonCode}</p>}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-[14px] border-2 border-[var(--bad-bd)] bg-[var(--bad-bg)] p-3 text-[16px] font-semibold text-[var(--bad-fg)]">
          <AlertTriangle size={18} className="mr-1 inline" aria-hidden />
          No usable lot of {card.materialName} here. Ask QA or the storekeeper.
        </p>
      )}
      {card.lotChanges.length > 0 && (
        <ul className="mt-2 grid gap-1 text-[13px] text-fg-2" data-testid="lot-changes">
          {card.lotChanges.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {p.requiresScale && !scale && (
        <div className="mt-3">
          <EquipmentWhy items={p.scales} title="No scale can be used now" />
        </div>
      )}
      <form action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="batchId" value={p.batchId} />
        <input type="hidden" name="batchMaterialId" value={card.batchMaterialId} />
        <input type="hidden" name="lotId" value={lot?.lotId ?? ""} />
        {offPlan && <input type="hidden" name="offPlanReasonCode" value={reason} />}
        {offPlan && reason === "other" && <input type="hidden" name="offPlanNote" value={reasonNote} />}
        <input type="hidden" name="locationId" value={lot?.locationId ?? ""} />
        <input type="hidden" name="qty" value={qty} />
        <input type="hidden" name="uom" value={card.unit} />
        <input type="hidden" name="needsCheck" value={card.needsCheck ? "1" : "0"} />
        {p.requiresScale && <input type="hidden" name="equipmentRef" value={scale} />}
        {p.lotConfirm !== "none" && <input type="hidden" name="lotConfirm" value={lotCode} />}
        {p.lotConfirm !== "none" && lotVia && <input type="hidden" name="lotConfirmVia" value={lotVia} />}
        <div className="grid gap-2" data-testid="lot-scan">
          {lotCode.startsWith("BC:LOT:") ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="inline-flex items-center gap-2 text-[16px] font-semibold text-[var(--ok-fg)]" data-testid="lot-confirmed" data-via={lotVia ?? ""}>
                <CheckCircle2 size={18} aria-hidden /> {lotVia === "typed" ? "Lot number typed" : lotVia === "tap" ? "Lot chosen" : "Label scanned"}: lot …{lotCode.slice(7).replace(/[^A-Za-z0-9]/g, "").slice(-4)} ✓
              </p>
              <button type="button" className="min-h-[44px] text-[14px] text-primary-text underline" onClick={() => { setLotCode(""); setLotVia(null); }}>
                Not this lot
              </button>
            </div>
          ) : (
            // ADR-098 ScanOrPick: the confirmation READS the container's label: a scan, or the number typed off it
            // (A-SCAN-TYPED-01). A tap is not a check (A-SCAN-11; ADR-080 §3). The list shows only for "Use another lot".
            <>
              <ScanOrPick
                key={`scan-${card.batchMaterialId}-${showOthers ? "all" : "taken"}`}
                kind="lot"
                mode="emit"
                label={p.typedChecks === false && p.lotConfirm !== "none" ? "Scan the lot label on the container" : "Scan the label on the container, or type its last 4 numbers"}
                allowTyping={p.typedChecks !== false || p.lotConfirm === "none"}
                notListed={`That is not a lot of ${card.materialName} you may use here.${lot ? ` Take lot …${last4} (${lot.place}).` : ""}`}
                candidatesLabel="Other lots you may use"
                showCandidates={showOthers}
                candidates={pickable
                  .filter((l) => showOthers || !l.offPlan)
                  .map((l) => ({ value: l.lotId, title: card.materialName, detail: `lot ${l.lotNumber} · ${l.place}${l.expiresOn ? ` · expires ${fmtDate(l.expiresOn)}` : ""}`, code: l.lotNumber, codes: [l.lotNumber], badge: l.offPlan ? ("useFirst" in l && l.useFirst ? "another lot · use first" : "another lot") : "taken", badgeTone: l.offPlan ? ("warn" as const) : ("ok" as const) }))}
                allowTap={p.lotConfirm === "none"}
                onlyCandidates
                search={false}
                onEmit={(value, c, via) => onScan(c?.code ?? value, via)}
              />
              {!showOthers && card.otherLots.length > 0 && (
                <button type="button" className="min-h-[44px] text-left text-[15px] text-primary-text underline" onClick={() => setShowOthers(true)} data-testid="use-another-lot">
                  Use another lot
                </button>
              )}
            </>
          )}
          {scanNote && <p className="text-[14px] text-[var(--bad-fg)]">{scanNote}</p>}
          {fe.lotConfirm && <p className="text-[14px] text-[var(--bad-fg)]">{fe.lotConfirm}</p>}
        </div>
        <KeypadField
          id={`qty-${card.batchMaterialId}`}
          label={`Weight on the scale (${card.unit})`}
          unit={card.unit}
          large
          value={qty}
          // ADR-135: a keyboard, USB scale or scanner types here too; Enter = Save (only when Save could be pressed).
          onChange={setQty}
          decimal
          maxLength={10}
          readOnly={!p.canWeigh}
          // The cursor goes to the weight once the lot is confirmed, so a scale's numbers land here (before that, a
          // scanner burst must reach the lot scan, which listens only while no box has the cursor).
          autoFocus={p.canWeigh && lotOk}
          onEnter={(el) => {
            if (canSave) el.form?.requestSubmit();
          }}
          active
          onFocus={() => undefined}
          error={fe.qty ?? null}
          hint={
            tol && !typingStill ? (
              tol.kind === "ok" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--ok-fg)]">
                  <CheckCircle2 size={16} aria-hidden /> OK
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--bad-fg)]">
                  <AlertTriangle size={16} aria-hidden /> Too {tol.kind === "low" ? "little" : "much"} by {show(card, tol.by)}
                </span>
              )
            ) : undefined
          }
        />
        {/* Round 5 problem 4: the keypad right under the field, Save under the keypad (no Save in mid-entry). */}
        <Keypad value={qty} onChange={setQty} decimal maxLength={10} />
        {tol && tol.kind !== "ok" && !typingStill ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="cta" size="lg" onClick={() => setQty("")}>
              Weigh again
            </Button>
            <a href={`${p.moreHref}&line=${card.batchMaterialId}`} className="inline-flex min-h-[52px] items-center rounded-full border border-line px-5 text-[15px] text-fg">
              Ask for approval
            </a>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {!canSave && whyNot && (
              <p className="text-[15px] font-medium text-fg-2" role="status" data-testid="save-why">
                {whyNot}
              </p>
            )}
            {!p.canWeigh && p.block?.href && p.block.label && (
              <Link href={p.block.href} className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-line px-5 text-[16px] font-medium text-fg" data-testid="weigh-block-fix">
                {p.block.label}
              </Link>
            )}
            {p.canWeigh && card.needsCheck && p.nextByOperator?.[p.viewer.userId] && (
              <p className="text-[14px] text-fg-2" data-testid="weigh-next-checker">
                {checkerAfterSave(p.nextByOperator[p.viewer.userId]!)}
              </p>
            )}
            <SubmitButton variant="cta" size="lg" disabled={!canSave} pendingText="Saving…" className="w-full">
              Save
            </SubmitButton>
          </div>
        )}
        <FormMessage state={state} />
        {/* Round 5 problem 4: the partial-container case is a visible link, not hidden under More details. */}
        <Link href={`${p.moreHref}&line=${card.batchMaterialId}`} className="inline-flex min-h-[44px] items-center text-[15px] text-primary-text underline" data-testid="two-lots">
          Container almost empty? Use two lots
        </Link>
        {p.requiresScale && (
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">Change the scale</summary>
            <div className="grid gap-2 pt-1">
              <ScanOrPick
                kind="equipment"
                id={`weigh-scale-${card.batchMaterialId}`}
                label="Scale"
                submit="code"
                onlyCandidates
                candidatesLabel="Scales at this site"
                value={scale || null}
                onChange={(v) => setScale(v ?? "")}
                candidates={p.scales.map((s) => ({
                  value: s.id,
                  title: s.name,
                  detail: `${s.code}${s.calibrationDueDate ? ` · check due ${fmtDate(s.calibrationDueDate)}` : ""}`,
                  code: s.code,
                  codes: [s.code],
                  disabledReason: s.usable ? undefined : "cannot be used",
                }))}
              />
            </div>
          </details>
        )}
      </form>
    </section>
  );
}

/**
 * A weighed line. Waiting for the second check (ADR-130): the checker does it on their own phone (their list); a
 * checker standing here may sign with their OWN password when the company allows it. A name alone never signs.
 */
function DoneCard(p: Parameters<typeof WeighFlow>[0] & { card: Card; onNext: (() => void) | null; nextName: string | null }) {
  const { card } = p;
  const w = card.waitingForCheck[0] ?? null;
  const next = w ? (p.nextByOperator?.[w.operatorId ?? ""] ?? null) : null;
  const names = next ? waitingForNames(next) : null;
  const iAmChecker = !!w && p.viewer.canCheck && p.viewer.userId !== w.operatorId;
  return (
    <section className={cx("grid gap-3 rounded-[20px] border bg-surface p-5", w ? "border-2 border-[var(--warn-bd)]" : "border-line")} data-testid={w ? "second-check" : "weigh-done"}>
      <p className="text-[18px] font-semibold text-fg">
        <CheckCircle2 size={22} className="mr-2 inline text-[var(--ok-fg)]" aria-hidden />
        {card.materialName}: {show(card, card.weighed)} weighed{w ? ` by ${firstName(w.operator)}` : ""}.
      </p>
      {w && iAmChecker && (
        <div className="grid gap-2" data-testid="own-weigh-check">
          <p className="text-[16px]">This weighing waits for your check.</p>
          <Link href="/production/checks" className="inline-flex min-h-[56px] items-center justify-center rounded-full bg-cta px-6 text-[17px] font-semibold text-white">
            Open my list: Waiting for you to check
          </Link>
        </div>
      )}
      {w && !iAmChecker && (
        <>
          <p className="text-[16px] text-fg" data-testid="check-on-own-phone">
            <UserCheck size={18} className="mr-1 inline" aria-hidden />
            {names ? `${names} ${/\d+ others$/.test(names) ? "check" : "checks"} it on their own phone.` : "A second person checks it on their own phone."} It is on their list &quot;Waiting for you to check&quot;.
          </p>
          {p.sameDevice && <CheckHere batchId={p.batchId} weighing={w} materialName={card.materialName} amount={show(card, w.qtyG)} checkers={p.checkers.filter((c) => c.id !== w.operatorId)} />}
        </>
      )}
      {p.onNext && (
        <Button type="button" variant="cta" size="lg" className="w-full" onClick={p.onNext} data-testid="weigh-next-ingredient">
          Weigh the next ingredient{p.nextName ? `: ${p.nextName}` : ""}
        </Button>
      )}
    </section>
  );
}

/** ADR-130: the checker is standing here and signs on this phone with their OWN password (never a name alone). */
function CheckHere({ batchId, weighing, materialName, amount, checkers }: { batchId: string; weighing: Card["waitingForCheck"][number]; materialName: string; amount: string; checkers: Person[] }) {
  const [state, action] = useInPlaceAction(checkWeighingAction);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  if (checkers.length === 0) return null;
  if (!open)
    return (
      <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(true)} data-testid="check-here">
        The checker is here: sign on this phone
      </Button>
    );
  return (
    <form action={action} className="grid gap-3 rounded-[14px] bg-surface-2 p-3" data-testid="check-here-form">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="dispenseRecordId" value={weighing.id} />
      <input type="hidden" name="checkerId" value={who?.id ?? ""} />
      <p className="text-[16px] font-semibold">Who checks?</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {checkers.map((c) => (
          <button key={c.id} type="button" aria-pressed={who?.id === c.id} onClick={() => setWho(c)} className={cx("min-h-[52px] rounded-full border px-4 text-left text-[16px]", who?.id === c.id ? "border-ring bg-primary-soft font-semibold" : "border-line bg-surface")}>
            {c.displayName}
          </button>
        ))}
      </div>
      {who && (
        <>
          <p className="text-[16px]">
            {firstName(who.displayName)}, look at the scale: {amount} of {materialName}, lot …{weighing.lotNumber.replace(/[^A-Za-z0-9]/g, "").slice(-4)}. Correct?
          </p>
          <label className="flex flex-col gap-1 text-[15px] font-medium">
            {firstName(who.displayName)} types their own password
            <Input type="password" name="checkerPassword" autoComplete="off" required className="min-h-[56px]" />
          </label>
          {state?.fieldErrors?.checkerPassword && <p className="text-[14px] text-[var(--bad-fg)]">{state.fieldErrors.checkerPassword}</p>}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="cta" size="lg" pendingText="Saving…" disabled={!who}>
          Yes, correct
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={() => { setOpen(false); setWho(null); }}>
          Cancel
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

function WeighSummary(p: Parameters<typeof WeighFlow>[0] & { queuedCount: number; waitingCount: number }) {
  const [state, action] = useInPlaceAction(stepDoneAction);
  return (
    <section className="rounded-[20px] border border-line bg-surface p-5" data-testid="weigh-summary">
      <h2 className="flex items-center gap-2 text-title text-fg">
        <CheckCircle2 size={24} className="text-[var(--ok-fg)]" aria-hidden /> {p.cards.length - p.queuedCount} of {p.cards.length} weighed
      </h2>
      <p className="mt-1 text-[16px] tabular text-muted">
        Total {fmtQty(new Decimal(p.totalWeighed).div(1000), "kg", 2)} of {fmtQty(new Decimal(p.totalTarget).div(1000), "kg", 2)}
      </p>
      {p.queuedCount > 0 && <p className="mt-2 text-[16px] text-[var(--warn-fg)]">{p.queuedCount === 1 ? "1 weighing is" : `${p.queuedCount} weighings are`} saved on this phone and will send when you have signal.</p>}
      {p.waitingCount > 0 && (
        <p className="mt-2 text-[16px] text-fg" data-testid="weigh-waiting-checks">
          <UserCheck size={18} className="mr-1 inline" aria-hidden />
          {p.waitingCount === 1 ? "1 weighing waits" : `${p.waitingCount} weighings wait`} for the second check on the checker&apos;s phone.
        </p>
      )}
      {p.stepDone ? (
        p.nextHref && (
          <Link href={p.nextHref} className="mt-4 inline-flex min-h-[56px] w-full items-center justify-center rounded-full bg-cta px-8 text-[17px] font-semibold text-white" data-testid="weigh-next-step">
            {p.nextLabel ?? "Next step"}
          </Link>
        )
      ) : p.stepNo ? (
        <form action={action} className="mt-4 grid gap-2">
          <input type="hidden" name="batchId" value={p.batchId} />
          <input type="hidden" name="stepNo" value={p.stepNo} />
          {p.stepBlockers.length > 0 && <p className="text-[15px] text-[var(--warn-fg)]">{p.stepBlockers.join(" ")}</p>}
          <SubmitButton variant="cta" size="lg" pendingText="Saving…" className="w-full">
            Step done
          </SubmitButton>
          <FormMessage state={state} />
        </form>
      ) : null}
    </section>
  );
}

/** ADR-104 §1b: the line waits for QA's yes to another ingredient ("Waiting for QA (Nina) to say yes"). */
function WaitingForQa({ batchId, card }: { batchId: string; card: Card }) {
  const w = card.waitingForQa!;
  const [state, action] = useInPlaceAction(withdrawAskAction);
  return (
    <section className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] p-4 sm:p-5" data-testid="waiting-for-qa">
      <h2 className="text-title text-fg">{card.materialName}</h2>
      <p className="mt-2 text-[18px] font-semibold">Waiting for QA{w.qaNames ? ` (${w.qaNames})` : ""} to say yes</p>
      <p className="mt-1 text-[16px]">
        {w.mine ? "You" : w.by} asked to use {fmtQty(w.qty, w.uom, 1)} of {w.substituteName} instead. Why: {w.reason}
      </p>
      <p className="mt-1 text-[15px] text-fg-2">Weigh the other ingredients meanwhile. This card opens again when QA decides.</p>
      {w.mine && (
        <form action={action} className="mt-3">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="requestId" value={w.requestId} />
          <SubmitButton variant="secondary" size="lg" pendingText="Taking back…">
            Take the request back
          </SubmitButton>
          <FormMessage state={state} />
        </form>
      )}
    </section>
  );
}

/** ADR-104 §1b: another ingredient — the recipe's approved alternative, or ask QA (never decided on the floor alone). */
function OtherIngredient({ batchId, card, substitutes }: { batchId: string; card: Card; substitutes: { id: string; name: string; baseUom: string }[] }) {
  const [altState, altAction] = useInPlaceAction(takeAlternativeAction);
  const [askState, askAction] = useInPlaceAction(askOtherMaterialAction);
  const [open, setOpen] = useState(false);
  // Made after hydration: a key made during render differed between the server HTML and the browser (ADR-125).
  const key = useClientKey();
  if (!card.alternatives.length && !card.canAskOther && !card.refusedByQa) return null;
  const fe = askState?.fieldErrors ?? {};
  return (
    <section className="mt-3 rounded-[20px] border border-line bg-surface p-4" data-testid="other-ingredient">
      <h3 className="text-[17px] font-semibold">No {card.materialName}? Use another ingredient</h3>
      {card.refusedByQa && (
        <p className="mt-1 text-[14px] text-[var(--bad-fg)]">
          QA said no to {card.refusedByQa.substituteName}
          {card.refusedByQa.note ? `: ${card.refusedByQa.note}` : "."}
        </p>
      )}
      {card.alternatives.length > 0 && (
        <div className="mt-2 grid gap-2">
          <p className="text-[14px] text-fg-2">The recipe allows:</p>
          {card.alternatives.map((a) => (
            <form key={a.id} action={altAction}>
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="batchMaterialId" value={card.batchMaterialId} />
              <input type="hidden" name="alternativeId" value={a.id} />
              {key && <input type="hidden" name="idempotencyKey" value={`${key}-${a.id}`} />}
              <SubmitButton variant="secondary" size="lg" pendingText="Changing…" className="w-full justify-start">
                Use the approved alternative: {a.materialName} ({fmtQty(a.qty, a.baseUom, 1)})
              </SubmitButton>
            </form>
          ))}
          <FormMessage state={altState} />
        </div>
      )}
      {card.canAskOther && !open && (
        <Button type="button" variant="secondary" size="lg" className="mt-2" onClick={() => setOpen(true)} data-testid="ask-other">
          Ask to use something else
        </Button>
      )}
      {card.canAskOther && open && (
        <form action={askAction} className="mt-2 grid gap-2" data-testid="ask-other-form">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="batchMaterialId" value={card.batchMaterialId} />
          {key && <input type="hidden" name="idempotencyKey" value={`${key}-ask`} />}
          <p className="text-[14px] text-fg-2">QA must say yes first. It is for this batch only.</p>
          <label className="grid gap-1 text-[15px]">
            What do you want to use?
            <Select name="substituteMaterialId" defaultValue="" className="min-h-[48px]">
              <option value="">Choose by name…</option>
              {substitutes
                .filter((m) => m.name !== card.materialName)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
            {fe.substituteMaterialId && <span className="text-[13px] text-[var(--bad-fg)]">{fe.substituteMaterialId}</span>}
          </label>
          <label className="grid gap-1 text-[15px]">
            How much ({card.baseUom})
            <Input name="qty" inputMode="decimal" defaultValue={card.target} className="min-h-[48px]" />
            {fe.qty && <span className="text-[13px] text-[var(--bad-fg)]">{fe.qty}</span>}
          </label>
          <label className="grid gap-1 text-[15px]">
            Why
            <Input name="reason" placeholder="For example: no coconut oil left at the site" className="min-h-[48px]" />
            {fe.reason && <span className="text-[13px] text-[var(--bad-fg)]">{fe.reason}</span>}
          </label>
          <SubmitButton variant="cta" size="lg" pendingText="Sending…">
            Ask QA
          </SubmitButton>
          <FormMessage state={askState} />
        </form>
      )}
    </section>
  );
}
