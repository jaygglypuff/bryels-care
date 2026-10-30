import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { PipelineStage } from "@/modules/analytics";

/**
 * The connected pipeline as stage cards (ADR-081, mockup board "Operations Center"): the count of each
 * stage, its split by status and one warning line when something needs attention. Every card opens the
 * screen where the work is done; nothing here changes a record. Horizontal scroll on phones, a grid
 * on wider screens.
 */
export function PipelineStrip({ stages, compact = false }: { stages: PipelineStage[]; compact?: boolean }) {
  return (
    <ol className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-5" aria-label="Work pipeline">
      {stages.map((s, idx) => (
        <li key={s.key} className="min-w-[168px] snap-start md:min-w-0">
          <div className="flex h-full flex-col rounded-[16px] border border-line bg-surface p-3.5">
            <Link href={s.href} className="group flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {idx + 1}. {s.label}
                </span>
                <span className="mt-1.5 block font-display text-[28px] font-semibold leading-none text-fg tabular">{s.count.toLocaleString("en-PH")}</span>
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
              <Link href={s.attentionHref ?? s.href} className="mt-auto flex items-center gap-1 pt-2 text-[12px] font-medium text-[var(--warn-fg)] hover:underline">
                <AlertTriangle size={13} aria-hidden />
                {s.attention} {s.attentionLabel}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
