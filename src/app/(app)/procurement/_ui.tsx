import Link from "next/link";
import type { ReactNode } from "react";
import Decimal from "decimal.js";
import { Ban, CheckCircle2, CircleDashed, PackageCheck, PauseCircle, Send, Truck, XCircle } from "lucide-react";
import { PO_STATUS_LABEL, PR_STATUS_LABEL, SR_STATUS_LABEL, type PoStatus, type PrStatus, type SrStatus } from "@/modules/procurement";
import { fmtDateTime } from "@/lib/qty";
import { cx } from "@/ui/core";
import { Chip } from "@/ui/status";

/**
 * Shared display helpers of the purchasing screens (Wave 4 W4A; grade-5 words ADR-088). No business logic here:
 * the stored states stay, only the words people read change.
 */

type Tone = "neu" | "appr" | "info" | "q" | "ok" | "warn" | "bad";
type Icon = typeof CircleDashed;

const PO_TONE: Record<PoStatus, Tone> = { draft: "neu", submitted: "appr", approved: "info", sent: "info", partially_received: "q", received: "ok", closed: "neu", cancelled: "neu" };
const PO_WORD: Record<PoStatus, string> = {
  draft: "Draft – not sent for approval",
  submitted: "Waiting for approval",
  approved: "Approved – send it to the supplier",
  sent: "Sent – waiting for the delivery",
  partially_received: "Part delivered",
  received: "All delivered",
  closed: "Done",
  cancelled: "Cancelled (kept on record)",
};
const PO_ICON: Record<PoStatus, Icon> = { draft: CircleDashed, submitted: PauseCircle, approved: CheckCircle2, sent: Send, partially_received: Truck, received: PackageCheck, closed: CheckCircle2, cancelled: Ban };

const PR_TONE: Record<PrStatus, Tone> = { draft: "neu", submitted: "appr", approved: "ok", rejected: "bad", converted: "info", cancelled: "neu" };
const PR_WORD: Record<PrStatus, string> = {
  draft: "Draft – not sent for approval",
  submitted: "Waiting for approval",
  approved: "Approved – ready to order",
  rejected: "Not approved",
  converted: "Ordered",
  cancelled: "Cancelled (kept on record)",
};
const PR_ICON: Record<PrStatus, Icon> = { draft: CircleDashed, submitted: PauseCircle, approved: CheckCircle2, rejected: XCircle, converted: Send, cancelled: Ban };

const SR_TONE: Record<SrStatus, Tone> = { draft: "neu", submitted: "appr", approved: "info", posted: "ok", cancelled: "neu" };
const SR_WORD: Record<SrStatus, string> = {
  draft: "Draft – add what goes back",
  submitted: "Waiting for approval",
  approved: "Approved – send the goods back",
  posted: "Sent back",
  cancelled: "Cancelled (kept on record)",
};
const SR_ICON: Record<SrStatus, Icon> = { draft: CircleDashed, submitted: PauseCircle, approved: CheckCircle2, posted: Truck, cancelled: Ban };

function StateChip({ tone, word, I }: { tone: Tone; word: string; I: Icon }) {
  return (
    <Chip tone={tone}>
      <I size={13} aria-hidden />
      {word}
    </Chip>
  );
}

export const PoChip = ({ status }: { status: string }) => <StateChip tone={PO_TONE[status as PoStatus] ?? "neu"} word={PO_WORD[status as PoStatus] ?? PO_STATUS_LABEL[status as PoStatus] ?? status} I={PO_ICON[status as PoStatus] ?? CircleDashed} />;
export const PrChip = ({ status }: { status: string }) => <StateChip tone={PR_TONE[status as PrStatus] ?? "neu"} word={PR_WORD[status as PrStatus] ?? PR_STATUS_LABEL[status as PrStatus] ?? status} I={PR_ICON[status as PrStatus] ?? CircleDashed} />;
export const SrChip = ({ status }: { status: string }) => <StateChip tone={SR_TONE[status as SrStatus] ?? "neu"} word={SR_WORD[status as SrStatus] ?? SR_STATUS_LABEL[status as SrStatus] ?? status} I={SR_ICON[status as SrStatus] ?? CircleDashed} />;

/** Plain word of a stored state for the history list (all three records share most states). */
const STATE_WORD: Record<string, string> = {
  draft: "draft",
  submitted: "sent for approval",
  approved: "approved",
  rejected: "not approved",
  converted: "ordered",
  sent: "sent to the supplier",
  partially_received: "part delivered",
  received: "all delivered",
  closed: "done",
  posted: "sent back",
  cancelled: "cancelled",
};
export const stateWord = (s: string | null | undefined) => (s ? STATE_WORD[s] ?? s.replace(/_/g, " ") : "—");

/** Who decides the next approval step, in words ("the site manager"). */
const ROLE_WORD: Record<string, string> = {
  site_manager: "the site manager",
  owner_director: "the owner",
  finance: "finance",
  procurement: "purchasing",
  qa_qc: "QA",
  warehouse_operator: "the warehouse",
  system_admin: "the administrator",
};
export function approverWords(next: { label: string; roleCodes: string[] } | null | undefined): string {
  if (!next) return "the approver";
  if (next.roleCodes.length) return next.roleCodes.map((r) => ROLE_WORD[r] ?? r.replace(/_/g, " ")).join(" or ");
  return next.label;
}

/** Base-unit quantity shown in the purchase unit people use (g → kg, mL → L). */
export function fmtBase(qty: string | number | null | undefined, uom: string): string {
  if (qty === null || qty === undefined) return "—";
  const d = new Decimal(qty);
  const n = (x: Decimal) => x.toDecimalPlaces(3).toNumber().toLocaleString("en-PH", { maximumFractionDigits: 3 });
  if (uom === "g" && d.abs().gte(1000)) return `${n(d.div(1000))} kg`;
  if (uom === "mL" && d.abs().gte(1000)) return `${n(d.div(1000))} L`;
  return `${n(d)} ${uom}`;
}

/** Money with the peso sign and two decimals ("₱12,500.00"); other currencies keep their code. Display only. */
export function money(v: string | null | undefined, currency = "PHP"): string {
  if (v === null || v === undefined) return "—";
  const s = new Decimal(v).toNumber().toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "PHP" ? `₱${s}` : `${currency} ${s}`;
}

/** Other purchasing screens: wrapped chips from 640 px; folded under one line on a phone (no sideways scroll). */
export function SubNav() {
  const items: [string, string][] = [
    ["/procurement", "Purchasing home"],
    ["/procurement/requests", "Requests to buy"],
    ["/procurement/orders", "Purchase orders"],
    ["/procurement/expected", "Deliveries coming"],
    ["/procurement/returns", "Send back to supplier"],
    ["/procurement/suppliers", "Suppliers we may buy from"],
    ["/procurement/reorder", "Running low"],
    ["/procurement/performance", "How suppliers do"],
    ["/procurement/forecast", "Sales guess"],
  ];
  const links = items.map(([href, label]) => (
    <Link key={href} href={href} className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-line px-4 text-[14px] hover:bg-surface-2">
      {label}
    </Link>
  ));
  return (
    <>
      <details className="mb-4 sm:hidden">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Other purchasing screens</summary>
        <nav aria-label="Purchasing" className="mt-2 flex flex-wrap gap-2">
          {links}
        </nav>
      </details>
      <nav aria-label="Purchasing" className="mb-4 hidden flex-wrap gap-2 sm:flex">
        {links}
      </nav>
    </>
  );
}

/** Approval steps in plain words. */
export function Steps({ steps }: { steps: { step: number; label: string; roleCodes?: string[]; done: boolean; approvals: { name: string; at: Date }[] }[] }): ReactNode {
  if (!steps.length) return <p className="text-[14px] text-fg-2">One person who may approve decides (no extra steps set up).</p>;
  return (
    <ol className="flex flex-col gap-2 text-[14px]">
      {steps.map((s) => (
        <li key={s.step} className="flex flex-wrap items-center gap-2">
          {s.done ? (
            <Chip tone="ok">
              <CheckCircle2 size={13} aria-hidden /> Done
            </Chip>
          ) : (
            <Chip tone="appr">
              <PauseCircle size={13} aria-hidden /> Waiting
            </Chip>
          )}
          <span>
            {s.label}
            {s.done ? ` — approved by ${s.approvals.map((a) => a.name).join(", ")}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What happened, newest last, in plain words. */
export function History({ rows }: { rows: { id: string; occurredAt: Date; fromState: string | null; toState: string; actorName: string; reason: string | null }[] }) {
  return (
    <ol className="flex flex-col gap-1.5 text-[14px]">
      {rows.map((t) => (
        <li key={t.id}>
          <span className="text-muted">{fmtDateTime(t.occurredAt)}</span> · {t.actorName}: <strong>{stateWord(t.toState)}</strong>
          {t.reason ? ` — ${t.reason}` : ""}
        </li>
      ))}
    </ol>
  );
}

/** The amount on the right of a list row: tabular, right-aligned, never wrapped. */
export function Amount({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("whitespace-nowrap font-semibold tabular-nums text-fg", className)}>{children}</span>;
}

/** Supplier quality status in words (stored values unchanged). */
const SUP_WORD: Record<string, { tone: Tone; word: string; I: Icon }> = {
  approved: { tone: "ok", word: "OK to buy from", I: CheckCircle2 },
  conditional: { tone: "warn", word: "OK with conditions", I: PauseCircle },
  new: { tone: "warn", word: "New – QA to check", I: CircleDashed },
  suspended: { tone: "bad", word: "Stopped – do not buy", I: Ban },
};
export function SupplierChip({ status }: { status: string }) {
  const s = SUP_WORD[status] ?? { tone: "neu" as Tone, word: status, I: CircleDashed };
  return <StateChip tone={s.tone} word={s.word} I={s.I} />;
}
