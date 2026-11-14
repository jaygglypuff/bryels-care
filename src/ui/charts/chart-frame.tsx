"use client";
import { useId, useState, type ReactNode } from "react";
import { cx } from "@/ui/core";

/**
 * Chart card with the mandatory "Table" toggle (docs/ux-system.md rules 5.12): the same data as a
 * `data` table, the freshness line ("Updated HH:MM · scope · period") and an optional Stale badge.
 * Both views are rendered on the server; the toggle only switches which one is visible.
 */
export function ChartFrame({
  title,
  subtitle,
  meta,
  stale,
  chart,
  table,
  legend,
  defaultView = "chart",
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  meta: ReactNode;
  stale?: string | null;
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  defaultView?: "chart" | "table";
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">(defaultView);
  const id = useId();
  return (
    // ADR-136: the same panel anatomy as Panel (src/ui/kit.tsx): a header row with a rule under it, then the body.
    <section aria-labelledby={`${id}-h`} className={cx("min-w-0 rounded-[8px] border border-line bg-surface", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[14px] font-semibold text-fg">
            {title}
          </h2>
          {subtitle && <p className="text-[12px] text-muted">{subtitle}</p>}
        </div>
        <div className="inline-flex shrink-0 rounded-[6px] border border-line bg-surface-2 p-0.5" role="group" aria-label={`${title}: view`}>
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx("min-h-[44px] min-w-[44px] rounded-[6px] px-3 text-[13px] font-medium pointer-fine:min-h-[28px]", view === v ? "bg-surface text-fg shadow-[var(--shadow-card)]" : "text-fg-2 hover:text-fg")}
            >
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      <div hidden={view !== "chart"} className="px-4 pt-3">
        {chart}
        {legend && <div className="mt-2">{legend}</div>}
      </div>
      <div hidden={view !== "table"} className="overflow-x-auto px-4 pt-3">
        {table}
      </div>
      <p className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2 text-[12px] text-muted">
        {stale && (
          <span className="inline-flex items-center rounded-[4px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-2 py-0.5 font-medium text-[var(--warn-fg)]" title={stale}>
            Stale
          </span>
        )}
        <span>{meta}</span>
      </p>
    </section>
  );
}
