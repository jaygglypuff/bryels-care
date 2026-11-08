"use client";
import Link from "next/link";
import { CheckCircle2, Scale, ClipboardCheck, XCircle } from "lucide-react";
import { useState } from "react";
import type { CheckCard } from "@/modules/production";
import type { ActionState } from "@/lib/errors";
import { Button, cx, Input } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction, type FormAction } from "@/ui/form";
import { confirmStepAction, confirmWeighingsAction, stepNotRightAction, weighingNotRightAction } from "./actions";

const WEIGH_REASONS = ["Wrong lot", "Wrong weight", "Scale not zeroed", "Other"] as const;
const STEP_REASONS = ["Not done right", "Wrong number", "Area not clean", "Other"] as const;

/**
 * The checker's list (ADR-130). The list keeps the last "Checked. Thank you." on top after the card it came from
 * leaves the list, so the checker always sees what happened and stays here (round 5 B18).
 */
export function ChecksList({ cards, viewerName }: { cards: CheckCard[]; viewerName: string }) {
  const [done, setDone] = useState<string | null>(null);
  const wrap = (a: FormAction): FormAction => async (prev, fd) => {
    const r = await a(prev, fd);
    if (r?.ok && r.message) setDone(r.message);
    return r;
  };
  return (
    <div className="grid gap-4">
      {done && (
        <p role="status" className="flex items-start gap-2 rounded-[16px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] p-4 text-[17px] font-semibold text-[var(--ok-fg)]" data-testid="check-done">
          <CheckCircle2 size={22} className="mt-0.5 shrink-0" aria-hidden /> {done}
        </p>
      )}
      {cards.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface-2/60 px-6 py-10 text-center" data-testid="checks-empty">
          <p className="text-[18px] font-medium text-fg">Nothing to check now, {viewerName}.</p>
          <p className="mt-1 text-[15px] text-muted">When someone needs your check, it shows here and on your Home.</p>
          <Link href="/dashboard" className="mt-4 inline-flex min-h-[52px] items-center rounded-full border border-line bg-surface px-6 text-[16px] font-medium text-fg">
            Back to Home
          </Link>
        </div>
      ) : (
        <>
          <p className="text-[16px] text-fg-2">{cards.length === 1 ? "1 thing to check." : `${cards.length} things to check.`} Look at the real thing first.</p>
          {cards.map((c) =>
            c.kind === "weighings" ? (
              <WeighingsCard key={c.key} card={c} confirm={wrap(confirmWeighingsAction)} notRight={wrap(weighingNotRightAction)} />
            ) : (
              <StepCheckCard key={c.key} card={c} confirm={wrap(confirmStepAction)} notRight={wrap(stepNotRightAction)} />
            ),
          )}
        </>
      )}
    </div>
  );
}

type WCard = Extract<CheckCard, { kind: "weighings" }>;
type SCard = Extract<CheckCard, { kind: "step" }>;

function WeighingsCard({ card, confirm, notRight }: { card: WCard; confirm: FormAction; notRight: FormAction }) {
  const [state, action] = useInPlaceAction<ActionState>(confirm);
  const [open, setOpen] = useState(false);
  const n = card.weighings.length;
  const who = card.operatorNames.join(" and ");
  return (
    <section className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-4 sm:p-5" aria-label={`Check weighings of ${card.batchNumber}`} data-testid="check-card-weighings">
      <h2 className="flex items-center gap-2 text-title text-fg">
        <Scale size={24} aria-hidden /> {n === 1 ? `Check ${who}'s weighing` : `Check ${n} weighings`}
      </h2>
      <p className="mt-1 text-[16px] text-fg-2">
        {card.productName} · batch <span className="font-semibold tabular text-fg">{card.batchNumber}</span> · weighed by {who}
      </p>
      <ul className="mt-3 grid gap-2">
        {card.weighings.map((w) => (
          <li key={w.id} className="rounded-[14px] bg-surface-2 p-3">
            <p className="text-[18px] font-semibold text-fg">{w.materialName}</p>
            <p className="text-[17px] tabular text-fg">{w.amount}</p>
            <p className="text-[14px] text-fg-2">Lot {w.lotNumber}</p>
          </li>
        ))}
      </ul>
      <form action={action} className="mt-4 grid gap-2">
        <input type="hidden" name="batchId" value={card.batchId} />
        <input type="hidden" name="dispenseRecordIds" value={card.weighings.map((w) => w.id).join(",")} />
        <SubmitButton variant="cta" size="lg" pendingText="Saving…" className="w-full" data-testid="looks-right">
          <CheckCircle2 size={20} aria-hidden /> {n === 1 ? "Looks right" : `Looks right (all ${n})`}
        </SubmitButton>
        <FormMessage state={state} />
      </form>
      {!open ? (
        <Button type="button" variant="secondary" size="lg" className="mt-2 w-full" onClick={() => setOpen(true)} data-testid="not-right">
          <XCircle size={20} aria-hidden /> Not right
        </Button>
      ) : (
        <NotRightForm hidden={{ batchId: card.batchId }} pickOne={card.weighings.map((w) => ({ name: "dispenseRecordId", value: w.id, label: `${w.materialName} · ${w.amount}` }))} reasons={WEIGH_REASONS} action={notRight} onCancel={() => setOpen(false)} />
      )}
    </section>
  );
}

function StepCheckCard({ card, confirm, notRight }: { card: SCard; confirm: FormAction; notRight: FormAction }) {
  const [state, action] = useInPlaceAction<ActionState>(confirm);
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-4 sm:p-5" aria-label={`Check ${card.stepName} of ${card.batchNumber}`} data-testid="check-card-step">
      <h2 className="flex items-center gap-2 text-title text-fg">
        <ClipboardCheck size={24} aria-hidden /> Check &quot;{card.stepName}&quot;
      </h2>
      <p className="mt-1 text-[16px] text-fg-2">
        {card.productName} · batch <span className="font-semibold tabular text-fg">{card.batchNumber}</span> · done by {card.doneBy}
      </p>
      {card.facts.length > 0 && (
        <ul className="mt-3 grid gap-1 rounded-[14px] bg-surface-2 p-3 text-[17px] text-fg">
          {card.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[15px]">
        <Link href={card.batchHref} className="inline-flex min-h-[44px] items-center text-primary-text underline">
          See the step
        </Link>
      </p>
      <form action={action} className="mt-2 grid gap-2">
        <input type="hidden" name="batchId" value={card.batchId} />
        <input type="hidden" name="stepNo" value={card.stepNo} />
        <SubmitButton variant="cta" size="lg" pendingText="Saving…" className="w-full" data-testid="looks-right">
          <CheckCircle2 size={20} aria-hidden /> Looks right
        </SubmitButton>
        <FormMessage state={state} />
      </form>
      {!open ? (
        <Button type="button" variant="secondary" size="lg" className="mt-2 w-full" onClick={() => setOpen(true)} data-testid="not-right">
          <XCircle size={20} aria-hidden /> Not right
        </Button>
      ) : (
        <NotRightForm hidden={{ batchId: card.batchId, stepNo: String(card.stepNo) }} reasons={STEP_REASONS} action={notRight} onCancel={() => setOpen(false)} />
      )}
    </section>
  );
}

/** "Not right": which one (when several), why (tap), a few words only for "Other". */
function NotRightForm({ hidden, pickOne, reasons, action: a, onCancel }: { hidden: Record<string, string>; pickOne?: { name: string; value: string; label: string }[]; reasons: readonly string[]; action: FormAction; onCancel: () => void }) {
  const [state, action] = useInPlaceAction<ActionState>(a);
  const [which, setWhich] = useState(pickOne && pickOne.length === 1 ? pickOne[0].value : "");
  const [reason, setReason] = useState("");
  const fe = state?.fieldErrors ?? {};
  const chip = (on: boolean) => cx("min-h-[52px] rounded-full border px-4 text-[16px]", on ? "border-ring bg-primary-soft font-semibold" : "border-line bg-surface");
  return (
    <form action={action} className="mt-3 grid gap-3 rounded-[14px] border border-line p-3" data-testid="not-right-form">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {pickOne && pickOne.length > 1 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[16px] font-semibold">Which one is not right?</legend>
          {pickOne.map((o) => (
            <button key={o.value} type="button" aria-pressed={which === o.value} onClick={() => setWhich(o.value)} className={cx(chip(which === o.value), "text-left")}>
              {o.label}
            </button>
          ))}
        </fieldset>
      )}
      {pickOne && <input type="hidden" name={pickOne[0]?.name ?? "id"} value={which} />}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[16px] font-semibold">What is not right?</legend>
        <div className="flex flex-wrap gap-2">
          {reasons.map((r) => (
            <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={chip(reason === r)}>
              {r}
            </button>
          ))}
        </div>
        {fe.reasonCode && <p className="text-[14px] text-[var(--bad-fg)]">{fe.reasonCode}</p>}
      </fieldset>
      <input type="hidden" name="reasonCode" value={reason} />
      <label className="grid gap-1 text-[15px]">
        {reason === "Other" ? "Write what is not right" : "More words (if you want)"}
        <Input name="reasonNote" className="min-h-[52px] text-[16px]" maxLength={300} />
        {fe.reasonNote && <span className="text-[14px] text-[var(--bad-fg)]">{fe.reasonNote}</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" size="lg" pendingText="Sending…" disabled={!reason || (!!pickOne && !which)}>
          Send it back
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
