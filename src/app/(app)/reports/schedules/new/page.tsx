import { requireContext } from "@/lib/auth/context";
import { canSeeReport, recipientOptions, reportByCode } from "@/modules/reports";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { ScheduleForm } from "../forms";
import { formParams } from "../shared";

export const dynamic = "force-dynamic";

/** New schedule for one report (?report=CODE, filters prefilled from the report page). */
export default async function NewSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.scheduled_report.create")) return <Forbidden what="creating scheduled reports" />;
  const sp = await searchParams;
  const def = sp.report ? reportByCode(sp.report) : undefined;
  if (!def || !def.schedulable || !canSeeReport(ctx, def)) {
    return (
      <Card>
        <EmptyState title="Choose a report first" action={<LinkButton href="/reports" variant="secondary">Report library</LinkButton>}>
          Open a report in the library and use “Schedule”. Reports delivered by the system (the weekly access report) cannot be scheduled by hand.
        </EmptyState>
      </Card>
    );
  }
  const parameters: Record<string, string> = {};
  for (const p of def.params) if (sp[p.name] && !(p.kind === "period" && sp[p.name] === "custom")) parameters[p.name] = sp[p.name]!;
  const people = await recipientOptions(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title={`Schedule: ${def.title}`} subtitle={<span className="font-mono">{def.code}</span>} />
      <Card>
        <ScheduleForm
          value={{ name: def.title, reportCode: def.code, siteId: sp.site && sp.site !== "all" ? sp.site : null, cadence: def.defaultCadence ?? "weekly", runAtTime: "07:00", weekday: 1, monthDay: 1, format: "xlsx", parameters, recipientUserIds: [ctx.userId] }}
          params={formParams(def)}
          sites={ctx.allowedSites.filter((s) => ctx.canAt(def.viewPermission, s.id))}
          people={people}
        />
      </Card>
    </div>
  );
}
