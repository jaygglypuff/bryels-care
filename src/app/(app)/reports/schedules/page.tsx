import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSchedules } from "@/modules/reports";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { plainReport } from "../plain";

export const metadata = { title: "Lists sent by email" };

/** Scheduled reports (US-5-05): own schedules and those the user receives; administrators see all in their sites. */
export default async function SchedulesPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.scheduled_report.view")) return <Forbidden what="lists sent by email" />;
  const rows = await listSchedules(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title="Lists sent by email" actions={ctx.can("analytics.scheduled_report.create") ? <LinkButton href="/reports" variant="cta">Send a new list</LinkButton> : undefined} />
      <PageIntro>This screen is for managers who want a list every day, week or month without asking: the system makes it and sends a link. People who are no longer allowed to see it are skipped.</PageIntro>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing is sent by email yet" action={ctx.can("analytics.scheduled_report.create") ? <LinkButton href="/reports" variant="secondary">Lists to download or print</LinkButton> : undefined}>
            Open a list, then ⋯ More → “Send it by email regularly”.
          </EmptyState>
        ) : (
          <PlainList label="Lists sent by email">
            {rows.map((s) => (
              <PlainRow
                key={s.id}
                href={`/reports/schedules/${s.id}`}
                title={s.name}
                status={<Chip tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "Sending" : "Stopped for now"}</Chip>}
                facts={
                  <>
                    {plainReport(s.reportCode, s.title).title} · {s.summary} · by {s.ownerName}
                    {s.mine ? " (you)" : ""}
                    {s.nextRunAt ? ` · next ${fmtDateTime(s.nextRunAt)}` : ""}
                  </>
                }
              />
            ))}
          </PlainList>
        )}
      </Card>
    </div>
  );
}
