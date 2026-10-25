import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/qty";
import { Card, CardTitle, Table, Td, cx } from "@/ui/core";
import { Chip } from "@/ui/status";

/**
 * Shared finance display pieces (server components). Status = text + colour + border, never colour alone;
 * money always shows two decimals with the currency symbol (amounts are numeric strings from the services).
 */

type Tone = "ok" | "warn" | "bad" | "info" | "neu" | "appr" | "hold" | "rej" | "q" | "exp";
const TONES: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neu", label: "Draft" },
  submitted: { tone: "info", label: "Waiting for approval" },
  approved: { tone: "appr", label: "Approved" },
  issued: { tone: "info", label: "Issued" },
  partially_paid: { tone: "warn", label: "Partially paid" },
  paid: { tone: "ok", label: "Paid" },
  closed: { tone: "neu", label: "Closed" },
  voided: { tone: "neu", label: "Voided" },
  cancelled: { tone: "neu", label: "Cancelled" },
  applied: { tone: "ok", label: "Applied" },
  disputed: { tone: "bad", label: "Disputed" },
  posted: { tone: "info", label: "Posted" },
  recorded: { tone: "ok", label: "Recorded" },
  reconciled: { tone: "ok", label: "Reconciled" },
  rejected: { tone: "rej", label: "Rejected" },
  open: { tone: "ok", label: "Open" },
  locked: { tone: "hold", label: "Locked" },
  proposed: { tone: "warn", label: "Pending accountant review" },
  retired: { tone: "neu", label: "Retired" },
  overdue: { tone: "bad", label: "Overdue" },
};

export function FinanceStatus({ status, label }: { status: string; label?: string }) {
  const t = TONES[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " ") };
  return <Chip tone={t.tone}>{label ?? t.label}</Chip>;
}

export function Money({ value, className }: { value: string | null | undefined; className?: string }) {
  return <span className={cx("tabular-nums", className)}>{value === null || value === undefined ? "—" : fmtMoney(value)}</span>;
}

/** Status filter tabs (links, so the list stays server-rendered). */
export function StatusTabs({ base, current, tabs }: { base: string; current: string; tabs: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-1">
      {tabs.map(([k, l]) => (
        <Link
          key={k || "all"}
          href={k ? `${base}?status=${k}` : base}
          aria-current={k === current ? "page" : undefined}
          className={cx("inline-flex min-h-[40px] items-center whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium", k === current ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}
        >
          {l}
        </Link>
      ))}
    </nav>
  );
}

export type PostingView = { id: string; postingType: string; documentNumber: string; postingDate: string; amount: string; direction: string; periodCode: string; reversalOfId: string | null; reason: string | null; postedAt: Date };
const POSTING_LABEL: Record<string, string> = { invoice_issue: "Invoice issued", bill_post: "Bill posted", payment: "Payment", credit_note: "Credit note", expense: "Expense", reversal: "Reversal" };

/** The immutable ledger rows of a document (financial_postings). */
export function PostingsCard({ postings }: { postings: PostingView[] }) {
  return (
    <Card>
      <CardTitle>Postings</CardTitle>
      {postings.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing is posted yet. Posting writes an immutable ledger row; corrections are reversals with a reason.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-[13px]">
          {postings.map((p) => (
            <li key={p.id} className="rounded-[10px] border border-line px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{POSTING_LABEL[p.postingType] ?? p.postingType}</span>
                <Money value={p.amount} className="font-semibold" />
              </div>
              <p className="text-muted">
                {p.documentNumber} · dated {fmtDate(p.postingDate)} · period {p.periodCode} · {p.direction}
              </p>
              {p.reason && <p className="text-muted">Reason: {p.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Step = { step: number; label: string; roleCodes: string[]; requiredCount: number; done: boolean; approvals: { name: string; at: Date }[] };
export function ApprovalCard({ progress, decisions }: { progress: { steps: Step[] } | null; decisions: { id: string; step: number; decision: string; decidedByName: string; decidedAt: Date; note: string | null }[] }) {
  if (!progress && decisions.length === 0) return null;
  return (
    <Card>
      <CardTitle>Approval</CardTitle>
      {progress && progress.steps.length > 0 && (
        <ol className="mb-3 flex flex-col gap-1.5 text-[13px]">
          {progress.steps.map((s) => (
            <li key={s.step} className="flex flex-wrap items-center gap-2">
              <FinanceStatus status={s.done ? "approved" : "submitted"} label={s.done ? "Done" : "Open"} />
              <span>
                Step {s.step}: {s.label}
                {s.roleCodes.length ? ` (${s.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ")})` : ""}
              </span>
              {s.approvals.map((a) => (
                <span key={a.name + a.at.toISOString()} className="text-muted">
                  · {a.name}, {fmtDateTime(a.at)}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
      {decisions.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12px] text-muted">
          {decisions.map((d) => (
            <li key={d.id}>
              Step {d.step}: {d.decision} by {d.decidedByName} · {fmtDateTime(d.decidedAt)}
              {d.note ? ` · ${d.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function HistoryCard({ history }: { history: { id: string; fromState: string | null; toState: string; actorName: string; occurredAt: Date; reason: string | null }[] }) {
  return (
    <Card>
      <CardTitle>History</CardTitle>
      <ul className="flex flex-col gap-1 text-[13px]">
        {history.map((h) => (
          <li key={h.id}>
            {h.fromState ? `${h.fromState.replace(/_/g, " ")} → ` : "Created as "}
            <span className="font-medium">{h.toState.replace(/_/g, " ")}</span> · {h.actorName} · {fmtDateTime(h.occurredAt)}
            {h.reason ? <span className="text-muted"> · {h.reason}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A responsive list: cards on phones, a table from `sm` up (no horizontal scroll at 390 px). */
export function ResponsiveList<R>({ rows, head, cells, mobile, rowKey }: { rows: R[]; head: string[]; cells: (r: R) => ReactNode[]; mobile: (r: R) => ReactNode; rowKey: (r: R) => string }) {
  return (
    <>
      <ul className="flex flex-col gap-3 sm:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>{mobile(r)}</li>
        ))}
      </ul>
      <Table className="hidden sm:block" head={head}>
        {rows.map((r) => (
          <tr key={rowKey(r)} className="hover:bg-surface-2">
            {cells(r).map((c, i) => (
              <Td key={i}>{c}</Td>
            ))}
          </tr>
        ))}
      </Table>
    </>
  );
}

export const FINANCE_SCOPE_NOTE = "Operational finance support (not the books of record): your accountant's system stays the general ledger.";
