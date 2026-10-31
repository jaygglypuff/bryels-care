import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { labelRequestOptions } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { JobStatus, STATE_WORDS } from "../bits";
import { CreateJobForm } from "../forms";

export const metadata = { title: "Print a label" };

/** Ask for a label for a lot or a shelf (US-2-12), grade-5 (ADR-088): three fields with defaults; reprints need a reason. */
export default async function NewLabelPage({ searchParams }: { searchParams: Promise<{ entityType?: string; entityId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.create")) return <Forbidden what="printing labels" />;
  const { entityType = "", entityId = "" } = await searchParams;
  if (!["inventory_lot", "location"].includes(entityType)) notFound();
  let o: Awaited<ReturnType<typeof labelRequestOptions>>;
  try {
    o = await labelRequestOptions(ctx, entityType, entityId);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  const isLot = entityType === "inventory_lot";
  const back = isLot ? `/inventory/${o.entity.id}` : `/inventory/locations/${o.entity.id}`;
  const live = o.history.filter((j) => j.status === "printed" && !j.voidedAt);
  const sameState = live.find((j) => j.statusAtPrint === o.entity.state);
  const what = o.entity.name ?? o.entity.caption;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={`Print a label: ${what}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {isLot ? "Lot" : "Shelf"} <RecordNo>{o.entity.number}</RecordNo>
            {o.entity.state && STATE_WORDS[o.entity.state] ? <span>· now {STATE_WORDS[o.entity.state]}</span> : null}
          </span>
        }
        actions={<LinkButton href={back} variant="secondary">Back</LinkButton>}
      />
      <PageIntro>This screen is for asking for a new label for this {isLot ? "lot" : "shelf"}. It goes to the label printer, where someone prints it.</PageIntro>
      {!o.isCurrentSite ? (
        <Banner tone="info" title={`This ${isLot ? "lot" : "shelf"} is at another site (${o.entity.siteCode})`}>Switch site in the top bar to print its label there.</Banner>
      ) : o.stations.length === 0 ? (
        <Banner tone="info" title="Label printing is not set up for this site yet">Ask the system administrator to add a label printer for this site.</Banner>
      ) : o.templates.length === 0 ? (
        <Banner tone="info" title="No label layout approved yet">QA must approve a label layout for this kind of record before labels can print. Ask QA.</Banner>
      ) : sameState ? (
        <NextStep
          text={`A label like this was already printed (${fmtDateTime(sameState.printedAt)} by ${sameState.printedByName}). A second copy is a reprint: it needs a reason and is kept on record.`}
          action={{ label: "Print it again, with a reason", href: `/labels/jobs/${sameState.reprintOfId ?? sameState.id}` }}
        />
      ) : (
        <Card>
          <CardTitle>Ask for a label</CardTitle>
          {live.length > 0 && (
            <p className="mb-3 text-[13px] text-[var(--warn-fg)]">The state changed since the last label. The new label replaces the old {live.length === 1 ? "one" : "ones"}: throw the old {live.length === 1 ? "label" : "labels"} away.</p>
          )}
          <CreateJobForm entityType={o.entity.type} entityId={o.entity.id} templates={o.templates} stations={o.stations} />
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Labels printed before</h2>
        {o.history.length === 0 ? (
          <p className="text-[14px] text-fg-2">No labels printed for this {isLot ? "lot" : "shelf"} yet.</p>
        ) : (
          <PlainList label="Labels printed before">
            {o.history.map((j) => (
              <PlainRow
                key={j.id}
                href={`/labels/jobs/${j.id}`}
                title={`${j.copies} × ${j.media}${j.reprintNo ? ` · printed again (${j.reprintNo})` : ""}`}
                status={<JobStatus status={j.status} voided={!!j.voidedAt} />}
                facts={<>{fmtDateTime(j.requestedAt)}{j.statusAtPrint ? ` · ${STATE_WORDS[j.statusAtPrint] ?? j.statusAtPrint}` : ""}</>}
              />
            ))}
          </PlainList>
        )}
      </section>
    </div>
  );
}
