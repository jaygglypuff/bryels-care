import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { AREAS, type AreaKey } from "@/modules/analytics";
import { Card, EmptyState, PageHeader } from "@/ui/core";

export const dynamic = "force-dynamic";

/** Analytics home: the area dashboards, trends and the KPI catalogue (docs/analytics-kpis.md §3). */
export default async function AnalyticsHome() {
  const ctx = await requireContext();
  const links: { href: string; title: string; text: string; show: boolean }[] = [
    ...(Object.keys(AREAS) as AreaKey[]).map((k) => ({ href: `/analytics/${k}`, title: `${AREAS[k].title} dashboard`, text: AREAS[k].intro, show: ctx.can("analytics.dashboard.view") })),
    { href: "/analytics/trends", title: "Trends", text: "Up to six KPIs over days, weeks or months, with a comparison period and a table.", show: ctx.can("analytics.dashboard.view") },
    { href: "/analytics/definitions", title: "KPI definitions", text: "What each number means, how it is calculated, its sources and the last reconciliation.", show: ctx.can("analytics.kpi_definition.view") },
  ];
  const visible = links.filter((l) => l.show);
  return (
    <>
      <PageHeader title="Analytics" subtitle="Every number opens the records it is made of." />
      {visible.length === 0 ? (
        <EmptyState title={`You don't have access to analytics at ${ctx.currentSite.code}`}>Ask your site manager, or switch site.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((l) => (
            <Link key={l.href} href={l.href} className="group block rounded-[24px]">
              <Card className="flex h-full flex-col gap-2 transition-shadow group-hover:shadow-[var(--shadow-pop)]">
                <span className="flex items-center justify-between font-display text-[17px] font-semibold text-fg">
                  {l.title} <ArrowRight size={16} className="text-muted" aria-hidden />
                </span>
                <span className="text-[13px] text-fg-2">{l.text}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
