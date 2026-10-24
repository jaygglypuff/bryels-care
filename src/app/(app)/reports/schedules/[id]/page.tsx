import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getSchedule, recipientOptions, reportByCode } from "@/modules/reports";
import { Card, CardTitle, Dl, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { PauseForm, ScheduleForm } from "../forms";
import { formParams } from "../shared";

export const dynamic = "force-dynamic";

const RUN_TONE = { succeeded: "ok", partial: "warn", skipped: "neu", failed: "bad", running: "info" } as const;

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
  return (
    <div className="space-y-5">
      <PageHeader title={s.name} subtitle={<>{s.title} · <span className="font-mono">{s.reportCode}</span></>} />
      {sp.ok === "created" && <Banner tone="ok" title="Schedule created">The first delivery is {s.nextRunAt ? fmtDateTime(s.nextRunAt) : "when it is resumed"}.</Banner>}
      <Card>
        <Dl
          items={[
            ["When", s.summary],
            ["Status", <Chip key="st" tone={s.isActive ? "ok" : "neu"}>{s.isActive ? "Active" : "Paused"}</Chip>],
            ["Next run", s.nextRunAt ? fmtDateTime(s.nextRunAt) : "—"],
            ["Last run", s.lastRunAt ? fmtDateTime(s.lastRunAt) : "never"],
            ["Format", s.format.toUpperCase()],
            ["Owner", s.ownerName],
            ["Filters", Object.entries(s.parameters as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(", ") || "defaults"],
            ["Recipients", s.recipients.map((r) => r.name + (r.status !== "active" ? ` (${r.status})` : "")).join(", ")],
          ]}
        />
        {s.canEdit && (
          <div className="mt-4">
            <PauseForm id={s.id} active={s.isActive} />
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Deliveries</CardTitle>
        {s.runs.length === 0 ? (
          <EmptyState title="Not delivered yet">Deliveries appear here after the first scheduled time (the worker must be running).</EmptyState>
        ) : (
          <Table head={["Slot", "Status", "Sent", "Skipped", "Files", "Finished"]}>
            {s.runs.map((r) => (
              <tr key={r.id}>
                <Td><Link className="font-mono text-primary-text hover:underline" href={`/reports/runs/${r.id}`}>{r.periodKey}</Link></Td>
                <Td><Chip tone={RUN_TONE[r.status as keyof typeof RUN_TONE] ?? "neu"}>{r.status}</Chip></Td>
                <Td className="text-right">{r.recipientsSent}</Td>
                <Td className="text-right">{r.recipientsSkipped}</Td>
                <Td className="text-right">{r.filesCount}</Td>
                <Td className="whitespace-nowrap">{r.finishedAt ? fmtDateTime(r.finishedAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {s.canEdit && def && (
        <Card>
          <CardTitle>Change the schedule</CardTitle>
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
