"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Hourglass, XCircle } from "lucide-react";
import { useState } from "react";
import type { StepCardView } from "@/modules/production";
import { Button, cx, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Keypad, KeypadField } from "@/ui/keypad";
import {
  checklistCardAction,
  checkStepAction,
  endEarlyAction,
  stepDoneAction,
} from "../../flow-actions";

/** Second check of a step on this tablet: pick a name, then a confirm addressed to the checker (2 taps, ADR-078). */
function StepCheck(p: Props) {
  const { step } = p;
  const [state, action] = useInPlaceAction(checkStepAction);
  const [who, setWho] = useState<Person | null>(null);
  const others = p.checkers.filter((c) => c.id !== step.record?.conductedById);
  if (!who)
    return (
      <section className="rounded-[20px] border-2 border-[var(--warn-bd)] bg-surface p-5" aria-label="Second check">
        <h2 className="text-[22px] font-semibold text-fg">Second check needed</h2>
        <p className="mt-1 text-[16px] text-muted">Ask someone to check {step.name}. They pick their name.</p>
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
        {who.displayName}, you checked {step.name}
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
  fullRecordHref: string;
};

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
          <p className="whitespace-pre-line text-[18px] leading-snug text-fg">
            {step.instruction}
          </p>
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
      <div className="min-w-0">
        {step.status === "completed" ? (
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
            href={p.fullRecordHref}
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
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] flex flex-wrap gap-2 rounded-[20px] bg-surface/95 p-2 lg:static">
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
          value={step.fields.map((f) => f.id).join(",")}
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
                  label={f.name}
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
            {(step.moreFields.length > 0 || step.requiresEquipment) && (
              <Link
                href={p.fullRecordHref}
                className="text-primary-text underline"
              >
                {step.requiresEquipment
                  ? "Choose the equipment"
                  : "More fields"}{" "}
                on the full batch record
              </Link>
            )}
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
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] rounded-[20px] bg-surface/95 p-2 lg:static">
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
