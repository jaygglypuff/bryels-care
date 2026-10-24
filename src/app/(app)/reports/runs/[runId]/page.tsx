import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getRunForRecipient } from "@/modules/reports";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";

export const dynamic = "force-dynamic";

const RUN_TONE = { succeeded: "ok", partial: "warn", skipped: "neu", failed: "bad", running: "info" } as const;

/** One delivery of a scheduled report: the caller's files (recipients) and, for the schedule owner, who was skipped. */
export default async function ReportRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const ctx = await requireContext();
  const { runId } = await params;
  let r: Awaited<ReturnType<typeof getRunForRecipient>>;
  try {
    r = await getRunForRecipient(ctx, runId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const skipped = r.run.skipped as { userId: string; name: string; reason: string }[];
  const siteCodes = (ids: unknown) => (ids as string[]).map((id) => ctx.allowedSites.find((s) => s.id === id)?.code ?? "another site").join(", ");
  return (
    <div className="space-y-5">
      <PageHeader
        title={r.title}
        subtitle={<>Delivery <span className="font-mono">{r.run.periodKey}</span> · started {fmtDateTime(r.run.startedAt)}</>}
        actions={r.run.scheduledReportId ? <LinkButton href={`/reports/schedules/${r.run.scheduledReportId}`} variant="secondary" size="sm">Schedule</LinkButton> : undefined}
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <Chip tone={RUN_TONE[r.run.status as keyof typeof RUN_TONE] ?? "neu"}>{r.run.status}</Chip>
          <span className="text-muted">sent to {r.run.recipientsSent} · skipped {r.run.recipientsSkipped} · files {r.run.filesCount} · emails {r.run.emailsSent}</span>
        </div>
        {r.run.errorMessage && <Banner tone="bad" title="This delivery failed">{r.run.errorMessage}</Banner>}
        <CardTitle>Your file</CardTitle>
        {r.files.length === 0 ? (
          <EmptyState title="No file for you in this delivery">You were not a recipient, or you were skipped because your access changed.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {r.files.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-[13px]">
                  <p className="break-all font-mono">{f.fileName}</p>
                  <p className="text-muted">
                    {f.rowCount} rows{f.truncated ? " (truncated at the row limit)" : ""} · sites {siteCodes(f.siteIds)} · sha256 {f.sha256.slice(0, 12)}…
                  </p>
                </div>
                {f.purgedAt ? (
                  <span className="text-[13px] text-muted">Removed after the retention period</span>
                ) : (
                  <a className={buttonClass("primary", "sm")} href={`/reports/runs/${r.run.id}/files/${f.id}`}>Download</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(r.isOwner || ctx.can("analytics.scheduled_report.admin")) && skipped.length > 0 && (
        <Card>
          <CardTitle>Skipped recipients</CardTitle>
          <p className="mb-2 text-[13px] text-muted">Their access was re-checked at delivery time; they did not receive a file.</p>
          <ul className="space-y-1 text-[13px]">
            {skipped.map((s) => (
              <li key={s.userId}><span className="font-medium">{s.name}</span>: {s.reason}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
