"use client";
import Link from "next/link";
import { NextApprover } from "@/ui/next-approver";
import type { NextActors } from "@/lib/next-actors-words";
import { AlertTriangle, CheckCircle2, Hourglass, UserCheck, Wrench, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { StepCardView } from "@/modules/production";
import { Button, cx, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import Decimal from "decimal.js";
import {
  checklistCardAction,
  checkStepAction,
  endEarlyAction,
  equipmentCardAction,
  stepDoneAction,
} from "../../flow-actions";
import { plainWords } from "@/modules/production/plain-words";
import { CORRECTION_REASONS, outOfRangeSentence, rangeWords } from "@/modules/production/floor-words";

/** "90.000000" → "90" for a saved number (no grouping commas: it goes back into the keypad). */
const noZeros = (v: string) => {
  try {
    return new Decimal(v.replace(/,/g, "")).toFixed().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  } catch {
    return v;
  }
};
import { PackagingBox } from "./packaging-box";
import { EquipmentWhy } from "../../equipment-why";
import { ScanOrPick } from "@/ui/scan-or-pick";

/**
 * A step waiting for its second check (ADR-130 one checker flow). The checker checks on their OWN phone, from
 * their list "Waiting for you to check", and comes back to that list (round 5 B18). On the operator's phone: who
 * checks, and — only when the company allows it — "The checker is here": they type their OWN password. A name
 * alone never signs (round 5 B1).
 */
function StepCheck(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(checkStepAction);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  const others = p.checkers.filter((c) => c.id !== step.record?.conductedById);
  if (p.viewer.canCheck && !p.viewer.isDoer)
    return (
      <section className="grid gap-3 rounded-[8px] border-2 border-[var(--warn-bd)] bg-surface p-5" aria-label="Your check" data-testid="own-check">
        <h2 className="text-title text-fg">This step waits for your check</h2>
        <p className="text-[16px] text-fg-2">
          {plainWords(step.name)}
          {step.record?.conductedBy ? `, done by ${step.record.conductedBy}` : ""}. Look at the work, then check it on your list.
        </p>
        <Link href="/production/checks" className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[6px] bg-cta px-6 text-[17px] font-semibold text-white">
          Open my list: Waiting for you to check
        </Link>
      </section>
    );
  return (
    <section className="grid gap-3 rounded-[8px] border-2 border-[var(--warn-bd)] bg-surface p-5" aria-label="Second check" data-testid="step-waits-check">
      <h2 className="flex items-center gap-2 text-title text-fg">
        <UserCheck size={24} aria-hidden /> Saved. Waiting for the second check
      </h2>
      <NextApprover next={p.checkNext} className="text-[16px] text-fg" />
      <p className="text-[16px] text-fg-2">They check it on their own phone (their list &quot;Waiting for you to check&quot;). You can go on when it is checked.</p>
      {p.sameDevice && others.length > 0 && !open && (
        <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(true)} data-testid="check-here">
          The checker is here: sign on this phone
        </Button>
      )}
      {p.sameDevice && open && (
        <form action={action} className="grid gap-3 rounded-[8px] bg-surface-2 p-3" data-testid="check-here-form">
          <input type="hidden" name="batchId" value={p.batchId} />
          <input type="hidden" name="stepNo" value={step.stepNo} />
          <input type="hidden" name="stepKind" value={step.kind} />
          <input type="hidden" name="checkerId" value={who?.id ?? ""} />
          <p className="text-[16px] font-semibold">Who checks?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {others.map((c) => (
              <button key={c.id} type="button" aria-pressed={who?.id === c.id} onClick={() => setWho(c)} className={cx("min-h-[52px] rounded-[6px] border px-4 text-left text-[16px]", who?.id === c.id ? "border-ring bg-primary-soft font-semibold" : "border-line bg-surface")}>
                {c.displayName}
              </button>
            ))}
          </div>
          {who && (
            <label className="flex flex-col gap-1 text-[15px] font-medium">
              {who.displayName.split(/\s+/)[0]} looked at {plainWords(step.name)} and types their own password
              <Input type="password" name="checkerPassword" autoComplete="off" required className="min-h-[56px]" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="cta" size="lg" pendingText="Saving…" disabled={!who}>
              Yes, it looks right
            </SubmitButton>
            <Button type="button" variant="secondary" size="lg" onClick={() => { setOpen(false); setWho(null); }}>
              Cancel
            </Button>
          </div>
          <FormMessage state={state} />
        </form>
      )}
    </section>
  );
}

type Step = StepCardView["step"];
type Person = { id: string; displayName: string };
type Props = {
  batchId: string;
  step: Step;
  canPerform: boolean;
  checkers: Person[];
  /** Who can check this step (docs/NEXT_APPROVER.md); null when it does not wait for a check. */
  checkNext?: NextActors | null;
  approvers: Person[];
  /** ADR-130 `production.sign_off.same_device`: a checker standing here may type their own password (never a name alone). */
  sameDevice: boolean;
  /** Round 5 problem 2 / B19: the last step (move to the QA waiting area) IS Finish: its form, in this template. */
  finishPanel?: ReactNode;
  /** Round 5 problem 3: while the labels are not printed, the label button is the one green button. */
  quietDone?: boolean;
  nextHref: string | null;
  nextLabel: string | null;
  weighHref: string;
  /** The Finish screen of the batch (the last step, transfer). */
  finishHref: string;
  /** The read-only batch record ("See the full batch record"). */
  fullRecordHref: string;
  /** Packaging step (ADR-088 §3): the wrappers taken at Get materials and the label button. */
  packaging?: StepCardView["packaging"];
  /** ADR-099 label panel (server-rendered), only when printing is allowed. */
  labelsPanel?: ReactNode;
  /** "Not yet": an earlier step is open; no form is shown (the banner above links to the right step). */
  blocked?: boolean;
  /** The signed-in person: may they sign the second check of this step on their own device? */
  viewer: StepCardView["viewer"];
  /** Steps that need equipment (mixer, mould…): what was used and the list to choose from. */
  equipment: StepCardView["equipment"];
};

/** Plain question under a configured field name (the step's own names are configuration, ADR-088). */
function fieldQuestion(code: string, name: string): string | null {
  if (/destroy|damag|spoil/i.test(code) || /destroy|damag|spoil/i.test(name)) return "How many were spoiled?";
  if (/left|return/i.test(code)) return "How many are left over?";
  if (/used/i.test(code) || /used/i.test(name)) return "How many did you use?";
  return null;
}

/**
 * The generic Step card (S5): one instruction, at most three fields, one button. Variants: check
 * (Yes / No rows + All OK), wait (hourglass, "Curing until Fri 28 Nov", Curing finished from that
 * date, Ask to end early), weighing (link to Weigh), finish (link to Finish), and the plain step with
 * its fields on the keypad. The word "reading" is never shown: each field has its own name and unit.
 */
export function StepCard(p: Props) {
  const { step } = p;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
      <section
        className="rounded-[8px] border border-line bg-surface p-4 sm:p-5"
        aria-label="What to do"
      >
        {step.instruction ? (
          <>
            <p className="whitespace-pre-line text-[18px] leading-snug text-fg">
              {plainWords(step.instruction)}
            </p>
            {(plainWords(step.instruction) !== step.instruction || plainWords(step.name) !== step.name) && (
              <details className="mt-2 text-[13px] text-muted">
                <summary className="min-h-[44px] cursor-pointer py-2">Words as written in the recipe steps</summary>
                <p className="whitespace-pre-line">{step.name}: {step.instruction}</p>
              </details>
            )}
          </>
        ) : null /* Round 5 problem 10: no empty "No instruction for this step." box. */}
        {step.workInstruction && (
          <details className="mt-3 text-[15px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">
              See how to do it
            </summary>
            <p className="whitespace-pre-line text-muted">
              {plainWords(step.workInstruction.bodyMarkdown)}
            </p>
            <p className="mt-1 text-[13px] text-muted">How-to sheet {step.workInstruction.code}</p>
          </details>
        )}
        {step.status === "completed" && (
          <p className="mt-3 inline-flex items-center gap-2 text-[17px] font-semibold text-[var(--ok-fg)]" role="status" data-testid="step-saved">
            <CheckCircle2 size={22} aria-hidden /> Saved. Step done
            {step.record?.conductedBy ? ` by ${step.record.conductedBy}` : ""}.
          </p>
        )}
      </section>
      <div className="grid min-w-0 content-start gap-4">
        {p.packaging && <PackagingBox batchId={p.batchId} stepNo={step.stepNo} packaging={p.packaging} canPerform={p.canPerform} done={step.status === "completed"} labelsPanel={p.labelsPanel} />}
        {p.equipment && <EquipmentBox {...p} equipment={p.equipment} />}
        {p.blocked && step.status !== "completed" ? (
          <p className="text-[15px] text-muted" data-testid="step-not-yet">This step opens when the earlier steps are done (see the yellow box above).</p>
        ) : step.status === "completed" && step.isTransfer && p.finishPanel ? (
          p.finishPanel
        ) : step.status === "completed" ? (
          p.nextHref && p.nextLabel ? (
            <Link
              href={p.nextHref}
              className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[6px] bg-cta px-8 text-[17px] font-semibold text-white"
            >
              {p.nextLabel}
            </Link>
          ) : null
        ) : step.status === "awaiting_check" ? (
          <StepCheck {...p} />
        ) : step.isWeighing ? (
          <Link
            href={p.weighHref}
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[6px] bg-cta px-8 text-[17px] font-semibold text-white"
          >
            Weigh
          </Link>
        ) : step.isTransfer && p.finishPanel ? (
          p.finishPanel
        ) : step.isTransfer ? (
          <Link
            href={p.finishHref}
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[6px] bg-cta px-8 text-[17px] font-semibold text-white"
          >
            Go to Finish
          </Link>
        ) : step.isCheck ? (
          <CheckList {...p} />
        ) : step.isWait ? (
          <WaitCard {...p} />
        ) : (
          <FieldsCard {...p} />
        )}
      </div>
    </div>
  );
}

/** The equipment used on this step (mixer, mould, pot): tap it, scan its label or type its number (ADR-125); warnings stay on record. */
function EquipmentBox(p: Props & { equipment: NonNullable<Props["equipment"]> }) {
  const { step, equipment } = p;
  const [state, action] = useInPlaceAction(equipmentCardAction);
  const open = step.status === "pending" || step.status === "in_progress";
  return (
    <section className="rounded-[8px] border border-line bg-surface p-4" aria-label="Equipment" data-testid="step-equipment">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <Wrench size={18} aria-hidden /> Equipment for this step
      </h2>
      {equipment.uses.length > 0 ? (
        <p className="mt-1 text-[16px] text-fg-2">
          Using {equipment.uses.map((u) => `${u.name ? `${u.name} (${u.code})` : u.code}${u.reasons.length ? ` (warnings: ${u.reasons.join(", ")})` : ""}${u.override ? " (approved)" : ""}`).join(", ")}
        </p>
      ) : (
        <p className="mt-1 text-[15px] text-muted">Choose what you use before Step done.</p>
      )}
      {open && equipment.uses.length === 0 && equipment.options.length > 0 && !equipment.options.some((o) => o.usable) && (
        <div className="mt-3">
          <EquipmentWhy items={equipment.options} title={`No ${equipment.kind ?? "equipment"} can be used now`} />
        </div>
      )}
      {open && p.canPerform && equipment.canChoose && (
        equipment.options.length ? (
          <form action={action} className="mt-3 grid gap-2">
            <input type="hidden" name="batchId" value={p.batchId} />
            <input type="hidden" name="stepNo" value={step.stepNo} />
            <ScanOrPick
              kind="equipment"
              id={`step-${step.stepNo}-equipment`}
              label={`Which ${equipment.kind ?? "equipment"}?`}
              name="equipmentRef"
              submit="code"
              required
              onlyCandidates
              candidatesLabel={`${equipment.kind ? `${equipment.kind[0].toUpperCase()}${equipment.kind.slice(1)}s` : "Equipment"} at this site`}
              candidates={equipment.options.map((o) => ({
                value: o.id,
                title: o.name,
                detail: `${o.code}${!o.usable ? "" : o.reasons.length ? ` · ${o.reasons.join(", ")}` : ""}`,
                code: o.code,
                codes: [o.code],
                disabledReason: o.usable ? undefined : `cannot be used: ${o.why.length ? o.why.join("; ") : o.blocking.join(", ") || "not available"}`,
              }))}
            />
            <SubmitButton variant="secondary" size="lg" pendingText="Saving…">
              Use this equipment
            </SubmitButton>
            <FormMessage state={state} />
          </form>
        ) : (
          <p className="mt-2 text-[15px] text-[var(--warn-fg)]">No {equipment.kind ?? "equipment"} is set up at this site. Ask the site manager.</p>
        )
      )}
    </section>
  );
}

/**
 * Who checks this step (ADR-130). Default: a second person checks it on their own phone after you save (it lands on
 * their list). Only when the company allows it, a checker standing here may sign now with their OWN password.
 */
function CheckerPick({ checkers, sameDevice }: { checkers: Person[]; sameDevice: boolean }) {
  const [who, setWho] = useState("");
  return (
    <div className="grid gap-2 rounded-[8px] bg-surface-2 p-3" data-testid="checker-pick">
      <p className="text-[15px] text-fg">A second person checks this step on their own phone after you save.</p>
      {sameDevice && checkers.length > 0 && (
        <>
          <label className="flex flex-col gap-1 text-[15px] font-medium">
            Or the checker is here and signs now
            <Select name="checkerId" value={who} onChange={(e) => setWho(e.target.value)} className="min-h-[52px] text-[16px]">
              <option value="">No, on their own phone later</option>
              {checkers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </label>
          {who && (
            <label className="flex flex-col gap-1 text-[15px] font-medium">
              They type their own password
              <Input type="password" name="checkerPassword" autoComplete="off" required className="min-h-[52px]" />
            </label>
          )}
        </>
      )}
    </div>
  );
}

/** Start check / Before wrapping check: up to 6 Yes / No rows and All OK (UX review S7). */
function CheckList(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(checklistCardAction);
  const [answers, setAnswers] = useState<
    Record<string, "yes" | "no" | undefined>
  >(() =>
    Object.fromEntries(
      step.checklist.map((c) => [
        c.id,
        (c.answer as "yes" | "no" | null) ?? undefined,
      ]),
    ),
  );
  const anyNo = Object.values(answers).some((a) => a === "no");
  const allAnswered = step.checklist.every((c) => answers[c.id]);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="stepNo" value={step.stepNo} />
      <input
        type="hidden"
        name="itemIds"
        value={step.checklist.map((c) => c.id).join(",")}
      />
      <ul className="grid gap-2">
        {step.checklist.map((c) => (
          <li
            key={c.id}
            className={cx(
              "rounded-[8px] border p-3",
              answers[c.id] === "no"
                ? "border-2 border-[var(--bad-bd)] bg-[var(--bad-bg)]"
                : "border-line bg-surface",
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[17px] text-fg">{c.text}</p>
              <input
                type="hidden"
                name={`answer-${c.id}`}
                value={answers[c.id] ?? ""}
              />
              <div className="flex gap-2">
                {(["yes", "no"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={!p.canPerform}
                    aria-pressed={answers[c.id] === a}
                    onClick={() => setAnswers({ ...answers, [c.id]: a })}
                    className={cx(
                      "inline-flex min-h-[56px] min-w-[88px] items-center justify-center gap-1 rounded-[6px] border text-[17px] font-semibold",
                      answers[c.id] === a
                        ? a === "yes"
                          ? "border-transparent bg-primary text-white"
                          : "border-transparent bg-[#c62828] text-white"
                        : "border-line-strong bg-surface text-fg",
                    )}
                  >
                    {a === "yes" ? (
                      <CheckCircle2 size={18} aria-hidden />
                    ) : (
                      <XCircle size={18} aria-hidden />
                    )}
                    {a === "yes" ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
            {answers[c.id] === "no" && (
              <label className="mt-2 flex flex-col gap-1 text-[14px] font-medium">
                What did you find, and what did you do?
                <Input
                  name={`note-${c.id}`}
                  className="min-h-[52px] text-[16px]"
                  required
                />
              </label>
            )}
          </li>
        ))}
      </ul>
      {step.requiresChecker && (
        <CheckerPick
          checkers={p.checkers}
          sameDevice={p.sameDevice}
        />
      )}
      {p.canPerform && (
        // Round 5 problem 10: ONE button. Nothing answered yet: "All OK" (every answer Yes). Once answered: "Save".
        <div className="rounded-[8px] bg-surface/95 p-2 lg:static">
          {!allAnswered && !Object.values(answers).some(Boolean) ? (
            <SubmitButton name="allOk" value="1" variant="cta" size="lg" pendingText="Saving…" className="w-full">
              All OK
            </SubmitButton>
          ) : (
            <SubmitButton variant="cta" size="lg" pendingText="Saving…" disabled={!allAnswered} className="w-full">
              {anyNo ? "Save and report a problem" : "Save"}
            </SubmitButton>
          )}
          {!allAnswered && Object.values(answers).some(Boolean) && <p className="mt-1 text-[14px] text-fg-2">Answer every line, then tap Save.</p>}
        </div>
      )}
      {anyNo && (
        <p className="text-[14px] text-[var(--bad-fg)]">
          A &quot;No&quot; stops this step until it is fixed and answered again.
        </p>
      )}
      <FormMessage state={state} />
    </form>
  );
}

/** Wait variant: "Curing until Fri 28 Nov", days left, Curing finished from that date, Ask to end early. */
function WaitCard(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(stepDoneAction);
  const word = /mou?ld/i.test(step.name)
    ? "Mould time finished"
    : step.kind === "hold"
      ? "Resting finished"
      : "Curing finished";
  const early = step.waiting && !step.exceptionApproved;
  return (
    <section
      className="rounded-[8px] border border-line bg-surface p-5 text-center"
      data-testid="wait-card"
    >
      <Hourglass size={56} className="mx-auto text-muted" aria-hidden />
      {step.status === "pending" ? (
        <p className="mt-2 text-value">
          The wait has not started.
        </p>
      ) : (
        <>
          <p className="mt-2 font-display text-stat text-fg">
            {step.waitingLabel ?? "Ready now"}
          </p>
          {step.waiting && (
            <p className="text-[17px] text-muted">
              {step.daysLeft === 1
                ? "1 day left"
                : `${step.daysLeft} days left`}
            </p>
          )}
        </>
      )}
      <form action={action} className="mt-4 grid gap-2">
        <input type="hidden" name="batchId" value={p.batchId} />
        <input type="hidden" name="stepNo" value={step.stepNo} />
        <SubmitButton
          variant="cta"
          size="lg"
          pendingText="Saving…"
          disabled={!p.canPerform || (step.status !== "pending" && early)}
          className="w-full"
        >
          {step.status === "pending" ? "Start the wait" : word}
        </SubmitButton>
        {early && step.readyLabel && (
          <p className="text-[15px] text-muted">
            Ready on {step.readyLabel}. Ending early needs approval.
          </p>
        )}
        <FormMessage state={state} />
      </form>
      {early && p.canPerform && (
        <ApprovalForm
          batchId={p.batchId}
          stepNo={step.stepNo}
          approvers={p.approvers}
          sameDevice={p.sameDevice}
          label="Ask to end early"
        />
      )}
    </section>
  );
}

/** Ask for approval: an approver (QA / site manager) picks their name and gives the reason; a problem report is opened (CX-TOL). */
function ApprovalForm({
  batchId,
  stepNo,
  approvers,
  label,
}: {
  batchId: string;
  stepNo: number;
  approvers: Person[];
  /** Unused: an approver always types their own password (ADR-130). Kept so callers pass the same props. */
  sameDevice?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useInPlaceAction(endEarlyAction);
  if (!open)
    return (
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="mt-3 w-full"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  return (
    <form
      action={action}
      className="mt-3 grid gap-2 rounded-[8px] bg-surface-2 p-3 text-left"
    >
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="stepNo" value={stepNo} />
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Who approves (QA or the site manager, standing here)
        <Select
          name="approverId"
          defaultValue=""
          className="min-h-[52px] text-[16px]"
          required
        >
          <option value="" disabled>
            Choose…
          </option>
          {approvers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        They type their own password
        <Input type="password" name="approverPassword" autoComplete="off" required className="min-h-[52px]" />
      </label>
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Why it is right (they write it)
        <Textarea
          name="reason"
          required
          minLength={10}
          className="text-[16px]"
        />
      </label>
      <div>
        <SubmitButton variant="primary" size="lg" pendingText="Saving…">
          {label}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

type FieldDef = Step["fields"][number];

/** Plain step: up to 3 fields (number on the keypad, Yes / No buttons, short text), then Step done. */
function FieldsCard(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(stepDoneAction);
  // Round 5 B3: numbers without trailing zeros ("90", never "90.000000").
  const saved = (f: FieldDef) => (f.reading ? (f.valueKind === "numeric" ? noZeros(f.reading.value) : f.reading.value) : "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(step.fields.map((f) => [f.id, saved(f)])));
  const [why, setWhy] = useState<Record<string, string>>({});
  const numeric = step.fields.filter((f) => f.valueKind === "numeric");
  const [active, setActive] = useState<string | null>(numeric[0]?.id ?? null);
  const fe = state?.fieldErrors ?? {};
  const set = (id: string, v: string) => setValues({ ...values, [id]: v });
  const changed = (f: FieldDef) => !!f.reading && values[f.id] !== saved(f);
  /** Live check while typing, like Weigh: the plain sentence when the typed number is outside its range. */
  const outside = (f: FieldDef) => {
    const v = values[f.id] ?? "";
    if (f.valueKind !== "numeric" || !/^-?\d+(\.\d+)?$/.test(v) || (f.minValue === null && f.maxValue === null)) return null;
    const d = new Decimal(v);
    if ((f.maxValue !== null && d.gt(f.maxValue)) || (f.minValue !== null && d.lt(f.minValue))) return outOfRangeSentence({ name: plainWords(f.name), uom: f.uom, minValue: f.minValue, maxValue: f.maxValue, valueKind: f.valueKind }, v);
    return null;
  };
  const exceptionable =
    step.blockers.some((b) => b.exceptionable) && !step.exceptionApproved;
  const activeField = step.fields.find((f) => f.id === active) ?? null;
  return (
    <>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="batchId" value={p.batchId} />
        <input type="hidden" name="stepNo" value={step.stepNo} />
        <input
          type="hidden"
          name="parameterIds"
          value={[...step.fields, ...step.moreFields].map((f) => f.id).join(",")}
        />
        {step.fields.length === 0 && (
          <p className="text-[16px] text-muted">
            Nothing to fill in. Do the step, then tap Step done.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {step.fields.map((f) => (
            <div key={f.id} className="grid gap-1">
              <input
                type="hidden"
                name={`param-${f.id}`}
                value={values[f.id] ?? ""}
              />
              {f.valueKind === "numeric" ? (
                <KeypadField
                  id={`f-${f.id}`}
                  label={fieldQuestion(f.code, f.name) ? `${fieldQuestion(f.code, f.name)} (${plainWords(f.name)})` : plainWords(f.name)}
                  unit={f.uom}
                  value={values[f.id] ?? ""}
                  // ADR-135: a keyboard or a scale types here too, with the keypad's rules. Enter goes to the next
                  // number, then to Step done (a second Enter presses it: finishing a step stays a deliberate act).
                  onChange={(v) => set(f.id, v)}
                  decimal={f.uom !== "pcs"}
                  readOnly={!p.canPerform}
                  // The cursor starts in the first number, except where a label scan may come first (equipment or
                  // packaging box: their scan listens only while no box has the cursor) or the step is done.
                  autoFocus={p.canPerform && f.id === numeric[0]?.id && !p.equipment && !p.packaging && step.status !== "completed"}
                  onEnter={() => {
                    const next = numeric[numeric.findIndex((n) => n.id === f.id) + 1];
                    document.getElementById(next ? `f-${next.id}` : `done-${step.stepNo}`)?.focus();
                  }}
                  active={active === f.id}
                  onFocus={() => setActive(f.id)}
                  error={fe[`param-${f.id}`] ?? null}
                  hint={
                    outside(f) ? (
                      <span className="font-semibold text-[var(--warn-fg)]" data-testid="reading-outside">
                        {outside(f)}
                      </span>
                    ) : (
                      (rangeWords({ name: f.name, uom: f.uom, minValue: f.minValue, maxValue: f.maxValue, valueKind: f.valueKind }) ?? undefined)
                    )
                  }
                />
              ) : f.valueKind === "boolean" ? (
                <fieldset className="grid gap-1">
                  <legend className="text-[15px] font-medium text-fg">
                    {f.name}
                  </legend>
                  <div className="flex gap-2">
                    {(["yes", "no"] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={values[f.id] === a}
                        onClick={() => set(f.id, a)}
                        className={cx(
                          "inline-flex min-h-[56px] flex-1 items-center justify-center rounded-[6px] border text-[17px] font-semibold",
                          values[f.id] === a
                            ? "border-transparent bg-primary text-white"
                            : "border-line-strong bg-surface text-fg",
                        )}
                      >
                        {a === "yes" ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <label className="flex flex-col gap-1 text-[15px] font-medium">
                  {f.name}
                  <Input
                    value={values[f.id] ?? ""}
                    onChange={(e) => set(f.id, e.target.value)}
                    className="min-h-[56px] text-[17px]"
                  />
                </label>
              )}
              {changed(f) && (
                // Round 5 B3: the reason is tapped (gloves); words only for "Other". The first value stays on record.
                <fieldset className="grid gap-2" data-testid="correction-reason">
                  <legend className="text-[15px] font-medium">Why change it? ({saved(f)}{f.uom ? ` ${f.uom}` : ""} stays on record)</legend>
                  <input type="hidden" name={`correctionCode-${f.id}`} value={why[f.id] ?? ""} />
                  <div className="flex flex-wrap gap-2">
                    {CORRECTION_REASONS.map((r) => (
                      <button key={r.code} type="button" aria-pressed={why[f.id] === r.code} onClick={() => setWhy({ ...why, [f.id]: r.code })} className={cx("min-h-[52px] rounded-[6px] border px-4 text-[16px]", why[f.id] === r.code ? "border-ring bg-primary-soft font-semibold" : "border-line bg-surface")}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {why[f.id] === "other" && <Input name={`correction-${f.id}`} placeholder="A few words" className="min-h-[52px] text-[16px]" />}
                  {fe[`correction-${f.id}`] && <p className="text-[14px] text-[var(--bad-fg)]">{fe[`correction-${f.id}`]}</p>}
                </fieldset>
              )}
            </div>
          ))}
        </div>
        {activeField && p.canPerform && (
          <Keypad
            value={values[activeField.id] ?? ""}
            onChange={(v) => set(activeField.id, v)}
            decimal={activeField.uom !== "pcs"}
            // Re-audit N4: no "Step done" on the keypad (it sat next to the spoiled-wrappers field); one Step done below.
          />
        )}
        {step.requiresChecker && (
          <CheckerPick
            checkers={p.checkers}
            sameDevice={p.sameDevice}
          />
        )}
        <details className="text-[14px]">
          <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">
            More details
          </summary>
          <div className="grid gap-2 pt-1">
            <label className="flex flex-col gap-1">
              Note
              <Textarea name="notes" className="text-[16px]" />
            </label>
            {step.moreFields.map((f) => (
              <label key={f.id} className="flex flex-col gap-1 text-[15px] font-medium">
                {f.name}
                {f.uom ? ` (${f.uom})` : ""}
                {f.minValue || f.maxValue ? <span className="text-[13px] font-normal text-muted">OK {f.limits}</span> : null}
                <Input
                  name={`param-${f.id}`}
                  defaultValue={f.reading ? (f.valueKind === "numeric" ? noZeros(f.reading.value) : f.reading.value) : ""}
                  inputMode={f.valueKind === "numeric" ? "decimal" : undefined}
                  className="min-h-[52px] text-[16px]"
                />
                {f.reading && (
                  <span className="text-[13px] font-normal text-muted">
                    Saved: {f.valueKind === "numeric" ? noZeros(f.reading.value) : f.reading.value}
                    {f.reading.isWithinLimits ? "" : " (outside the range)"}. To change it, type the new value and say why:
                    <Input name={`correction-${f.id}`} placeholder="Why change it?" className="mt-1 min-h-[48px] text-[15px]" />
                  </span>
                )}
              </label>
            ))}
          </div>
        </details>
        {step.blockers.length > 0 && !state?.message && (
          <p className="flex items-start gap-2 text-[15px] text-[var(--warn-fg)]" data-testid="step-blockers">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden /> {step.blockers.map((b) => b.message).join(" ")}
          </p>
        )}
        {p.canPerform && (
          <div className="rounded-[8px] bg-surface/95 p-2 lg:static">
            <SubmitButton
              id={`done-${step.stepNo}`}
              variant={p.quietDone ? "secondary" : "cta"}
              size="lg"
              pendingText="Saving…"
              className="w-full"
            >
              Step done
            </SubmitButton>
          </div>
        )}
        <FormMessage state={state} />
      </form>
      {exceptionable && p.canPerform && (
        <ApprovalForm
          batchId={p.batchId}
          stepNo={step.stepNo}
          approvers={p.approvers}
          sameDevice={p.sameDevice}
          label="It is right: ask QA to accept it"
        />
      )}
    </>
  );
}
