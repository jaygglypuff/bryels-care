import { requireContext } from "@/lib/auth/context";
import { canSeeReport, recipientOptions, reportByCode } from "@/modules/reports";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { plainReport } from "../../plain";
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
        <EmptyState title="Choose a list first" action={<LinkButton href="/reports" variant="secondary">Lists to download or print</LinkButton>}>
          Open a list, then ⋯ More → “Send it by email regularly”. The weekly sign-in list is sent by the system and cannot be set up by hand.
        </EmptyState>
      </Card>
    );
  }
  const parameters: Record<string, string> = {};
  for (const p of def.params) if (sp[p.name] && !(p.kind === "period" && sp[p.name] === "custom")) parameters[p.name] = sp[p.name]!;
  const people = await recipientOptions(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title={`Send by email: ${plainReport(def.code, def.title).title}`} />
      <PageIntro>This screen is for setting up a list that arrives by itself: choose how often, the time and who gets it, then press “Start sending”.</PageIntro>
      <Card>
        <ScheduleForm
          value={{ name: plainReport(def.code, def.title).title, reportCode: def.code, siteId: sp.site && sp.site !== "all" ? sp.site : null, cadence: def.defaultCadence ?? "weekly", runAtTime: "07:00", weekday: 1, monthDay: 1, format: "xlsx", parameters, recipientUserIds: [ctx.userId] }}
          params={formParams(def)}
          sites={ctx.allowedSites.filter((s) => ctx.canAt(def.viewPermission, s.id))}
          people={people}
        />
      </Card>
    </div>
  );
}
