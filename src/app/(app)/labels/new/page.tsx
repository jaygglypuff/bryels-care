import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { labelHistory, labelPreview, type LabelEntityType, type LabelPreview } from "@/modules/documents";
import { LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { LabelGuide, LabelPrintCard, LABEL_KIND_WORDS } from "@/ui/labels";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { JobStatus, STATE_WORDS } from "../bits";

export const metadata = { title: "Print a label" };

const TYPES: LabelEntityType[] = ["inventory_lot", "location", "container"];
const BACK: Record<string, (id: string) => string> = {
  inventory_lot: (id) => `/inventory/${id}`,
  location: (id) => `/inventory/locations/${id}`,
  container: (id) => `/inventory/containers/${id}`,
};

/**
 * Print a label for a lot, a shelf or a box (ADR-099): the label as it will print, "How many?" and one green
 * "Print N labels". The same content printed again is a reprint with a reason (asked right here).
 */
export default async function NewLabelPage({ searchParams }: { searchParams: Promise<{ entityType?: string; entityId?: string; copies?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="labels" />;
  const { entityType = "", entityId = "", copies } = await searchParams;
  if (!TYPES.includes(entityType as LabelEntityType) || !entityId) {
    // Opened without a record (old bookmark, menu): say where labels are printed instead of a bare 404.
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Print a label" />
        <PageIntro>Labels are printed from the thing they go on. Open it first, then press Print label.</PageIntro>
        <LabelGuide />
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/inventory/scan" variant="cta" size="lg">Scan or find it</LinkButton>
          <LinkButton href="/labels" variant="secondary" size="lg">Labels printed</LinkButton>
        </div>
      </div>
    );
  }
  let p: LabelPreview;
  try {
    p = await labelPreview(ctx, { entityType: entityType as LabelEntityType, entityId, copies: copies ? Number(copies) || null : null });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    if (e instanceof DomainError && e.code === "state") {
      return (
        <div className="mx-auto max-w-2xl">
          <Banner tone="info" title="Nothing to label">{e.message}</Banner>
        </div>
      );
    }
    throw e;
  }
  const back = BACK[entityType](p.entity.id);
  const history = await labelHistory(ctx, entityType, p.entity.id);
  const what = p.entity.name ?? p.entity.number;
  const words = LABEL_KIND_WORDS[p.kind];
  const stale = history.some((j) => j.status === "printed" && !j.voidedAt && j.statusAtPrint !== p.entity.state);
  const kindWord = entityType === "location" ? "Shelf" : entityType === "container" ? "Box" : "Lot";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={`Print a label: ${what}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {kindWord} <RecordNo>{p.entity.number}</RecordNo>
            {p.entity.state && STATE_WORDS[p.entity.state] ? <span>· now {STATE_WORDS[p.entity.state]}</span> : null}
          </span>
        }
        actions={<LinkButton href={back} variant="secondary">Back</LinkButton>}
      />
      <PageIntro>This screen is for printing this {kindWord.toLowerCase()}&apos;s label. {words.stick}</PageIntro>
      {stale && <Banner tone="warn" title="The old label is out of date">Print the new one below, then throw the old label away.</Banner>}
      <LabelPrintCard preview={p} returnTo={back} title={null} />
      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">Labels printed before</h2>
        {history.length === 0 ? (
          <p className="text-[14px] text-fg-2">None yet.</p>
        ) : (
          <PlainList label="Labels printed before">
            {history.map((j) => (
              <PlainRow
                key={j.id}
                href={`/labels/jobs/${j.id}`}
                title={`${j.copies} × ${j.media}${j.reprintNo ? ` · printed again (${j.reprintNo})` : ""}`}
                status={<JobStatus status={j.status} voided={!!j.voidedAt} />}
                facts={<>{fmtDateTime(j.printedAt ?? j.requestedAt)}{j.statusAtPrint && STATE_WORDS[j.statusAtPrint] ? ` · ${STATE_WORDS[j.statusAtPrint]}` : ""}</>}
              />
            ))}
          </PlainList>
        )}
      </section>
    </div>
  );
}
