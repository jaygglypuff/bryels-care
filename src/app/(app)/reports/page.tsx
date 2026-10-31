import { requireContext } from "@/lib/auth/context";
import { PLANNED_REPORTS, REPORT_CATEGORIES, listReportLibrary } from "@/modules/reports";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { PLAIN_CATEGORY, plainReport } from "./plain";

export const metadata = { title: "Lists to download or print" };

/** Report library (US-5-04): the reports this user may run, by area, in plain names; planned reports are listed folded, never faked. */
export default async function ReportLibraryPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.report.view")) return <Forbidden what="reports" />;
  const entries = await listReportLibrary(ctx);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Lists to download or print"
        actions={
          <>
            <Help screen="analytics.reports" />
            {ctx.can("analytics.scheduled_report.view") && (
              <MoreMenu>
                <LinkButton href="/reports/schedules" variant="secondary" size="sm">Lists sent by email</LinkButton>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for anyone who needs a list on paper or in Excel: pick a list, choose the dates, then download or print it. It only shows your sites.</PageIntro>
      {entries.length === 0 ? (
        <Card>
          <EmptyState title="No lists for your role">Lists appear here for the areas your role can see (stock, production, quality, customers). Ask the owner if you need one.</EmptyState>
        </Card>
      ) : (
        REPORT_CATEGORIES.map((cat) => {
          const list = entries.filter((e) => e.def.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat} aria-labelledby={`cat-${cat}`}>
              <h2 id={`cat-${cat}`} className="mb-2 font-display text-[17px] font-semibold text-fg">{PLAIN_CATEGORY[cat] ?? cat}</h2>
              <PlainList label={PLAIN_CATEGORY[cat] ?? cat}>
                {list.map((e) => {
                  const p = plainReport(e.def.code, e.def.title, e.def.description);
                  return (
                    <PlainRow
                      key={e.def.code}
                      href={`/reports/${e.def.code}`}
                      testId={`report-${e.def.code}`}
                      title={p.title}
                      status={
                        <>
                          {!e.enabled && <Chip tone="neu">Switched off</Chip>}
                          {e.def.orgWideOnly && <Chip tone="info">Owner and auditor only</Chip>}
                        </>
                      }
                      facts={p.text}
                    />
                  );
                })}
              </PlainList>
            </section>
          );
        })
      )}
      <MoreDetails title="Lists that are coming later">
        <p className="text-[13px] text-fg-2">These lists need information the system does not keep yet. They appear above when it does.</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px]">
          {PLANNED_REPORTS.map((p) => (
            <li key={p.code}>{p.title}</li>
          ))}
        </ul>
      </MoreDetails>
    </div>
  );
}
