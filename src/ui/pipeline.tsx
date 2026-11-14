import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronRight } from "lucide-react";
import type { PipelineStage } from "@/modules/analytics";
import { cx } from "./core";

/**
 * The connected pipeline as stage cards (ADR-081, mockup board "Operations Center"): the count of each
 * stage, its split by status and one warning line when something needs attention. Every card opens the
 * screen where the work is done; nothing here changes a record.
 *
 * Round 4 (UX re-audit C #10): a connected strip on wide screens (an arrow between each stage and the next one
 * on the same row: 3 a row on tablets, 5 a row from 1280 px), a two-column wrapping list on phones (no sideways
 * scroll). The warning line is a full 44 px target.
 */
export function PipelineStrip({ stages, compact = false }: { stages: PipelineStage[]; compact?: boolean }) {
  return (
    <ol className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-x-8 md:gap-y-3 xl:grid-cols-5" aria-label="Work pipeline" data-testid="pipeline-strip">
      {stages.map((s, idx) => {
        const last = idx === stages.length - 1;
        const endMd = (idx + 1) % 3 === 0;
        const endXl = (idx + 1) % 5 === 0;
        return (
          <li key={s.key} className="relative min-w-0">
            <div className="flex h-full flex-col rounded-[8px] border border-line bg-surface p-3.5">
              <Link href={s.href} className="group flex min-h-[44px] items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {idx + 1}. {s.label}
                  </span>
                  <span className="mt-1.5 block font-display text-stat leading-none text-fg tabular">{s.count.toLocaleString("en-PH")}</span>
                </span>
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              {!compact && <p className="mt-1 text-[12px] text-muted">{s.hint}</p>}
              {s.parts.length > 1 && (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-fg-2">
                  {s.parts.map((p) => (
                    <li key={p.label} className="whitespace-nowrap">
                      <span className="tabular font-medium">{p.n}</span> {p.label}
                    </li>
                  ))}
                </ul>
              )}
              {s.attention > 0 && (
                <Link href={s.attentionHref ?? s.href} className="mt-auto flex min-h-[44px] items-center gap-1 pt-1 text-[12px] font-medium text-[var(--warn-fg)] hover:underline" data-testid="stage-warning">
                  <AlertTriangle size={13} aria-hidden className="shrink-0" />
                  {s.attention} {s.attentionLabel}
                </Link>
              )}
            </div>
            {!last && (
              <span
                aria-hidden
                data-testid="stage-arrow"
                className={cx("absolute -right-7 top-1/2 hidden -translate-y-1/2 text-[var(--brand-600)]", endMd ? "md:hidden" : "md:block", endXl ? "xl:hidden" : "xl:block")}
              >
                <ArrowRight size={18} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
