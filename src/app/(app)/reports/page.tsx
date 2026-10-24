import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { PLANNED_REPORTS, REPORT_CATEGORIES, listReportLibrary } from "@/modules/reports";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../forbidden";

export const metadata = { title: "Report library" };

/** Report library (US-5-04): the reports this user may run, by area; planned reports are listed with their phase, never faked. */
export default async function ReportLibraryPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.report.view")) return <Forbidden what="reports" />;
  const entries = await listReportLibrary(ctx);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Report library"
        subtitle="Live reports from posted records, scoped to your sites and role. Each one shows its filters, freshness and definitions, and exports to CSV, Excel or a printable page."
        actions={ctx.can("analytics.scheduled_report.view") ? <LinkButton href="/reports/schedules" variant="secondary" size="sm">Scheduled reports</LinkButton> : undefined}
      />
      {entries.length === 0 ? (
        <Card>
          <EmptyState title="No reports for your role">Reports appear here for the areas your role can view (inventory, production, quality, sales, audit).</EmptyState>
        </Card>
      ) : (
        REPORT_CATEGORIES.map((cat) => {
          const list = entries.filter((e) => e.def.category === cat);
          if (!list.length) return null;
          return (
            <Card key={cat}>
              <CardTitle>{cat}</CardTitle>
              <ul className="divide-y divide-line">
                {list.map((e) => (
                  <li key={e.def.code} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/reports/${e.def.code}`} className="font-medium text-fg hover:underline">{e.def.title}</Link>
                        <span className="font-mono text-[11px] text-muted">{e.def.code}</span>
                        {!e.enabled && <Chip tone="neu">Switched off</Chip>}
                        {e.def.orgWideOnly && <Chip tone="info">Owner and auditor</Chip>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">{e.def.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <LinkButton href={`/reports/${e.def.code}`} size="sm">Run</LinkButton>
                      {e.canSchedule && e.enabled && <LinkButton href={`/reports/schedules/new?report=${e.def.code}`} variant="secondary" size="sm">Schedule</LinkButton>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
      <Card>
        <CardTitle>Coming with later data</CardTitle>
        <p className="mb-2 text-[13px] text-muted">These catalogue reports need data the system does not record yet; they appear here when it does.</p>
        <ul className="space-y-1 text-[13px]">
          {PLANNED_REPORTS.map((p) => (
            <li key={p.code} className="flex flex-wrap gap-2">
              <span className="font-mono text-[12px] text-muted">{p.code}</span>
              <span>{p.title}</span>
              <span className="text-muted">· {p.phase}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
