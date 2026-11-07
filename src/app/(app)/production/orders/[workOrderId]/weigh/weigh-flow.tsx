"use client";
import Decimal from "decimal.js";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, UserCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import type { WeighView } from "@/modules/production";
import { Button, cx, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import { ScanOrPick, type PickVia } from "@/ui/scan-or-pick";
import { Chip } from "@/ui/status";
import { NextApprover } from "@/ui/next-approver";
import { useClientKey } from "@/ui/use-client-key";
import { EquipmentWhy } from "../equipment-why";
import { checkerAfterSave, type NextActors } from "@/lib/next-actors-words";
import {
  askOtherMaterialAction,
  takeAlternativeAction,
  withdrawAskAction,
  checkWeighingAction,
  checkWeighingOwnAction,
  returnWeighingAction,
  stepDoneAction,
  weighAction,
  type FlowActionState,
} from "../flow-actions";

type Card = WeighView["cards"][number];
type Person = { id: string; displayName: string };

const g = (v: Decimal.Value) => fmtQty(v, "g", 1);

/**
 * Weigh screen (S4). Portrait: ingredient chips, the current card, the keypad under it. Landscape
 * (≥ 1024 px): the ingredient list on the left, card and keypad on the right, no scrolling at
 * 1180 × 820. Save sits on the keypad (✓) and next to the field. A marked line asks for the second
 * check right after Save: pick a name, then the checker confirms on a screen addressed to them.
 */
export function WeighFlow(p: {
  batchId: string;
  stepNo: number | null;
  stepDone: boolean;
  canWeigh: boolean;
  /** Why Save is pale and the one button that fixes it (getWeighView.weighBlock; finding 2). */
  block?: { sentence: string; href: string | null; label: string | null } | null;
  lotConfirm: "last4" | "scan" | "none";
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
  passwordRequired: boolean;
  totalWeighed: string;
  totalTarget: string;
  stepBlockers: string[];
  nextHref: string | null;
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
  const firstOpen = Math.max(
    0,
    p.cards.findIndex((c) => !c.done || c.waitingForCheck.length > 0),
  );
  const [idx, setIdx] = useState(firstOpen);
  useEffect(() => setIdx(firstOpen), [firstOpen]);
  const card = p.cards[idx];
  const allDone = p.cards.every(
    (c) => c.done && c.waitingForCheck.length === 0,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <nav
        aria-label="Ingredients"
        className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible"
      >
        {p.cards.map((c, i) => {
          const waiting = c.waitingForCheck.length > 0;
          return (
            <button
              key={c.batchMaterialId}
              type="button"
              onClick={() => setIdx(i)}
              aria-current={i === idx}
              className={cx(
                "flex min-h-[56px] min-w-[150px] shrink-0 items-center gap-2 rounded-[14px] border px-3 text-left text-[15px] lg:min-w-0",
                i === idx
                  ? "border-ring bg-primary-soft"
                  : "border-line bg-surface",
              )}
            >
              {c.done && !waiting ? (
                <CheckCircle2
                  size={20}
                  className="text-[var(--ok-fg)]"
                  aria-label="Weighed"
                />
              ) : waiting ? (
                <UserCheck
                  size={20}
                  className="text-[var(--warn-fg)]"
                  aria-label="Second check needed"
                />
              ) : (
                <Circle
                  size={20}
                  className="text-muted"
                  aria-label="Not weighed"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">
                  {c.materialName}
                </span>
                <span className="block text-[13px] tabular text-muted">
                  {c.done ? g(c.weighed) : `target ${g(c.target)}`}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">
        {allDone ? (
          <WeighSummary {...p} />
        ) : card ? (
          card.waitingForCheck.length > 0 ? (
            <SecondCheck
              key={card.waitingForCheck[0].id}
              batchId={p.batchId}
              card={card}
              weighing={card.waitingForCheck[0]}
              checkers={p.checkers}
              passwordRequired={p.passwordRequired}
              viewer={p.viewer}
              next={p.nextByOperator?.[card.waitingForCheck[0].operatorId ?? ""] ?? null}
            />
          ) : card.done ? (
            <p className="rounded-[20px] border border-line bg-surface p-5 text-[17px]">
              <CheckCircle2
                size={22}
                className="mr-2 inline text-[var(--ok-fg)]"
                aria-hidden
              />
              {card.materialName}: {g(card.weighed)} weighed.
            </p>
          ) : card.waitingForQa ? (
            <WaitingForQa batchId={p.batchId} card={card} />
          ) : (
            <>
              <WeighCard key={card.batchMaterialId} {...p} card={card} />
              <OtherIngredient key={`other-${card.batchMaterialId}`} batchId={p.batchId} card={card} substitutes={p.substitutes} />
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

function WeighCard(p: Parameters<typeof WeighFlow>[0] & { card: Card }) {
  const { card } = p;
  const [state, action] = useInPlaceAction<FlowActionState>(weighAction);
  const form = useRef<HTMLFormElement>(null);
  const [lotIdx, setLotIdx] = useState(0);
  const [lotCode, setLotCode] = useState("");
  const [qty, setQty] = useState("");
  // Owner decision 2026-11-08 (A-SCAN-TYPED-01): the lot on the container is confirmed by scanning its label OR by
  // typing the lot number printed on it (all of it or the last 4), recorded as typed. A tap in the list is not a
  // confirmation (ADR-080 §3, A-SCAN-11). Replaces the "Label damaged? Type the last 4" fallback.
  const [lotVia, setLotVia] = useState<PickVia | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [active, setActive] = useState<"lot" | "qty">("qty");
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
      setScanNote(`This label says ${code}. It is not a lot of ${card.materialName} you may use (expired, stopped, waiting for QA or another ingredient). For another ingredient use "Ask to use something else".`);
    }
  };
  const [scale, setScale] = useState(
    p.scales.find((s) => s.usable)?.code ?? "",
  );
  const lot = pickable[lotIdx];
  const offPlan = !!lot?.offPlan;
  const reasonOk = !offPlan || (!!reason && (reason !== "other" || reasonNote.trim().length >= 3));
  const fe = state?.fieldErrors ?? {};
  const entered = /^\d+(\.\d{1,3})?$/.test(qty) ? new Decimal(qty) : null;
  const total = entered ? entered.plus(card.weighed) : null;
  const tol = !total
    ? null
    : total.lt(card.min)
      ? { kind: "low" as const, by: new Decimal(card.min).minus(total) }
      : total.gt(card.max)
        ? { kind: "high" as const, by: total.minus(card.max) }
        : { kind: "ok" as const, by: new Decimal(0) };
  const lotOk = p.lotConfirm === "none" || lotCode.startsWith("BC:LOT:");
  const canSave =
    p.canWeigh &&
    !!lot &&
    !!entered &&
    lotOk &&
    tol?.kind === "ok" &&
    reasonOk &&
    (!p.requiresScale || !!scale);
  // Owner's screenshots 2026-11-01: a pale, disabled Save says why, right above it (one reason, the first missing thing).
  const whyNot = !p.canWeigh
    ? (p.block?.sentence ?? "You cannot weigh now.")
    : !lot
      ? null
      : !lotOk
        ? "Scan the lot label, or type the lot number, first."
        : !reasonOk
          ? "Tap why you use another lot first."
          : !entered
          ? "Type the weight first."
          : p.requiresScale && !scale
            ? "No scale can be used now. See why above."
            : null;
  return (
    <section
      className="rounded-[20px] border border-line bg-surface p-4 sm:p-5"
      aria-label={`Weigh ${card.materialName}`}
      data-testid="weigh-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-title text-fg">
          {card.materialName}
        </h2>
        {card.needsCheck && <Chip tone="warn">Second check</Chip>}
      </div>
      <p className="mt-1 font-display text-readout leading-none tabular text-fg">
        {g(card.target)}
      </p>
      <p className="mt-1 text-[16px] text-muted">
        OK from {g(card.minShown)} to {g(card.maxShown)}
        {new Decimal(card.weighed).gt(0) ? ` · already ${g(card.weighed)}` : ""}
      </p>
      {card.insteadOf && (
        <p className="mt-2 rounded-[12px] bg-[var(--info-bg,#eef4ff)] p-2 text-[14px]" data-testid="instead-of">Instead of {card.insteadOf.materialName} (for this batch only).</p>
      )}
      {card.proposal && (
        <p className="mt-2 text-[15px] text-fg-2" data-testid="weigh-proposal">
          As taken at Get materials: weigh {card.proposal}.
        </p>
      )}
      {lot ? (
        <div className={cx("mt-3 rounded-[14px] p-3 text-[16px]", offPlan ? "border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)]" : "bg-surface-2")} data-testid="weigh-lot">
          Lot{" "}
          <span className="font-mono text-[20px] font-bold">
            {lot.lotNumber}
          </span>{" "}
          · {lot.place} · {offPlan ? "another lot" : lotIdx === 0 ? "use first" : "also taken"}
          {lot.expiresOn ? ` · expires ${fmtDate(lot.expiresOn)}` : ""}
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
      <form
        ref={form}
        action={action}
        className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <input type="hidden" name="batchId" value={p.batchId} />
        <input
          type="hidden"
          name="batchMaterialId"
          value={card.batchMaterialId}
        />
        <input type="hidden" name="lotId" value={lot?.lotId ?? ""} />
        {offPlan && <input type="hidden" name="offPlanReasonCode" value={reason} />}
        {offPlan && reason === "other" && <input type="hidden" name="offPlanNote" value={reasonNote} />}
        <input type="hidden" name="locationId" value={lot?.locationId ?? ""} />
        <input type="hidden" name="qty" value={qty} />
        <input
          type="hidden"
          name="needsCheck"
          value={card.needsCheck ? "1" : "0"}
        />
        {p.requiresScale && (
          <input type="hidden" name="equipmentRef" value={scale} />
        )}
        <div className="grid gap-3">
          {p.lotConfirm !== "none" && <input type="hidden" name="lotConfirm" value={lotCode} />}
          {p.lotConfirm !== "none" && lotVia && <input type="hidden" name="lotConfirmVia" value={lotVia} />}
          {(
            <div className="grid gap-2" data-testid="lot-scan">
              {lotCode.startsWith("BC:LOT:") ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="inline-flex items-center gap-2 text-[16px] font-semibold text-[var(--ok-fg)]" data-testid="lot-confirmed" data-via={lotVia ?? ""}>
                    <CheckCircle2 size={18} aria-hidden /> {lotVia === "typed" ? "Lot number typed" : lotVia === "tap" ? "Lot chosen" : "Label scanned"}: lot {lotCode.slice(7)}
                  </p>
                  <button type="button" className="min-h-[44px] text-[14px] text-primary-text underline" onClick={() => { setLotCode(""); setLotVia(null); }}>
                    Not this lot
                  </button>
                </div>
              ) : (
                // ADR-098 ScanOrPick: the set-aside lots are listed, but the confirmation READS the container's label:
                // a scan, or the lot number typed off it (A-SCAN-TYPED-01). A tap is not a check (A-SCAN-11; ADR-080 §3).
                <>
                  <ScanOrPick
                    key={`scan-${card.batchMaterialId}-${showOthers ? "all" : "taken"}`}
                    kind="lot"
                    mode="emit"
                    label="Scan the lot label on the container, or type the lot number"
                    hint="Camera, handheld scanner, or the lot number printed on the label (all of it or the last 4)."
                    notListed={`That is not a lot of ${card.materialName} you may use here. Check the label and type it again.`}
                    candidatesLabel={showOthers ? "Taken at Get materials first, then other lots" : "Taken at Get materials"}
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
          )}
          <KeypadField
            id={`qty-${card.batchMaterialId}`}
            label="Weight"
            unit="g"
            large
            value={qty}
            active={active === "qty"}
            onFocus={() => setActive("qty")}
            error={fe.qty ?? null}
            hint={
              tol ? (
                tol.kind === "ok" ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--ok-fg)]">
                    <CheckCircle2 size={16} aria-hidden /> OK
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--bad-fg)]">
                    <AlertTriangle size={16} aria-hidden /> Too{" "}
                    {tol.kind === "low" ? "little" : "much"} by {g(tol.by)}
                  </span>
                )
              ) : undefined
            }
          />
          {tol && tol.kind !== "ok" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="cta"
                size="lg"
                onClick={() => setQty("")}
              >
                Weigh again
              </Button>
              <Link
                href={`${p.moreHref}&line=${card.batchMaterialId}`}
                className="inline-flex min-h-[52px] items-center rounded-full border border-line px-5 text-[15px] text-fg"
              >
                Ask for approval
              </Link>
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
              <SubmitButton
                variant="cta"
                size="lg"
                disabled={!canSave}
                pendingText="Saving…"
                className="w-full"
              >
                Save
              </SubmitButton>
            </div>
          )}
          <FormMessage state={state} />
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">
              More details
            </summary>
            <div className="grid gap-2 pt-1">
              {p.requiresScale && (
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
              )}
              <Link
                href={`${p.moreHref}&line=${card.batchMaterialId}`}
                className="inline-flex min-h-[44px] items-center text-primary-text underline"
              >
                Container weight, split over two lots, undo a weighing
              </Link>
            </div>
          </details>
        </div>
        <Keypad
          value={active === "lot" ? lotCode : qty}
          onChange={(v) =>
            active === "lot" ? setLotCode(v.toUpperCase()) : setQty(v)
          }
          decimal={active === "qty"}
          letters={active === "lot"}
          maxLength={active === "lot" ? 6 : 10}
          // One Save button (owner's screenshots 2026-11-01): the keypad has no ✓ Save; the Save above is the only one.
        />
      </form>
    </section>
  );
}

const firstName = (name: string | null | undefined) => (name ?? "the operator").split(/\s+/)[0];

/** "No, send it back" (re-audit N9): visible, secondary, asks what was wrong; the weighing is voided and weighed again. */
function SendBack({ dispenseRecordId, batchId }: { dispenseRecordId: string; batchId: string }) {
  const [state, action] = useInPlaceAction(returnWeighingAction);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(true)} data-testid="send-back">
        No, send it back
      </Button>
    );
  return (
    <form action={action} className="grid gap-2 rounded-[14px] border border-line p-3" data-testid="send-back-form">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="dispenseRecordId" value={dispenseRecordId} />
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        What was wrong?
        <Input name="reason" required minLength={5} maxLength={300} className="min-h-[52px] text-[16px]" placeholder="For example: wrong lot, scale not zeroed" />
      </label>
      {state?.fieldErrors?.reason && <p className="text-[14px] text-[var(--bad-fg)]">{state.fieldErrors.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary" size="lg" pendingText="Sending back…">
          Send it back
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** UX review S9: after Save on a marked line, pick the checker's name, then a confirm addressed to them (2 taps). */
function SecondCheck({
  batchId,
  card,
  weighing,
  checkers,
  passwordRequired,
  viewer,
  next,
}: {
  batchId: string;
  card: Card;
  weighing: Card["waitingForCheck"][number];
  checkers: Person[];
  passwordRequired: boolean;
  viewer: { userId: string; displayName: string; canCheck: boolean };
  next: NextActors | null;
}) {
  const [state, action] = useInPlaceAction(checkWeighingAction);
  const [ownState, ownAction] = useInPlaceAction(checkWeighingOwnAction);
  const [who, setWho] = useState<Person | null>(null);
  const others = checkers.filter((c) => c.id !== weighing.operatorId);
  // The checker opened this screen on their own phone: one tap in their own name (own session), or
  // "No, send it back" with a reason (re-audit N9; ADR-100 "confirm or send back with a reason").
  if (viewer.canCheck && viewer.userId !== weighing.operatorId)
    return (
      <section className="grid gap-3 rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5" data-testid="own-weigh-check" aria-label={`Check ${firstName(weighing.operator)}'s weighing`}>
        <h2 className="text-title text-fg">Check {firstName(weighing.operator)}&apos;s weighing</h2>
        <p className="text-[17px] text-fg">
          {viewer.displayName}, did you watch {weighing.operator} weigh {g(weighing.qtyG)} of {card.materialName}, lot {weighing.lotNumber}?
        </p>
        <p className="text-[15px] text-muted">You sign with your own account.</p>
        <form action={ownAction} className="grid gap-2">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="dispenseRecordId" value={weighing.id} />
          <SubmitButton variant="cta" size="lg" pendingText="Saving…">
            <UserCheck size={20} aria-hidden /> Yes, I checked it
          </SubmitButton>
          <FormMessage state={ownState} />
        </form>
        <SendBack dispenseRecordId={weighing.id} batchId={batchId} />
      </section>
    );
  return (
    <section
      className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5"
      aria-label="Second check"
      data-testid="second-check"
    >
      {!who ? (
        <>
          <h2 className="flex items-center gap-2 text-title text-fg">
            <UserCheck size={24} aria-hidden /> Second check needed
          </h2>
          <p className="mt-1 text-[16px] text-muted">
            Ask someone to watch you weigh {card.materialName}. They pick their
            name.
          </p>
          {others.length ? (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {others.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="justify-start"
                  onClick={() => setWho(c)}
                >
                  {c.displayName}
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-[16px]">
              No one else here can check. The checker opens this Weigh screen on
              their own phone and confirms it there.
            </p>
          )}
          <NextApprover next={next} className="mt-3 text-[15px] text-fg" />
          <p className="mt-3 text-[13px] text-muted">
            The second check needs a connection.
          </p>
        </>
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="dispenseRecordId" value={weighing.id} />
          <input type="hidden" name="checkerId" value={who.id} />
          <h2 className="text-title text-fg">
            {who.displayName}, you watched {g(weighing.qtyG)} of{" "}
            {card.materialName}, lot {weighing.lotNumber}?
          </h2>
          {passwordRequired && (
            <label className="flex flex-col gap-1 text-[15px] font-medium">
              {who.displayName}&apos;s password
              <Input
                type="password"
                name="checkerPassword"
                autoComplete="off"
                className="min-h-[56px]"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="cta" size="lg" pendingText="Saving…">
              Yes, I checked
            </SubmitButton>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setWho(null)}
            >
              No
            </Button>
          </div>
          <FormMessage state={state} />
        </form>
      )}
    </section>
  );
}

function WeighSummary(p: Parameters<typeof WeighFlow>[0]) {
  const [state, action] = useInPlaceAction(stepDoneAction);
  return (
    <section
      className="rounded-[20px] border border-line bg-surface p-5"
      data-testid="weigh-summary"
    >
      <h2 className="flex items-center gap-2 text-title text-fg">
        <CheckCircle2 size={24} className="text-[var(--ok-fg)]" aria-hidden />{" "}
        {p.cards.length} of {p.cards.length} weighed
      </h2>
      <p className="mt-1 text-[16px] tabular text-muted">
        Total {fmtMass(p.totalWeighed)} of {fmtMass(p.totalTarget)}
      </p>
      {p.stepDone ? (
        p.nextHref && (
          <Link
            href={p.nextHref}
            className="mt-4 inline-flex min-h-[56px] items-center rounded-full bg-cta px-8 text-[17px] font-semibold text-white"
          >
            Next step
          </Link>
        )
      ) : p.stepNo ? (
        <form action={action} className="mt-4 grid gap-2">
          <input type="hidden" name="batchId" value={p.batchId} />
          <input type="hidden" name="stepNo" value={p.stepNo} />
          {p.stepBlockers.length > 0 && (
            <p className="text-[14px] text-[var(--warn-fg)]">
              {p.stepBlockers.join(" ")}
            </p>
          )}
          <div>
            <SubmitButton
              variant="cta"
              size="lg"
              pendingText="Saving…"
              className="min-w-[220px]"
            >
              Step done
            </SubmitButton>
          </div>
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
