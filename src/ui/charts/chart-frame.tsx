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
    <section aria-labelledby={`${id}-h`} className={cx("min-w-0 rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="font-display text-[17px] font-semibold text-fg">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-line-strong bg-surface p-0.5" role="group" aria-label={`${title}: view`}>
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx("min-h-[34px] rounded-full px-3 text-[12.5px] font-medium", view === v ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}
            >
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      <div hidden={view !== "chart"}>
        {chart}
        {legend && <div className="mt-2">{legend}</div>}
      </div>
      <div hidden={view !== "table"} className="overflow-x-auto">
        {table}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        {stale && (
          <span className="inline-flex items-center rounded-full border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-2 py-0.5 font-medium text-[var(--warn-fg)]" title={stale}>
            Stale
          </span>
        )}
        <span>{meta}</span>
      </p>
    </section>
  );
}
