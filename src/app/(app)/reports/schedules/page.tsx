import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSchedules } from "@/modules/reports";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Scheduled reports" };

/** Scheduled reports (US-5-05): own schedules and those the user receives; administrators see all in their sites. */
export default async function SchedulesPage() {
  const ctx = await requireContext();
  if (!ctx.can("analytics.scheduled_report.view")) return <Forbidden what="scheduled reports" />;
  const rows = await listSchedules(ctx);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduled reports"
        subtitle="Delivered in-app with an email link. Every recipient's access is checked again at each delivery; anyone who lost access is skipped and the owner is told."
        actions={ctx.can("analytics.scheduled_report.create") ? <LinkButton href="/reports" size="sm">New schedule from the library</LinkButton> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No scheduled reports yet" action={ctx.can("analytics.scheduled_report.create") ? <LinkButton href="/reports" variant="secondary">Open the report library</LinkButton> : undefined}>
            Choose a report in the library and use “Schedule” to have it delivered daily, weekly or monthly.
          </EmptyState>
        ) : (
          <Table head={["Schedule", "Report", "When", "Format", "Owner", "Next run", "Status"]}>
            {rows.map((s) => (
              <tr key={s.id}>
                <Td><Link href={`/reports/schedules/${s.id}`} className="font-medium text-primary-text hover:underline">{s.name}</Link></Td>
                <Td>{s.title}</Td>
                <Td>{s.summary}</Td>
                <Td className="uppercase">{s.format}</Td>
                <Td>{s.ownerName}{s.mine ? " (you)" : ""}</Td>
                <Td className="whitespace-nowrap">{s.nextRunAt ? fmtDateTime(s.nextRunAt) : "—"}</Td>
                <Td><Chip tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "Active" : "Paused"}</Chip></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
