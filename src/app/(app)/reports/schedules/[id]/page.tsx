import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getSchedule, recipientOptions, reportByCode } from "@/modules/reports";
import { Card, CardTitle, Dl, EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { plainReport } from "../../plain";
import { Banner, Chip } from "@/ui/status";
import { PauseForm, ScheduleForm } from "../forms";
import { formParams } from "../shared";

export const dynamic = "force-dynamic";

const RUN_TONE = { succeeded: "ok", partial: "warn", skipped: "neu", failed: "bad", running: "info" } as const;
const RUN_TEXT: Record<string, string> = { succeeded: "Sent", partial: "Sent to some", skipped: "Not sent", failed: "Failed", running: "Sending" };

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const sp = await searchParams;
  let s: Awaited<ReturnType<typeof getSchedule>>;
  try {
    s = await getSchedule(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  const def = reportByCode(s.reportCode);
  const people = s.canEdit ? await recipientOptions(ctx) : [];
  const plain = plainReport(s.reportCode, s.title);
  const filters = Object.entries(s.parameters as Record<string, string>).map(([k, v]) => `${k} = ${v}`).join(", ") || "the usual ones";
  return (
    <div className="space-y-5">
      <PageHeader
        title={s.name}
        actions={
          s.canEdit ? (
            <MoreMenu>
              <PauseForm id={s.id} active={s.isActive} />
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for checking an email list: what is sent, when, to whom, and whether the last ones arrived.</PageIntro>
      {sp.ok === "created" && <Banner tone="ok" title="Done – it will be sent by itself">The first one goes out {s.nextRunAt ? fmtDateTime(s.nextRunAt) : "when you start it again"}.</Banner>}
      <Card>
        <Dl
          items={[
            ["List", plain.title],
            ["How often", s.summary],
            ["Status", <Chip key="st" tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "Sending" : "Stopped for now"}</Chip>],
            ["Next one", s.nextRunAt ? fmtDateTime(s.nextRunAt) : "—"],
            ["Who gets it", s.recipients.map((r) => r.name + (r.status !== "active" ? ` (${r.status === "inactive" ? "no longer active" : r.status})` : "")).join(", ")],
          ]}
        />
        <div className="mt-3">
          <MoreDetails>
            <Dl
              items={[
                ["Last sent", s.lastRunAt ? fmtDateTime(s.lastRunAt) : "never"],
                ["File type", s.format === "xlsx" ? "Excel" : s.format === "csv" ? "CSV" : "Page to print"],
                ["Set up by", s.ownerName],
                ["Filters", filters],
                ["Technical name", <span key="c" className="font-mono">{s.reportCode}</span>],
              ]}
            />
          </MoreDetails>
        </div>
      </Card>
      <Card>
        <CardTitle>Sent so far</CardTitle>
        {s.runs.length === 0 ? (
          <EmptyState title="Not sent yet">The first one appears here after its time. If nothing comes, ask the IT person to check that the background worker is running.</EmptyState>
        ) : (
          <PlainList label="Sent so far">
            {s.runs.map((r) => (
              <PlainRow
                key={r.id}
                href={`/reports/runs/${r.id}`}
                title={r.finishedAt ? fmtDateTime(r.finishedAt) : "Sending now"}
                status={<Chip tone={RUN_TONE[r.status as keyof typeof RUN_TONE] ?? "neu"}>{RUN_TEXT[r.status] ?? r.status}</Chip>}
                facts={`sent to ${r.recipientsSent} · skipped ${r.recipientsSkipped} · ${r.filesCount} file(s)`}
              />
            ))}
          </PlainList>
        )}
      </Card>
      {s.canEdit && def && (
        <Card>
          <CardTitle>Change it</CardTitle>
          <ScheduleForm
            value={{ id: s.id, version: s.version, name: s.name, reportCode: s.reportCode, siteId: s.siteId, cadence: s.cadence, runAtTime: s.runAtTime, weekday: s.weekday, monthDay: s.monthDay, format: s.format, parameters: s.parameters as Record<string, string>, recipientUserIds: s.recipients.map((r) => r.id) }}
            params={formParams(def)}
            sites={ctx.allowedSites.filter((x) => ctx.canAt(def.viewPermission, x.id))}
            people={people}
          />
        </Card>
      )}
    </div>
  );
}
