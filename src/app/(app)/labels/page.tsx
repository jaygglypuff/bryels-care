import Link from "next/link";
import { Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listStations, stationQueue, type LabelJobView } from "@/modules/documents";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { JobStatus, STATE_WORDS } from "./bits";
import { FailForm, JobCommand } from "./forms";

export const metadata = { title: "Labels to print" };
export const dynamic = "force-dynamic";

/** One label waiting at the station: what it is for first, the number small; Print is the one button, the rest in ⋯ More. */
function JobCard({ j, canAct }: { j: LabelJobView; canAct: boolean }) {
  return (
    <li className="px-4 py-3" data-testid="station-job">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {j.entityName ?? j.templateName} <JobStatus status={j.status} voided={!!j.voidedAt} />
          </p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            {j.copies} {j.copies === 1 ? "label" : "labels"}, {j.media}
            {j.reprintNo > 0 ? ` · printed again (${j.reprintNo})` : ""}
            {j.statusAtPrint ? ` · ${STATE_WORDS[j.statusAtPrint] ?? j.statusAtPrint}` : ""} · asked by {j.requestedByName}, {fmtDateTime(j.requestedAt)}
            <span className="ml-1 break-all font-mono text-[12px] text-muted">· {j.entityNumber}</span>
          </p>
        </div>
      </div>
      {j.status === "failed" && j.errorMessage && <p className="mt-2 text-[13px] text-[var(--bad-fg)]">{j.errorMessage}</p>}
      {canAct && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {j.status === "ready" && (
            <LinkButton href={`/print/labels/${j.id}`} target="_blank" variant="cta" size="lg">
              <Printer size={18} /> Print
            </LinkButton>
          )}
          {j.status === "failed" && <JobCommand jobId={j.id} kind="retry" label="Try again (same label)" variant="cta" />}
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href={`/labels/jobs/${j.id}`} variant="secondary">See this label</LinkButton>
              {["queued", "ready", "failed"].includes(j.status) && <JobCommand jobId={j.id} kind="cancel" label="Cancel" confirm="Cancel this label? It will not be printed." />}
              {j.status === "ready" && (
                <div>
                  <p className="mb-2 text-[13px] font-medium">The printer did not print it?</p>
                  <FailForm jobId={j.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        </div>
      )}
    </li>
  );
}

/**
 * Labels to print (the label print station, US-2-12), grade-5 (ADR-088): what each label is for first, one
 * Print button; cancel and "did not print" in ⋯ More. Printed labels of the last 24 hours below.
 */
export default async function StationPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="labels to print" />;
  const { station: wanted } = await searchParams;
  const stations = await listStations(ctx, { siteId: ctx.currentSiteId });
  if (stations.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Labels to print" subtitle={ctx.currentSite.name} />
        <PageIntro>This screen is for printing labels at the label printer. Labels asked for from phones and receiving wait here.</PageIntro>
        <Banner tone="info" title={`Label printing is not set up for ${ctx.currentSite.name} yet`} action={ctx.can("documents.print_station.admin") ? <LinkButton href="/admin/templates/stations" variant="secondary">Add a label printer</LinkButton> : undefined}>
          A label printer needs a PC or tablet next to it. {ctx.can("documents.print_station.admin") ? "Add one to start printing labels at this site." : "Ask the system administrator to add one."}
        </Banner>
      </div>
    );
  }
  const station = stations.find((s) => s.id === wanted) ?? stations[0];
  const q = await stationQueue(ctx, station.id);
  const canAct = ctx.can("inventory.label_job.create");
  return (
    <div className="space-y-4">
      <PageHeader title="Labels to print" subtitle={`${ctx.currentSite.name} · ${station.name}`} />
      <PageIntro>This screen is for printing the labels that are waiting at this printer. Tap Print, print at 100 % size, then tap “Printed OK” so the label leaves the list.</PageIntro>
      {stations.length > 1 && <FilterTabs label="Label printer" active={station.id} tabs={stations.map((s) => [s.id, s.name, `/labels?station=${s.id}`] as const)} />}
      <MoreDetails title="How to print at the right size">
        <p className="text-[14px] text-fg-2">
          In the print window choose the label printer ({station.printerName}), the label size, and &quot;Actual size&quot; (not &quot;Fit to page&quot;). Then tap &quot;Printed OK&quot;.
        </p>
      </MoreDetails>
      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">To print · {q.toPrint.length}</h2>
        {q.toPrint.length === 0 ? (
          <EmptyState title="Nothing to print right now">Labels asked for from phones and receiving show here. Nothing to do.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">{q.toPrint.map((j) => <JobCard key={j.id} j={j} canAct={canAct} />)}</ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Printed in the last 24 hours · {q.printed.length}</h2>
        {q.printed.length === 0 ? (
          <p className="text-[14px] text-fg-2">No labels printed here in the last 24 hours.</p>
        ) : (
          <PlainList label="Printed labels">
            {q.printed.map((j) => (
              <PlainRow
                key={j.id}
                href={`/labels/jobs/${j.id}`}
                title={j.entityName ?? j.templateName}
                status={<JobStatus status={j.status} voided={!!j.voidedAt} />}
                facts={<>{j.copies} × {j.media} · {j.printedByName} {fmtDateTime(j.printedAt)}{j.reprintNo ? ` · printed again (${j.reprintNo})` : ""}</>}
                code={j.entityNumber}
              />
            ))}
          </PlainList>
        )}
      </section>
      <p className="text-[13px] text-fg-2">
        To print a new label, open the lot or shelf and choose <Link href="/inventory" className="font-medium text-primary-text underline">Print a label</Link> in ⋯ More.
      </p>
    </div>
  );
}
