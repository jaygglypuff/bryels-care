"use client";
import Decimal from "decimal.js";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, Circle, UserCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import type { WeighView } from "@/modules/production";
import { Button, cx, Input, Select } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import { Scanner } from "@/ui/scanner";
import { Chip } from "@/ui/status";
import {
  checkWeighingAction,
  checkWeighingOwnAction,
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
  lotConfirm: "last4" | "scan" | "none";
  cards: Card[];
  scales: {
    id: string;
    code: string;
    name: string;
    usable: boolean;
    calibrationDueDate: string | null;
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
          ) : (
            <WeighCard key={card.batchMaterialId} {...p} card={card} />
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
  // UX audit 2026-10-31 item 5: the label is scanned with the camera (or a scanner); typing the last 4
  // stays only as the fallback for a damaged label (the lot confirmation of ADR-080 §3 is kept).
  const [typeLast4, setTypeLast4] = useState(false);
  const [camera, setCamera] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [active, setActive] = useState<"lot" | "qty">("qty");
  const onScan = (raw: string) => {
    const code = raw.trim().toUpperCase().replace(/^BC:LOT:/, "");
    const alnum = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const i = card.lots.findIndex((l) => alnum(l.lotNumber) === alnum(code));
    if (i >= 0) {
      setLotIdx(i);
      setLotCode(`BC:LOT:${card.lots[i].lotNumber}`);
      setScanNote(null);
      setCamera(false);
    } else {
      setLotCode("");
      setScanNote(`This label says ${code}. Take a lot from the list for ${card.materialName}.`);
    }
  };
  const [scale, setScale] = useState(
    p.scales.find((s) => s.usable)?.code ?? "",
  );
  const lot = card.lots[lotIdx];
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
  const lotOk =
    p.lotConfirm === "none" ||
    (p.lotConfirm === "last4"
      ? lotCode.length >= 4
      : lotCode.trim().length > 0);
  const canSave =
    p.canWeigh &&
    !!lot &&
    !!entered &&
    lotOk &&
    tol?.kind === "ok" &&
    (!p.requiresScale || !!scale);
  const save = () => form.current?.requestSubmit();
  return (
    <section
      className="rounded-[20px] border border-line bg-surface p-4 sm:p-5"
      aria-label={`Weigh ${card.materialName}`}
      data-testid="weigh-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[24px] font-semibold text-fg">
          {card.materialName}
        </h2>
        {card.needsCheck && <Chip tone="warn">Second check</Chip>}
      </div>
      <p className="mt-1 font-display text-[40px] font-semibold leading-none tabular text-fg sm:text-[44px]">
        {g(card.target)}
      </p>
      <p className="mt-1 text-[16px] text-muted">
        OK from {g(card.min)} to {g(card.max)}
        {new Decimal(card.weighed).gt(0) ? ` · already ${g(card.weighed)}` : ""}
      </p>
      {lot ? (
        <div className="mt-3 rounded-[14px] bg-surface-2 p-3 text-[16px]">
          Lot{" "}
          <span className="font-mono text-[20px] font-bold">
            {lot.lotNumber}
          </span>{" "}
          · {lot.locationName || lot.locationCode} ·{" "}
          {lotIdx === 0 ? "use first" : "another lot"}
          {lot.expiresOn ? ` · expires ${fmtDate(lot.expiresOn)}` : ""}
          {card.lots.length > 1 && (
            <label className="mt-2 block text-[14px] text-muted">
              Use another lot
              <Select
                value={String(lotIdx)}
                onChange={(e) => setLotIdx(Number(e.target.value))}
                className="mt-1 min-h-[48px]"
              >
                {card.lots.map((l, i) => (
                  <option key={`${l.lotId}-${l.locationId}`} value={i}>
                    {l.lotNumber} · {fmtMass(l.qty)} at {l.locationCode}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-[14px] border-2 border-[var(--bad-bd)] bg-[var(--bad-bg)] p-3 text-[16px] font-semibold text-[var(--bad-fg)]">
          <AlertTriangle size={18} className="mr-1 inline" aria-hidden />
          No usable lot of {card.materialName} here. Ask QA or the storekeeper.
        </p>
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
          {p.lotConfirm === "last4" && <input type="hidden" name="lotConfirm" value={lotCode} />}
          {p.lotConfirm !== "none" && (
            <div className="grid gap-2" data-testid="lot-scan">
              {lotCode.startsWith("BC:LOT:") ? (
                <p className="inline-flex items-center gap-2 text-[16px] font-semibold text-[var(--ok-fg)]">
                  <CheckCircle2 size={18} aria-hidden /> Label scanned: lot {lotCode.slice(7)}
                </p>
              ) : !camera ? (
                <Button type="button" variant="secondary" size="lg" onClick={() => setCamera(true)}>
                  <Camera size={18} aria-hidden /> Scan the lot label
                </Button>
              ) : (
                <div className="rounded-[14px] bg-surface-2 p-3">
                  <Scanner onScan={onScan} autoFocus={false} label="Point the camera at the lot label on the container" placeholder="Lot label" />
                </div>
              )}
              {scanNote && <p className="text-[14px] text-[var(--bad-fg)]">{scanNote}</p>}
              {fe.lotConfirm && <p className="text-[14px] text-[var(--bad-fg)]">{fe.lotConfirm}</p>}
              {p.lotConfirm === "last4" && !lotCode.startsWith("BC:LOT:") && (
                !typeLast4 ? (
                  <button type="button" className="min-h-[44px] text-left text-[14px] text-primary-text underline" onClick={() => { setTypeLast4(true); setActive("lot"); }}>
                    Label damaged? Type the last 4 characters instead
                  </button>
                ) : (
                  <KeypadField
                    id={`lot-${card.batchMaterialId}`}
                    label="Last 4 of the lot on the label"
                    value={lotCode}
                    active={active === "lot"}
                    onFocus={() => setActive("lot")}
                    error={null}
                  />
                )
              )}
            </div>
          )}
          {p.lotConfirm === "scan" && <input type="hidden" name="lotConfirm" value={lotCode} />}
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
            <SubmitButton
              variant="cta"
              size="lg"
              disabled={!canSave}
              pendingText="Saving…"
              className="w-full"
            >
              Save
            </SubmitButton>
          )}
          <FormMessage state={state} />
          <details className="text-[14px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">
              More details
            </summary>
            <div className="grid gap-2 pt-1">
              {p.requiresScale && (
                <label className="flex flex-col gap-1">
                  Scale
                  <Select
                    value={scale}
                    onChange={(e) => setScale(e.target.value)}
                    className="min-h-[48px]"
                  >
                    {p.scales.map((s) => (
                      <option key={s.id} value={s.code} disabled={!s.usable}>
                        {s.code} · {s.name}
                        {s.calibrationDueDate
                          ? ` · check due ${fmtDate(s.calibrationDueDate)}`
                          : ""}
                        {!s.usable ? " · cannot be used" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
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
          onSubmit={
            active === "lot" && p.lotConfirm === "last4" && !entered
              ? () => setActive("qty")
              : save
          }
          submitLabel={active === "lot" && !entered ? "Next" : "Save"}
          submitDisabled={
            active === "lot" && !entered ? lotCode.length < 4 : !canSave
          }
        />
      </form>
    </section>
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
}: {
  batchId: string;
  card: Card;
  weighing: Card["waitingForCheck"][number];
  checkers: Person[];
  passwordRequired: boolean;
  viewer: { userId: string; displayName: string; canCheck: boolean };
}) {
  const [state, action] = useInPlaceAction(checkWeighingAction);
  const [ownState, ownAction] = useInPlaceAction(checkWeighingOwnAction);
  const [who, setWho] = useState<Person | null>(null);
  const others = checkers.filter((c) => c.id !== weighing.operatorId);
  // The checker opened this screen on their own phone: one tap in their own name (own session).
  if (viewer.canCheck && viewer.userId !== weighing.operatorId)
    return (
      <form action={ownAction} className="grid gap-3 rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5" data-testid="own-weigh-check">
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="dispenseRecordId" value={weighing.id} />
        <h2 className="text-[22px] font-semibold text-fg">
          {viewer.displayName}, did you watch {weighing.operator} weigh {g(weighing.qtyG)} of {card.materialName}, lot {weighing.lotNumber}?
        </h2>
        <p className="text-[15px] text-muted">You sign with your own account.</p>
        <SubmitButton variant="cta" size="lg" pendingText="Saving…">
          <UserCheck size={20} aria-hidden /> Yes, I checked it
        </SubmitButton>
        <FormMessage state={ownState} />
      </form>
    );
  return (
    <section
      className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5"
      aria-label="Second check"
      data-testid="second-check"
    >
      {!who ? (
        <>
          <h2 className="flex items-center gap-2 text-[22px] font-semibold text-fg">
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
          <p className="mt-3 text-[13px] text-muted">
            The second check needs a connection.
          </p>
        </>
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="dispenseRecordId" value={weighing.id} />
          <input type="hidden" name="checkerId" value={who.id} />
          <h2 className="text-[22px] font-semibold text-fg">
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
      <h2 className="flex items-center gap-2 text-[22px] font-semibold text-fg">
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
