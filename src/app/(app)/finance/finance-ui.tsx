import type { ReactNode } from "react";
import { AlertOctagon, Ban, BookCheck, CheckCircle2, CircleDashed, Clock, Lock, PauseCircle, Send, Unlock, XCircle } from "lucide-react";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/qty";
import { Card, CardTitle, Table, Td, cx } from "@/ui/core";
import { FilterTabs } from "@/ui/plain-list";
import { Chip } from "@/ui/status";

/**
 * Shared finance display pieces (server components; grade-5 words, ADR-088). Status = icon + text + colour +
 * border, never colour alone; money always shows two decimals with the peso sign (amounts are numeric strings
 * from the services). The stored states never change, only the words people read.
 */

type Tone = "ok" | "warn" | "bad" | "info" | "neu" | "appr" | "hold" | "rej" | "q" | "exp";
type Icon = typeof CircleDashed;
const TONES: Record<string, { tone: Tone; label: string; I: Icon }> = {
  draft: { tone: "neu", label: "Draft – not sent for approval", I: CircleDashed },
  submitted: { tone: "appr", label: "Waiting for approval", I: PauseCircle },
  approved: { tone: "info", label: "Approved – save to the books next", I: CheckCircle2 },
  issued: { tone: "info", label: "Sent – not paid yet", I: Send },
  partially_paid: { tone: "warn", label: "Part paid", I: Clock },
  paid: { tone: "ok", label: "Paid", I: CheckCircle2 },
  closed: { tone: "neu", label: "Done", I: CheckCircle2 },
  voided: { tone: "neu", label: "Cancelled (kept on record)", I: Ban },
  cancelled: { tone: "neu", label: "Cancelled", I: Ban },
  applied: { tone: "ok", label: "Taken off the invoice", I: CheckCircle2 },
  disputed: { tone: "bad", label: "Does not match – check it", I: AlertOctagon },
  posted: { tone: "info", label: "In the books – to pay", I: BookCheck },
  recorded: { tone: "ok", label: "Saved to the books", I: BookCheck },
  reconciled: { tone: "ok", label: "Checked with the bank", I: CheckCircle2 },
  rejected: { tone: "rej", label: "Not approved", I: XCircle },
  open: { tone: "ok", label: "Open", I: Unlock },
  locked: { tone: "hold", label: "Closed (locked)", I: Lock },
  proposed: { tone: "warn", label: "Waiting for the accountant's check", I: PauseCircle },
  retired: { tone: "neu", label: "No longer used", I: Ban },
  overdue: { tone: "bad", label: "Late", I: AlertOctagon },
};

export function FinanceStatus({ status, label }: { status: string; label?: string }) {
  const t = TONES[status] ?? { tone: "neu" as const, label: status.replace(/_/g, " "), I: CircleDashed };
  return (
    <Chip tone={t.tone}>
      <t.I size={13} aria-hidden />
      {label ?? t.label}
    </Chip>
  );
}

export function Money({ value, className }: { value: string | null | undefined; className?: string }) {
  return <span className={cx("whitespace-nowrap tabular-nums", className)}>{value === null || value === undefined ? "—" : fmtMoney(value)}</span>;
}

/** The amount on the right of a list row: bold, tabular, never wrapped. */
export function RowAmount({ value, note }: { value: string | null | undefined; note?: ReactNode }) {
  return (
    <>
      <Money value={value} className="block font-semibold text-fg" />
      {note && <span className="block text-[12px] text-muted">{note}</span>}
    </>
  );
}

/** Status filter chips (links, so the list stays server-rendered). They wrap on a phone: no sideways scroll. */
export function StatusTabs({ base, current, tabs }: { base: string; current: string; tabs: readonly (readonly [string, string])[] }) {
  return <FilterTabs label="Filter by status" active={current} tabs={tabs.map(([k, l]) => [k, l, k ? `${base}?status=${k}` : base] as const)} />;
}

export type PostingView = { id: string; postingType: string; documentNumber: string; postingDate: string; amount: string; direction: string; periodCode: string; reversalOfId: string | null; reason: string | null; postedAt: Date };
const POSTING_LABEL: Record<string, string> = { invoice_issue: "Invoice saved to the books", bill_post: "Supplier bill saved to the books", payment: "Payment saved to the books", credit_note: "Credit (money back) saved to the books", expense: "Expense saved to the books", reversal: "Cancelled (kept on record)" };

/** The book entries of a document (financial_postings, never edited). Shown inside "More details" on the record pages. */
export function PostingsCard({ postings }: { postings: PostingView[] }) {
  return (
    <div>
      <p className="mb-2 text-[14px] font-semibold">In the books</p>
      {postings.length === 0 ? (
        <p className="text-[14px] text-fg-2">Not in the books yet. Once saved to the books it cannot be changed; a mistake is fixed by cancelling it (kept on record) with a reason.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-[14px]">
          {postings.map((p) => (
            <li key={p.id} className="rounded-[10px] border border-line px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{POSTING_LABEL[p.postingType] ?? p.postingType}</span>
                <Money value={p.amount} className="font-semibold" />
              </div>
              <p className="text-[13px] text-muted">
                Dated {fmtDate(p.postingDate)} · month {p.periodCode} · <span className="font-mono">{p.documentNumber}</span>
              </p>
              {p.reason && <p className="text-[13px] text-muted">Why: {p.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROLE_WORD: Record<string, string> = { site_manager: "the site manager", owner_director: "the owner", finance: "finance", procurement: "purchasing", sales_cs: "sales" };
export const roleWords = (codes: string[]) => codes.map((r) => ROLE_WORD[r] ?? r.replace(/_/g, " ")).join(" or ");

/** "Waiting for finance to approve (step 1 of 2)." from the approval progress. */
export function waitingText(progress: { steps: { step: number }[]; next: { step: number; label: string; roleCodes: string[] } | null } | null | undefined): string {
  const n = progress?.next;
  if (!n) return "Waiting for approval.";
  const who = n.roleCodes.length ? roleWords(n.roleCodes) : n.label;
  return `Waiting for ${who} to approve${progress!.steps.length > 1 ? ` (step ${n.step} of ${progress!.steps.length})` : ""}.`;
}

type Step = { step: number; label: string; roleCodes: string[]; requiredCount: number; done: boolean; approvals: { name: string; at: Date }[] };
/** Approval steps and decisions in words; used inside "More details". */
export function ApprovalCard({ progress, decisions }: { progress: { steps: Step[] } | null; decisions: { id: string; step: number; decision: string; decidedByName: string; decidedAt: Date; note: string | null }[] }) {
  if (!progress && decisions.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-[14px] font-semibold">Approval</p>
      {progress && progress.steps.length > 0 && (
        <ol className="mb-3 flex flex-col gap-1.5 text-[14px]">
          {progress.steps.map((s) => (
            <li key={s.step} className="flex flex-wrap items-center gap-2">
              <FinanceStatus status={s.done ? "paid" : "submitted"} label={s.done ? "Done" : "Waiting"} />
              <span>
                {s.label}
                {s.roleCodes.length ? ` (${roleWords(s.roleCodes)})` : ""}
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
        <ul className="flex flex-col gap-1 text-[13px] text-muted">
          {decisions.map((d) => (
            <li key={d.id}>
              {d.decision === "approved" ? "Approved" : d.decision === "returned" ? "Sent back" : d.decision === "rejected" ? "Not approved" : d.decision} by {d.decidedByName} · {fmtDateTime(d.decidedAt)}
              {d.note ? ` · ${d.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATE_WORD: Record<string, string> = { draft: "draft", submitted: "sent for approval", approved: "approved", issued: "sent out", partially_paid: "part paid", paid: "paid", closed: "done", voided: "cancelled (kept on record)", cancelled: "cancelled", applied: "taken off the invoice", disputed: "does not match", posted: "saved to the books", recorded: "saved to the books", rejected: "not approved", reconciled: "checked with the bank" };
export function HistoryCard({ history }: { history: { id: string; fromState: string | null; toState: string; actorName: string; occurredAt: Date; reason: string | null }[] }) {
  return (
    <div>
      <p className="mb-2 text-[14px] font-semibold">History</p>
      <ul className="flex flex-col gap-1 text-[14px]">
        {history.map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.occurredAt)}</span> · {h.actorName}: <span className="font-medium">{h.fromState ? STATE_WORD[h.toState] ?? h.toState.replace(/_/g, " ") : `made as ${STATE_WORD[h.toState] ?? h.toState}`}</span>
            {h.reason ? <span className="text-muted"> · {h.reason}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A responsive list: cards on phones, a table from `sm` up (no horizontal scroll at 390 px). Kept for other callers. */
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

/** The "Do it now" card that NextStep's button scrolls to. */
export function DoNow({ children }: { children: ReactNode }) {
  return (
    <Card>
      <span id="do" className="block scroll-mt-24" />
      <CardTitle>Do it now</CardTitle>
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}

/** Expense claim states in words (the person who spent the money reads these). */
export const CLAIM_WORD: Record<string, string> = { draft: "Draft – add the receipt and send", submitted: "Waiting for approval", approved: "Approved – finance saves it next", rejected: "Not approved", posted: "To pay back", paid: "Paid back", cancelled: "Taken back", voided: "Cancelled (kept on record)" };

/** "How late" buckets in words (stored bucket keys unchanged). */
export const LATE_WORD: Record<string, string> = { current: "Not due yet", "1_30": "1–30 days late", "31_60": "31–60 days late", "61_90": "61–90 days late", over_90: "More than 90 days late" };

export const FINANCE_SCOPE_NOTE = "Day-to-day money records, not the official books: your accountant's system stays the official ledger.";
