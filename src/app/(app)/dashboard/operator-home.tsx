import Link from "next/link";
import { ArrowRight, Factory, PackagePlus, ScanLine, ShieldCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import type { OperatorTile } from "@/modules/analytics";
import { EmptyState } from "@/ui/core";

const ICON: Record<OperatorTile["key"], ReactNode> = {
  receive: <PackagePlus size={26} />,
  scan: <ScanLine size={26} />,
  batches: <Factory size={26} />,
  qa: <ShieldCheck size={26} />,
  dispatch: <Truck size={26} />,
};

/** Large task tiles for operators (ux-system operator mode): verbs, live counts, 44 px+ targets. */
export function OperatorHome({ tiles, siteLabel, updated }: { tiles: OperatorTile[]; siteLabel: string; updated: string }) {
  if (tiles.length === 0)
    return <EmptyState title="No tasks for your role yet">Your role has no task screens at this site. Ask your site manager if you need access.</EmptyState>;
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              className="group flex min-h-[132px] items-start gap-4 rounded-[16px] border border-line bg-surface p-5 transition-shadow hover:shadow-[0_4px_12px_rgba(28,27,24,.08)]"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-primary-soft text-primary-text">{ICON[t.key]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[18px] font-semibold text-fg">{t.title}</span>
                  <ArrowRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="mt-1 block text-[13px] text-fg-2">{t.description}</span>
                <span className="mt-3 flex items-baseline gap-2">
                  <span className="tabular text-[28px] font-semibold leading-none text-fg">{t.count.toLocaleString("en-PH")}</span>
                  <span className="text-[13px] text-muted">{t.countLabel}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[12px] text-muted">
        Counts for {siteLabel} · updated {updated} · all figures from posted transactions
      </p>
    </>
  );
}
