import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getRunForRecipient } from "@/modules/reports";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { plainReport } from "../../plain";

export const dynamic = "force-dynamic";

const RUN_TONE = { succeeded: "ok", partial: "warn", skipped: "neu", failed: "bad", running: "info" } as const;
const RUN_TEXT: Record<string, string> = { succeeded: "Sent", partial: "Sent to some", skipped: "Not sent", failed: "Failed", running: "Sending" };

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
        title={plainReport(r.run.reportCode, r.title).title}
        subtitle={`Sent ${fmtDateTime(r.run.startedAt)}`}
        actions={r.run.scheduledReportId ? <LinkButton href={`/reports/schedules/${r.run.scheduledReportId}`} variant="secondary" size="sm">About this email</LinkButton> : undefined}
      />
      <PageIntro>This screen is for getting the file that was sent to you by email. Press “Download”.</PageIntro>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <Chip tone={RUN_TONE[r.run.status as keyof typeof RUN_TONE] ?? "neu"}>{RUN_TEXT[r.run.status] ?? r.run.status}</Chip>
          <span className="text-muted">sent to {r.run.recipientsSent} · skipped {r.run.recipientsSkipped}</span>
        </div>
        {r.run.errorMessage && <Banner tone="bad" title="This one was not sent">{r.run.errorMessage} Ask the IT person to look at it.</Banner>}
        <CardTitle>Your file</CardTitle>
        {r.files.length === 0 ? (
          <EmptyState title="There is no file for you here">You were not on the list, or your access changed. Ask the person who set it up.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {r.files.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-[13px]">
                  <p className="break-all font-medium">{f.fileName}</p>
                  <p className="text-muted">
                    {f.rowCount} rows{f.truncated ? " (cut off at the row limit)" : ""} · sites {siteCodes(f.siteIds)}
                  </p>
                  <p className="break-all text-[12px] text-muted">Check number (sha256): {f.sha256.slice(0, 12)}…</p>
                </div>
                {f.purgedAt ? (
                  <span className="text-[13px] text-muted">Deleted after the keep-time ended</span>
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
          <CardTitle>People who did not get it</CardTitle>
          <p className="mb-2 text-[13px] text-muted">The system checked their access when sending; they were no longer allowed to see this list.</p>
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
