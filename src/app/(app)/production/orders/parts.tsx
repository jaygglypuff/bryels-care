import { AlertTriangle, CheckCircle2, Clock, Hourglass } from "lucide-react";
import Link from "next/link";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { PRODUCTION_ORDER_CHIP, type DefectSummary, type NextAction, type ProductionOrderStatus } from "@/modules/production";
import { LinkButton, Table, Td, cx } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";

/** Shared server pieces of the production order screens (ADR-074, ADR-080). */

/** One chip per card (ADR-080 §1): status, then the subtitle ("In progress · Curing until Fri 28 Nov"); amber for "On hold". */
export function OrderStatusChip({ status, label, subtitle, warn }: { status: ProductionOrderStatus; label: string; subtitle?: string | null; warn?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusChip status={warn ? "on_hold" : PRODUCTION_ORDER_CHIP[status]} label={subtitle ? `${label} · ${subtitle}` : label} />
    </span>
  );
}

/** "Needed by Fri 15 Dec", red with a clock icon and the word "Late" when it has passed (never colour alone). */
export function NeededBy({ date, late }: { date: string | null; late: boolean }) {
  if (!date) return null;
  return late ? (
    <Chip tone="bad">
      <Clock size={13} aria-hidden /> Late · needed by {fmtDate(date)}
    </Chip>
  ) : (
    <span className="text-[13px] text-muted">Needed by {fmtDate(date)}</span>
  );
}

/** The five-step strip (Draft → Approved → In progress → Quality check → Done) with the step note under In progress. */
export function ProgressStrip({ steps, note }: { steps: { key: string; label: string; state: string }[]; note?: string | null }) {
  return (
    <div>
      <ol className="grid grid-cols-5 gap-1.5" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className="min-w-0">
            <div className={cx("h-2 rounded-full", s.state === "done" ? "bg-[var(--ok-fg)]" : s.state === "current" ? "bg-primary" : "bg-surface-2")} />
            <p className={cx("mt-1.5 flex items-center gap-1 text-[12px] leading-tight sm:text-[13px]", s.state === "current" ? "font-semibold text-fg" : "text-muted")}>
              {s.state === "done" && <CheckCircle2 size={13} aria-hidden className="shrink-0" />}
              <span className="min-w-0 break-words">
                {i + 1}. {s.label}
              </span>
            </p>
          </li>
        ))}
      </ol>
      {note && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-2">
          {/until|time over/.test(note) && <Hourglass size={14} aria-hidden />}
          {note}
        </p>
      )}
    </div>
  );
}

/** The next action of an order or batch: a big button, a wait with who can help, or a sentence. Never a fake button. */
export function ActionButton({ a, size = "lg", approve }: { a: NextAction; size?: "lg" | "md"; approve?: React.ReactNode }) {
  if (a.kind === "approve") return <>{approve}</>;
  if (a.kind === "link")
    return (
      <LinkButton href={a.href} variant="cta" size={size} className="w-full justify-center sm:w-auto">
        {a.label}
      </LinkButton>
    );
  if (a.kind === "wait")
    return (
      <div className="text-[14px]">
        <p className="flex items-center gap-1.5 font-medium">
          <Hourglass size={14} aria-hidden /> {a.title}
        </p>
        {a.who && <WhoCanHelp permission={a.who.permission} siteId={a.who.siteId} />}
      </div>
    );
  return null;
}

/** "1 of 2 batches failed" on a Done order (warning chip with icon). */
export function OrderWarning({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Chip tone="warn">
      <AlertTriangle size={13} aria-hidden /> {text}
    </Chip>
  );
}

export function OrderLink({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={`/production/orders/${id}`} className={className}>
      {children}
    </Link>
  );
}

const n = (v: string) => fmtQty(v, "", D(v).isInteger() ? 0 : 1);

/** Good vs rejects per product and day, then reject % by type (UX word list: "Rejects", "Reject type"). */
export function DefectTables({ summary, showProduct = true }: { summary: DefectSummary; showProduct?: boolean }) {
  if (summary.rows.length === 0) return <p className="text-[14px] text-muted">Nothing recorded yet.</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-[14px] border border-line p-3">
          <p className="text-[12px] text-muted">Good pieces</p>
          <p className="text-[20px] font-semibold tabular">{n(summary.totals.good)}</p>
        </div>
        <div className="rounded-[14px] border border-line p-3">
          <p className="text-[12px] text-muted">Rejects</p>
          <p className="text-[20px] font-semibold tabular">{n(summary.totals.defects)}</p>
        </div>
        <div className="rounded-[14px] border border-line p-3">
          <p className="text-[12px] text-muted">Reject rate</p>
          <p className="text-[20px] font-semibold tabular">{summary.totals.defectPct ? `${summary.totals.defectPct}%` : "—"}</p>
        </div>
      </div>
      {summary.totals.byType.length > 0 && (
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">Rejects by type</h3>
          <ul className="space-y-1.5">
            {summary.totals.byType.map((t) => (
              <li key={t.type} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px]">
                <span>{t.type}</span>
                <span className="tabular text-fg-2">
                  {n(t.qty)} · {t.pctOfDefects}% of rejects · {t.pctOfMade}% of all made
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showProduct && summary.byProduct.length > 1 && (
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">By product</h3>
          <Table head={["Product", "Good", "Rejects", "Reject rate"]}>
            {summary.byProduct.map((p) => (
              <tr key={p.productId}>
                <Td>{p.productName}</Td>
                <Td className="tabular">{n(p.good)}</Td>
                <Td className="tabular">{n(p.defects)}</Td>
                <Td className="tabular">{p.defectPct ? `${p.defectPct}%` : "—"}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-[14px] font-semibold">By day</h3>
        <Table head={showProduct ? ["Day", "Product", "Good", "Rejects", "Reject rate"] : ["Day", "Good", "Rejects", "Reject rate"]}>
          {summary.rows.map((r) => (
            <tr key={`${r.productId}-${r.logDate}`}>
              <Td className="whitespace-nowrap">{fmtDate(r.logDate)}</Td>
              {showProduct && <Td>{r.productName}</Td>}
              <Td className="tabular">{n(r.good)}</Td>
              <Td className="tabular" title={Object.entries(r.byType).map(([t, q]) => `${t}: ${n(q)}`).join(", ")}>
                {n(r.defects)}
              </Td>
              <Td className="tabular">{r.defectPct ? `${r.defectPct}%` : "—"}</Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
