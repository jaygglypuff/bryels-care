import Link from "next/link";
import { Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listStations, stationQueue, type LabelJobView } from "@/modules/documents";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { JobStatus, shortRef, STATUS_AT_PRINT } from "./bits";
import { FailForm, JobCommand } from "./forms";

export const metadata = { title: "Label print station" };
export const dynamic = "force-dynamic";

function JobCard({ j, canAct }: { j: LabelJobView; canAct: boolean }) {
  return (
    <li className="rounded-[16px] border border-line bg-surface p-4" data-testid="station-job">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono text-[16px] font-semibold">{j.entityNumber}</p>
          <p className="text-[13px] text-muted">
            Label size {j.media} · {j.copies} {j.copies === 1 ? "label" : "labels"}
            {j.reprintNo > 0 ? ` · REPRINT ${j.reprintNo}` : ""}
            {j.statusAtPrint ? ` · status at print ${STATUS_AT_PRINT[j.statusAtPrint] ?? j.statusAtPrint}` : ""}
          </p>
          <p className="text-[12px] text-muted">Requested by {j.requestedByName}, {fmtDateTime(j.requestedAt)} · ref {shortRef(j.id)}</p>
        </div>
        <JobStatus status={j.status} voided={!!j.voidedAt} />
      </div>
      {j.status === "failed" && j.errorMessage && <p className="mt-2 text-[13px] text-[var(--bad-fg)]">{j.errorMessage}</p>}
      {canAct && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
          {j.status === "ready" && (
            <LinkButton href={`/print/labels/${j.id}`} target="_blank" variant="cta" size="lg">
              <Printer size={18} /> Print
            </LinkButton>
          )}
          {j.status === "failed" && <JobCommand jobId={j.id} kind="retry" label="Retry (same label)" variant="cta" />}
          {["queued", "ready", "failed"].includes(j.status) && <JobCommand jobId={j.id} kind="cancel" label="Cancel" confirm="Cancel this label job? It will not be printed." />}
          <LinkButton href={`/labels/jobs/${j.id}`} variant="secondary">Details</LinkButton>
        </div>
      )}
      {canAct && j.status === "ready" && (
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-muted">The printer failed?</summary>
          <div className="mt-2"><FailForm jobId={j.id} /></div>
        </details>
      )}
    </li>
  );
}

export default async function StationPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="the label print station" />;
  const { station: wanted } = await searchParams;
  const stations = await listStations(ctx, { siteId: ctx.currentSiteId });
  if (stations.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Label print station" subtitle={ctx.currentSite.code} />
        <Banner tone="info" title={`Label printing isn't set up for ${ctx.currentSite.code} yet`} action={ctx.can("documents.print_station.admin") ? <LinkButton href="/admin/templates/stations" variant="secondary" size="sm">Add a print station</LinkButton> : undefined}>
          A print station is the PC or tablet next to the label printer. {ctx.can("documents.print_station.admin") ? "Add one to start printing labels at this site." : "Ask an administrator to add one."}
        </Banner>
      </div>
    );
  }
  const station = stations.find((s) => s.id === wanted) ?? stations[0];
  const q = await stationQueue(ctx, station.id);
  const canAct = ctx.can("inventory.label_job.create");
  return (
    <div className="space-y-5">
      <PageHeader title="Label print station" subtitle={`${ctx.currentSite.code} · ${station.name} · printer: ${station.printerName}`} />
      {stations.length > 1 && (
        <nav aria-label="Print station" className="flex flex-wrap gap-2">
          {stations.map((s) => (
            <Link key={s.id} href={`/labels?station=${s.id}`} aria-current={s.id === station.id ? "page" : undefined} className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", s.id === station.id ? "border-primary bg-primary-soft font-semibold text-primary-text" : "border-line bg-surface")}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      <Banner tone="info" title="Print at 100 %">
        In the print dialog choose this station&apos;s label printer, the label size and &quot;Actual size&quot; (no fit to page). Then tap &quot;Printed OK&quot; so the job leaves the queue.
      </Banner>
      <Card>
        <CardTitle>To print ({q.toPrint.length})</CardTitle>
        {q.toPrint.length === 0 ? (
          <EmptyState title="Nothing to print right now.">Labels requested from phones and receiving appear here.</EmptyState>
        ) : (
          <ul className="space-y-3">{q.toPrint.map((j) => <JobCard key={j.id} j={j} canAct={canAct} />)}</ul>
        )}
      </Card>
      <Card>
        <CardTitle>Printed in the last 24 hours ({q.printed.length})</CardTitle>
        {q.printed.length === 0 ? (
          <p className="text-[13px] text-muted">No labels printed here in the last 24 hours.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {q.printed.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/labels/jobs/${j.id}`} className="min-w-0 break-all font-mono text-primary-text hover:underline">{j.entityNumber}</Link>
                <span className="text-muted">{j.media} · {j.copies}× · {j.printedByName} {fmtDateTime(j.printedAt)}{j.reprintNo ? ` · REPRINT ${j.reprintNo}` : ""}</span>
                <JobStatus status={j.status} voided={!!j.voidedAt} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
