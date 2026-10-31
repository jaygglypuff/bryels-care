"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Hourglass, UserCheck, Wrench, XCircle } from "lucide-react";
import { useState } from "react";
import type { StepCardView } from "@/modules/production";
import { Button, cx, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import {
  checklistCardAction,
  checkStepAction,
  checkStepOwnAction,
  endEarlyAction,
  equipmentCardAction,
  returnStepCardAction,
  stepDoneAction,
} from "../../flow-actions";
import { plainWords } from "@/modules/production/plain-words";
import { PackagingBox } from "./packaging-box";

/**
 * The checker is signed in on THIS device (their own phone or tablet): one tap "Yes, I checked" in their
 * own name (checkStep on their session, like the old batch workspace), or send it back with a reason.
 */
function OwnCheck(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(checkStepOwnAction);
  const [back, setBack] = useState(false);
  const [bState, bAction] = useInPlaceAction(returnStepCardAction);
  return (
    <section className="grid gap-3 rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5" aria-label="Your check" data-testid="own-check">
      <h2 className="text-[22px] font-semibold text-fg">
        {p.viewer.displayName}, did you check {plainWords(step.name)}
        {step.record?.conductedBy ? ` done by ${step.record.conductedBy}` : ""}?
      </h2>
      <p className="text-[15px] text-muted">You sign with your own account. Look at the work first.</p>
      <form action={action} className="grid gap-2">
        <input type="hidden" name="batchId" value={p.batchId} />
        <input type="hidden" name="stepNo" value={step.stepNo} />
        <SubmitButton variant="cta" size="lg" pendingText="Saving…" className="w-full">
          <UserCheck size={20} aria-hidden /> Yes, I checked it
        </SubmitButton>
        <FormMessage state={state} />
      </form>
      {!back ? (
        <Button type="button" variant="secondary" size="lg" onClick={() => setBack(true)}>
          Something is wrong: send it back
        </Button>
      ) : (
        <form action={bAction} className="grid gap-2 rounded-[14px] bg-surface-2 p-3">
          <input type="hidden" name="batchId" value={p.batchId} />
          <input type="hidden" name="stepNo" value={step.stepNo} />
          <label className="flex flex-col gap-1 text-[15px] font-medium">
            What must be corrected?
            <Textarea name="reason" required minLength={5} className="text-[16px]" />
          </label>
          <SubmitButton variant="primary" size="lg" pendingText="Saving…">
            Send it back
          </SubmitButton>
          <FormMessage state={bState} />
        </form>
      )}
    </section>
  );
}

/** Second check of a step on this tablet: pick a name, then a confirm addressed to the checker (2 taps, ADR-078). */
function StepCheck(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(checkStepAction);
  const [who, setWho] = useState<Person | null>(null);
  const others = p.checkers.filter((c) => c.id !== step.record?.conductedById);
  // The signed-in person may check (not the one who did the step): they sign in their own name.
  if (p.viewer.canCheck && !p.viewer.isDoer) return <OwnCheck {...p} />;
  if (!who)
    return (
      <section className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5" aria-label="Second check">
        <h2 className="text-[22px] font-semibold text-fg">Second check needed</h2>
        <p className="mt-1 text-[16px] text-muted">Ask someone to check {plainWords(step.name)}. They pick their name here, or open this step on their own phone (My work shows &quot;Check {step.name.toLowerCase()}&quot;).</p>
        {others.length ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {others.map((c) => (
              <Button key={c.id} type="button" variant="secondary" size="lg" className="justify-start" onClick={() => setWho(c)}>
                {c.displayName}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-[16px]">No one else here can check. They can check later from their own tablet.</p>
        )}
      </section>
    );
  return (
    <form action={action} className="grid gap-3 rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5">
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="stepNo" value={step.stepNo} />
      <input type="hidden" name="stepKind" value={step.kind} />
      <input type="hidden" name="checkerId" value={who.id} />
      <h2 className="text-[22px] font-semibold text-fg">
        {who.displayName}, you checked {plainWords(step.name)}
        {step.record?.conductedBy ? ` done by ${step.record.conductedBy}` : ""}?
      </h2>
      {p.passwordRequired && (
        <label className="flex flex-col gap-1 text-[15px] font-medium">
          {who.displayName}&apos;s password
          <Input type="password" name="checkerPassword" autoComplete="off" className="min-h-[56px]" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="cta" size="lg" pendingText="Saving…">
          Yes, I checked
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={() => setWho(null)}>
          No
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

type Step = StepCardView["step"];
type Person = { id: string; displayName: string };
type Props = {
  batchId: string;
  step: Step;
  canPerform: boolean;
  checkers: Person[];
  approvers: Person[];
  passwordRequired: boolean;
  nextHref: string | null;
  nextLabel: string | null;
  weighHref: string;
  /** The Finish screen of the batch (the last step, transfer). */
  finishHref: string;
  /** The read-only batch record ("See the full batch record"). */
  fullRecordHref: string;
  /** Packaging step (ADR-088 §3): the wrappers taken at Get materials and the label button. */
  packaging?: StepCardView["packaging"];
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section
        className="rounded-[20px] border border-line bg-surface p-4 sm:p-5"
        aria-label="What to do"
      >
        {step.instruction ? (
          <>
            <p className="whitespace-pre-line text-[18px] leading-snug text-fg">
              {plainWords(step.instruction)}
            </p>
            {(plainWords(step.instruction) !== step.instruction || plainWords(step.name) !== step.name) && (
              <details className="mt-2 text-[13px] text-muted">
                <summary className="min-h-[44px] cursor-pointer py-2">Exact words of the step setup</summary>
                <p className="whitespace-pre-line">{step.name}: {step.instruction}</p>
              </details>
            )}
          </>
        ) : (
          <p className="text-[16px] text-muted">
            No instruction for this step.
          </p>
        )}
        {step.workInstruction && (
          <details className="mt-3 text-[15px]">
            <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">
              See how ({step.workInstruction.code})
            </summary>
            <p className="whitespace-pre-line text-muted">
              {step.workInstruction.bodyMarkdown}
            </p>
          </details>
        )}
        {step.status === "completed" && (
          <p className="mt-3 inline-flex items-center gap-2 text-[17px] font-semibold text-[var(--ok-fg)]">
            <CheckCircle2 size={22} aria-hidden /> Step done
            {step.record?.conductedBy ? ` by ${step.record.conductedBy}` : ""}
          </p>
        )}
        {step.status === "awaiting_check" && (
          <p className="mt-3 text-[16px] font-semibold text-[var(--warn-fg)]">
            Waiting for the second check.
          </p>
        )}
      </section>
      <div className="grid min-w-0 content-start gap-4">
        {p.packaging && <PackagingBox batchId={p.batchId} stepNo={step.stepNo} packaging={p.packaging} canPerform={p.canPerform} done={step.status === "completed"} />}
        {p.equipment && <EquipmentBox {...p} equipment={p.equipment} />}
        {p.blocked && step.status !== "completed" ? (
          <p className="text-[15px] text-muted" data-testid="step-not-yet">This step opens when the earlier steps are done (see the yellow box above).</p>
        ) : step.status === "completed" ? (
          p.nextHref && p.nextLabel ? (
            <Link
              href={p.nextHref}
              className="inline-flex min-h-[56px] w-full items-center justify-center rounded-full bg-cta px-8 text-[17px] font-semibold text-white"
            >
              {p.nextLabel}
            </Link>
          ) : null
        ) : step.status === "awaiting_check" ? (
          <StepCheck {...p} />
        ) : step.isWeighing ? (
          <Link
            href={p.weighHref}
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-full bg-cta px-8 text-[17px] font-semibold text-white"
          >
            Weigh
          </Link>
        ) : step.isTransfer ? (
          <Link
            href={p.finishHref}
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-full bg-cta px-8 text-[17px] font-semibold text-white"
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

/** The equipment used on this step (mixer, mould, pot): pick it from the list; warnings stay on record. */
function EquipmentBox(p: Props & { equipment: NonNullable<Props["equipment"]> }) {
  const { step, equipment } = p;
  const [state, action] = useInPlaceAction(equipmentCardAction);
  const open = step.status === "pending" || step.status === "in_progress";
  return (
    <section className="rounded-[16px] border border-line bg-surface p-4" aria-label="Equipment" data-testid="step-equipment">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-fg">
        <Wrench size={18} aria-hidden /> Equipment for this step
      </h2>
      {equipment.uses.length > 0 ? (
        <p className="mt-1 text-[16px] text-fg-2">
          Using {equipment.uses.map((u) => `${u.code}${u.reasons.length ? ` (warnings: ${u.reasons.join(", ")})` : ""}${u.override ? " (approved)" : ""}`).join(", ")}
        </p>
      ) : (
        <p className="mt-1 text-[15px] text-muted">Choose what you use before Step done.</p>
      )}
      {open && p.canPerform && equipment.canChoose && (
        equipment.options.length ? (
          <form action={action} className="mt-3 grid gap-2">
            <input type="hidden" name="batchId" value={p.batchId} />
            <input type="hidden" name="stepNo" value={step.stepNo} />
            <div className="grid gap-2 sm:grid-cols-2">
              {equipment.options.map((o) => (
                <label key={o.id} className={cx("flex min-h-[56px] cursor-pointer items-center gap-3 rounded-[14px] border px-3 py-2 text-[16px]", o.usable ? "border-line-strong bg-surface" : "border-line bg-surface-2 text-muted")}>
                  <input type="radio" name="equipmentRef" value={o.code} disabled={!o.usable} required className="size-5" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-fg">{o.name}</span>
                    <span className="block text-[13px] text-muted">
                      {o.code}
                      {!o.usable && o.blocking.length ? ` · cannot be used: ${o.blocking.join(", ")}` : o.reasons.length ? ` · ${o.reasons.join(", ")}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
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

function CheckerPick({
  checkers,
  passwordRequired,
}: {
  checkers: Person[];
  passwordRequired: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-[14px] bg-surface-2 p-3">
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Checked by (they pick their name)
        <Select
          name="checkerId"
          defaultValue=""
          className="min-h-[52px] text-[16px]"
        >
          <option value="">Checks later from their own tablet</option>
          {checkers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </Select>
      </label>
      {passwordRequired && (
        <label className="flex flex-col gap-1 text-[15px] font-medium">
          Their password
          <Input
            type="password"
            name="checkerPassword"
            autoComplete="off"
            className="min-h-[52px]"
          />
        </label>
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
              "rounded-[14px] border p-3",
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
                      "inline-flex min-h-[56px] min-w-[88px] items-center justify-center gap-1 rounded-full border text-[17px] font-semibold",
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
          passwordRequired={p.passwordRequired}
        />
      )}
      {p.canPerform && (
        <div className="flex flex-wrap gap-2 rounded-[20px] bg-surface/95 p-2 lg:static">
          {!anyNo && (
            <SubmitButton
              name="allOk"
              value="1"
              variant="cta"
              size="lg"
              pendingText="Saving…"
              className="min-w-[180px] flex-1"
            >
              All OK
            </SubmitButton>
          )}
          <SubmitButton
            variant={anyNo ? "cta" : "secondary"}
            size="lg"
            pendingText="Saving…"
            disabled={!allAnswered}
            className="min-w-[180px] flex-1"
          >
            {anyNo ? "Save and report a problem" : "Save answers"}
          </SubmitButton>
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
      className="rounded-[20px] border border-line bg-surface p-5 text-center"
      data-testid="wait-card"
    >
      <Hourglass size={56} className="mx-auto text-muted" aria-hidden />
      {step.status === "pending" ? (
        <p className="mt-2 text-[20px] font-semibold">
          The wait has not started.
        </p>
      ) : (
        <>
          <p className="mt-2 font-display text-[30px] font-semibold text-fg">
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
          passwordRequired={p.passwordRequired}
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
  passwordRequired,
  label,
}: {
  batchId: string;
  stepNo: number;
  approvers: Person[];
  passwordRequired: boolean;
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
      className="mt-3 grid gap-2 rounded-[14px] bg-surface-2 p-3 text-left"
    >
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="stepNo" value={stepNo} />
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Approved by (they pick their name)
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
      {passwordRequired && (
        <label className="flex flex-col gap-1 text-[15px] font-medium">
          Their password
          <Input
            type="password"
            name="approverPassword"
            autoComplete="off"
            className="min-h-[52px]"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[15px] font-medium">
        Reason
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
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(step.fields.map((f) => [f.id, f.reading?.value ?? ""])),
  );
  const numeric = step.fields.filter((f) => f.valueKind === "numeric");
  const [active, setActive] = useState<string | null>(numeric[0]?.id ?? null);
  const fe = state?.fieldErrors ?? {};
  const set = (id: string, v: string) => setValues({ ...values, [id]: v });
  const changed = (f: FieldDef) =>
    !!f.reading && values[f.id] !== f.reading.value;
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
                  active={active === f.id}
                  onFocus={() => setActive(f.id)}
                  error={
                    fe[`param-${f.id}`] ??
                    (f.reading && !f.reading.isWithinLimits && !changed(f)
                      ? `Outside ${f.limits}`
                      : null)
                  }
                  hint={f.minValue || f.maxValue ? `OK ${f.limits}` : undefined}
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
                          "inline-flex min-h-[56px] flex-1 items-center justify-center rounded-full border text-[17px] font-semibold",
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
                <label className="flex flex-col gap-1 text-[14px] font-medium">
                  Why change it? (the first value stays on record)
                  <Input
                    name={`correction-${f.id}`}
                    className="min-h-[52px] text-[16px]"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
        {activeField && p.canPerform && (
          <Keypad
            value={values[activeField.id] ?? ""}
            onChange={(v) => set(activeField.id, v)}
            decimal={activeField.uom !== "pcs"}
            onSubmit={() =>
              (
                document.getElementById(
                  `done-${step.stepNo}`,
                ) as HTMLButtonElement | null
              )?.click()
            }
            submitLabel="Step done"
          />
        )}
        {step.requiresChecker && (
          <CheckerPick
            checkers={p.checkers}
            passwordRequired={p.passwordRequired}
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
                  defaultValue={f.reading?.value ?? ""}
                  inputMode={f.valueKind === "numeric" ? "decimal" : undefined}
                  className="min-h-[52px] text-[16px]"
                />
                {f.reading && (
                  <span className="text-[13px] font-normal text-muted">
                    Saved: {f.reading.value}
                    {f.reading.isWithinLimits ? "" : " (outside the range)"}. To change it, type the new value and say why:
                    <Input name={`correction-${f.id}`} placeholder="Why change it?" className="mt-1 min-h-[48px] text-[15px]" />
                  </span>
                )}
              </label>
            ))}
          </div>
        </details>
        {step.blockers.length > 0 && (
          <p className="flex items-start gap-2 text-[15px] text-[var(--warn-fg)]">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />{" "}
            {step.blockers
              .map((b) =>
                b.message.replace(
                  /controlled exception with a deviation \(CX-TOL\)/,
                  "approval",
                ),
              )
              .join(" ")}
          </p>
        )}
        {p.canPerform && (
          <div className="rounded-[20px] bg-surface/95 p-2 lg:static">
            <SubmitButton
              id={`done-${step.stepNo}`}
              variant="cta"
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
          passwordRequired={p.passwordRequired}
          label="Ask for approval"
        />
      )}
    </>
  );
}
