import { CheckCircle2 } from "lucide-react";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { PRODUCTION_ORDER_CHIP, type DefectSummary, type ProductionOrderStatus } from "@/modules/production";
import { Table, Td, cx } from "@/ui/core";
import { StatusChip } from "@/ui/status";

/** Shared server pieces of the production order screens (ADR-074). */

export function OrderStatusChip({ status, label }: { status: ProductionOrderStatus; label: string }) {
  return <StatusChip status={PRODUCTION_ORDER_CHIP[status]} label={label} />;
}

export function ProgressStrip({ steps }: { steps: { key: string; label: string; state: string }[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className="min-w-0">
          <div className={cx("h-2 rounded-full", s.state === "done" ? "bg-[var(--ok-fg)]" : s.state === "current" ? "bg-primary" : "bg-surface-2")} />
          <p className={cx("mt-1.5 flex items-center gap-1 truncate text-[12px] sm:text-[13px]", s.state === "current" ? "font-semibold text-fg" : "text-muted")}>
            {s.state === "done" && <CheckCircle2 size={13} aria-hidden />}
            <span className="truncate">
              {i + 1}. {s.label}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
}

const n = (v: string) => fmtQty(v, "", D(v).isInteger() ? 0 : 1);

/** Good vs defects per product and day, then defect % by type. */
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
          <p className="text-[12px] text-muted">Defects</p>
          <p className="text-[20px] font-semibold tabular">{n(summary.totals.defects)}</p>
        </div>
        <div className="rounded-[14px] border border-line p-3">
          <p className="text-[12px] text-muted">Defect rate</p>
          <p className="text-[20px] font-semibold tabular">{summary.totals.defectPct ? `${summary.totals.defectPct}%` : "—"}</p>
        </div>
      </div>
      {summary.totals.byType.length > 0 && (
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">Defects by type</h3>
          <ul className="space-y-1.5">
            {summary.totals.byType.map((t) => (
              <li key={t.type} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px]">
                <span>{t.type}</span>
                <span className="tabular text-fg-2">
                  {n(t.qty)} · {t.pctOfDefects}% of defects · {t.pctOfMade}% of all made
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showProduct && summary.byProduct.length > 1 && (
        <div>
          <h3 className="mb-2 text-[14px] font-semibold">By product</h3>
          <Table head={["Product", "Good", "Defects", "Defect rate"]}>
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
        <Table head={showProduct ? ["Day", "Product", "Good", "Defects", "Defect rate"] : ["Day", "Good", "Defects", "Defect rate"]}>
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
