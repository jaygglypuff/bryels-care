import { AlertOctagon, CheckCircle2, CircleDashed, Clock, FileClock, Lock, PauseCircle, Wrench, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { Banner, Chip } from "@/ui/status";
import { Button, Card, CardTitle } from "@/ui/core";

/** Version status with icon + text (never colour alone). label = derived effective/scheduled/superseded. */
export function VersionChip({ status, label }: { status: string; label?: string }) {
  const l = label ?? status;
  if (status === "approved" && l === "effective") return <Chip tone="ok"><CheckCircle2 size={13} /> Approved · effective</Chip>;
  if (status === "approved" && l === "scheduled") return <Chip tone="info"><Clock size={13} /> Approved · scheduled</Chip>;
  if (status === "approved" && l === "superseded") return <Chip tone="exp"><FileClock size={13} /> Superseded</Chip>;
  if (status === "approved") return <Chip tone="ok"><CheckCircle2 size={13} /> Approved</Chip>;
  if (status === "pending_approval") return <Chip tone="appr"><PauseCircle size={13} /> Approval required</Chip>;
  if (status === "rejected") return <Chip tone="rej"><XCircle size={13} /> Rejected</Chip>;
  if (status === "retired") return <Chip tone="neu"><Lock size={13} /> Retired</Chip>;
  return <Chip tone="neu"><CircleDashed size={13} /> Draft</Chip>;
}

export function EffectiveRange({ from, to }: { from: string | null; to: string | null }) {
  if (!from) return <span className="text-muted">Not set</span>;
  return (
    <span className="tabular">
      {fmtDate(from)} → {to ? fmtDate(to) : "open"}
    </span>
  );
}

/** "Verify with authorized personnel" banner shown on every engineering record. */
export function VerifyBanner({ placeholder }: { placeholder?: boolean }) {
  return placeholder ? (
    <Banner tone="warn" title="Placeholder content, pending QA review">
      This record holds fictional demo values. QA must replace and approve the real specification before production use.
    </Banner>
  ) : (
    <p className="text-[12px] text-[var(--warn-fg)]">
      Formula, tolerance, parameter and specification values are configuration owned by the company&apos;s process owners and QA. Verify with authorized personnel before production use.
    </p>
  );
}

/** Plain words for the people of an approval step ("a QA person", "a manager or the owner"). */
const ROLE_WORDS: Record<string, string> = {
  qa_qc: "a QA person",
  site_manager: "a manager",
  owner_director: "the owner",
  production_planner: "a planner",
  finance: "a finance person",
  procurement: "a buyer",
  system_admin: "an administrator",
};
export function roleWords(roles: string[]): string {
  if (!roles.length) return "someone allowed to approve";
  return roles.map((r) => ROLE_WORDS[r] ?? `a ${r.replace(/_/g, " ")}`).join(" or ");
}

/** "Next: a QA person checks it, then a manager or the owner approves. You can't approve your own recipe." */
export function approvalSentence(policy: { step: number; roles: string[] }[], what = "record"): string {
  const steps = [...policy].sort((a, b) => a.step - b.step);
  const own = `You can't approve your own ${what}.`;
  if (!steps.length) return own;
  if (steps.length === 1) return `Next: ${roleWords(steps[0].roles)} approves it. ${own}`;
  const middle = steps.slice(0, -1).map((x) => roleWords(x.roles)).join(", then ");
  return `Next: ${middle} checks it, then ${roleWords(steps[steps.length - 1].roles)} approves. ${own}`;
}

type ApprovalProps = {
  approval: {
    policy: { step: number; label: string; roles: string[] }[];
    decisions: { step: number; decision: string; decidedByName: string; decidedAt: Date; note: string | null }[];
    nextStep: { step: number; label: string } | null;
  };
  status: string;
  children?: ReactNode;
  /** What is approved, for the plain sentence ("recipe", "steps"…). */
  what?: string;
};

/** Approval steps with who decided what, and the decision form slot when the viewer may decide. */
export function ApprovalPanel({ approval, status, children, what }: ApprovalProps) {
  return (
    <Card>
      <CardTitle>Approval</CardTitle>
      {(status === "draft" || status === "pending_approval") && (
      <p className="mb-2 text-[14px] text-fg-2" data-testid="approval-sentence">
        {approvalSentence(approval.policy, what)}
      </p>
      )}
      <ol className="flex flex-col gap-2">
        {approval.policy.map((p) => {
          const d = approval.decisions.find((x) => x.step === p.step);
          const waiting = status === "pending_approval" && approval.nextStep?.step === p.step;
          return (
            <li key={p.step} className="flex flex-wrap items-start justify-between gap-2 rounded-[12px] border border-line px-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">
                  Step {p.step}: {p.label}
                </p>
                <p className="text-[12px] text-muted">By {roleWords(p.roles)} (not the person who wrote or sent it)</p>
                {d?.note && <p className="mt-1 text-[12px] text-fg-2">“{d.note}”</p>}
              </div>
              {d ? (
                <Chip tone={d.decision === "approved" ? "ok" : "rej"}>
                  {d.decision === "approved" ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {d.decidedByName} · {fmtDateTime(d.decidedAt)}
                </Chip>
              ) : waiting ? (
                <Chip tone="appr">
                  <PauseCircle size={13} /> Waiting
                </Chip>
              ) : (
                <Chip tone="neu">—</Chip>
              )}
            </li>
          );
        })}
      </ol>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

const REASON_LABEL: Record<string, string> = {
  out_of_service: "Out of service",
  calibration_due: "Calibration due",
  maintenance_due: "Maintenance due",
  cleaning_required: "Cleaning required",
  qualification_pending: "Qualification pending",
};

/** Derived availability: Available, Warning (recorded on use), Blocked, or Override approved. */
export function AvailabilityChip({ a }: { a: { available: boolean; selectable: boolean; reasons: { code: string }[]; usable?: boolean } }) {
  if (a.available) return <Chip tone="ok"><CheckCircle2 size={13} /> Available</Chip>;
  if (a.selectable) return <Chip tone="warn"><AlertOctagon size={13} /> Warning: {a.reasons.map((r) => REASON_LABEL[r.code] ?? r.code).join(", ")}</Chip>;
  if (a.usable) return <Chip tone="appr"><Wrench size={13} /> Override approved</Chip>;
  return <Chip tone="bad"><Lock size={13} /> Blocked: {a.reasons.map((r) => REASON_LABEL[r.code] ?? r.code).join(", ")}</Chip>;
}

/** Error boundary content shared by the engineering pages. */
export function EngError({ reset }: { reset: () => void }) {
  return (
    <Banner tone="bad" title="This page could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your system administrator.
    </Banner>
  );
}

export function EngLoading({ what }: { what: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading {what}…</span>
      <div className="h-8 w-56 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="h-[120px] animate-pulse rounded-[24px] bg-surface" />
      <div className="h-[260px] animate-pulse rounded-[24px] bg-surface" />
    </div>
  );
}
