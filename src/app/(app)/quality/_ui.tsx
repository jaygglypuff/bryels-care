import type { ReactNode } from "react";
import { AlertOctagon, ArrowRight, Ban, CheckCircle2, CircleDashed, Clock, Lock, PauseCircle, Search, XCircle } from "lucide-react";
import { fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { Chip, StatusChip } from "@/ui/status";

/** Lot quantity in its base unit: grams shown as g/kg, pieces as whole numbers. */
export function fmtLotQty(v: string | null | undefined, uom: string | null | undefined) {
  if (uom === "g") return fmtMass(v);
  if (uom === "pcs") return fmtQty(v, "pcs", 0);
  return fmtQty(v, uom ?? "", 1);
}

/**
 * Grade-5 words for quality (owner review 2026-10-30, ADR-088). Data and permission names stay; only what
 * the screen says changes. Printed records and exports keep their configured wording (QA sign-off).
 */
export const QA_STATUS_WORD: Record<string, string> = {
  released: "OK to use",
  quarantine: "Waiting for QA check",
  quarantined: "Waiting for QA check",
  awaiting_qc: "Waiting for QA check",
  on_hold: "Stopped by QA",
  rejected: "Not OK – don't use",
  recalled: "Recalled – don't use",
  expired: "Expired – don't use",
  closed: "Finished",
};

export const qaWord = (status: string) => QA_STATUS_WORD[status] ?? status.replace(/_/g, " ");

/** Lot or batch status in grade-5 words, with its icon and colour (never colour alone). */
export function QaStatusChip({ status }: { status: string }) {
  return <StatusChip status={status} label={QA_STATUS_WORD[status]} />;
}

const DECISION_LABEL: Record<string, string> = {
  release: "OK to use",
  release_from_hold: "OK to use again",
  hold: "Stopped by QA",
  reject: "Not OK – don't use",
};

export function DecisionChip({ decision }: { decision: string }) {
  const tone = decision === "reject" ? "rej" : decision === "hold" ? "hold" : "ok";
  const icon = decision === "reject" ? <XCircle size={13} aria-hidden /> : decision === "hold" ? <PauseCircle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />;
  return (
    <Chip tone={tone}>
      {icon}
      {DECISION_LABEL[decision] ?? decision}
    </Chip>
  );
}

export function Transition({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <QaStatusChip status={from} />
      <ArrowRight size={13} className="text-muted" aria-label="to" />
      <QaStatusChip status={to} />
    </span>
  );
}

/** Banner tone for a lot or batch status. */
export function statusTone(status: string) {
  return (
    ({ released: "ok", quarantine: "q", quarantined: "q", on_hold: "hold", rejected: "rej", expired: "exp", recalled: "bad", awaiting_qc: "appr" } as const)[status] ?? "neu"
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "neu" | "q" | "hold" | "exp" | "rej" | "appr";

/** A chip with an icon: the plain word, a colour and a shape (never colour alone). */
export function WordChip({ tone, icon, children }: { tone: Tone; icon: "ok" | "wait" | "stop" | "bad" | "new" | "check" | "lock" | "off" | "clock"; children: ReactNode }) {
  const I = { ok: CheckCircle2, wait: PauseCircle, stop: PauseCircle, bad: XCircle, new: AlertOctagon, check: Search, lock: Lock, off: Ban, clock: Clock }[icon] ?? CircleDashed;
  return (
    <Chip tone={tone}>
      <I size={13} aria-hidden />
      {children}
    </Chip>
  );
}

/** Quality check (inspection) state in plain words (data-model §6.6 states unchanged). */
const INSPECTION_WORD: Record<string, [string, Tone, Parameters<typeof WordChip>[0]["icon"]]> = {
  pending: ["Not started", "neu", "wait"],
  in_progress: ["Testing", "info", "check"],
  awaiting_review: ["Waiting for a second QA person", "appr", "wait"],
  approved: ["Checked", "ok", "ok"],
  rejected: ["Not accepted – test again", "rej", "bad"],
  cancelled: ["Cancelled", "neu", "off"],
};

export function InspectionStatusChip({ status, outcome }: { status: string; outcome?: string | null }) {
  const [label, tone, icon] = INSPECTION_WORD[status] ?? [status, "neu", "wait"];
  if (status === "approved") {
    return outcome === "fail" ? <WordChip tone="bad" icon="bad">Checked · not OK</WordChip> : <WordChip tone="ok" icon="ok">Checked · OK</WordChip>;
  }
  return (
    <WordChip tone={tone} icon={icon}>
      {label}
    </WordChip>
  );
}

export const inspectionWord = (status: string) => INSPECTION_WORD[status]?.[0] ?? status.replace(/_/g, " ");

/** Problem report (deviation) state: open → investigating → closed. */
export function DeviationStatusChip({ status }: { status: string }) {
  if (status === "open") return <WordChip tone="bad" icon="new">New – QA to look</WordChip>;
  if (status === "investigating") return <WordChip tone="warn" icon="check">QA is looking into it</WordChip>;
  return <WordChip tone="neu" icon="ok">Closed</WordChip>;
}

/** Past QA decisions as a list (works on a phone): decision, who and when, why, status change. */
export function DecisionHistory({ rows }: { rows: { id: string; decision: string; fromStatus: string; toStatus: string; reason: string | null; decidedAt: Date | string; decidedByName: string }[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((h) => (
        <li key={h.id} className="flex flex-col gap-1 py-2.5 text-[14px]">
          <span className="flex flex-wrap items-center gap-2">
            <DecisionChip decision={h.decision} />
            <span className="text-[13px] text-fg-2">
              {h.decidedByName}, {fmtDateTime(h.decidedAt)}
            </span>
          </span>
          {h.reason && <span className="text-fg-2">“{h.reason}”</span>}
          <span className="text-[12px]">
            <Transition from={h.fromStatus} to={h.toStatus} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Timeline of a record ("who did what, when") in plain words. */
export function Timeline({ rows, word = (s: string) => s.replace(/_/g, " ") }: { rows: { at: Date | string; by: string; from?: string | null; to: string; reason?: string | null }[]; word?: (s: string) => string }) {
  if (rows.length === 0) return <p className="text-[13px] text-muted">Nothing happened yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-line text-[13px]">
      {rows.map((t, i) => (
        <li key={i} className="py-1.5">
          <span className="text-muted">{fmtDateTime(t.at)}</span> · <span className="font-medium">{t.by}</span>: {t.from ? `${word(t.from)} → ` : ""}
          {word(t.to)}
          {t.reason ? <span className="text-fg-2"> — “{t.reason}”</span> : ""}
        </li>
      ))}
    </ol>
  );
}

/** A QA stop (hold) in plain words: open → investigating → closed. */
export function HoldChip({ status }: { status: string }) {
  if (status === "open") return <WordChip tone="hold" icon="stop">Stopped by QA</WordChip>;
  if (status === "investigating") return <WordChip tone="appr" icon="check">QA is looking into it</WordChip>;
  return <WordChip tone="neu" icon="ok">No longer stopped</WordChip>;
}

/** Plain words for the record kinds this module links to. */
export const WORD = {
  deviation: "problem report",
  deviations: "problem reports",
  capa: "fix-and-prevent plan",
  capas: "fix-and-prevent plans",
  change: "change request",
  recall: "product recall",
  trace: "where it came from and where it went",
  inspection: "quality check",
} as const;
