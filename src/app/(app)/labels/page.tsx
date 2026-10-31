import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { siteLabelList } from "@/modules/documents";
import { EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { LabelGuide } from "@/ui/labels";
import { Forbidden } from "../forbidden";
import { JobStatus, STATE_WORDS } from "./bits";

export const metadata = { title: "Labels printed" };
export const dynamic = "force-dynamic";

/**
 * Labels printed (ADR-099; was the "label print station"). Labels are printed on the screen of the task
 * (receive, packaging step, boxing, lot, shelf), so this is only the record: every label of this site, newest
 * first, read only. Open one to see it, or print it again with a reason.
 */
export default async function LabelsPrintedPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="labels" />;
  const { show } = await searchParams;
  const which = show === "not_printed" ? "not_printed" : "all";
  const jobs = await siteLabelList(ctx, { show: which });
  return (
    <div className="space-y-4">
      <PageHeader title="Labels printed" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for finding a label printed at this site. You print labels where you work: on the delivery, the batch&apos;s packaging step, the box, the lot or the shelf.</PageIntro>
      <FilterTabs
        label="Show"
        active={which}
        tabs={[
          ["all", "All labels", "/labels"],
          ["not_printed", "Not printed yet", "/labels?show=not_printed"],
        ]}
      />
      {jobs.length === 0 ? (
        <EmptyState title={which === "all" ? "No labels yet" : "Nothing waiting"}>
          {which === "all" ? "Labels printed at this site will show here." : "Every label made here was printed."}
        </EmptyState>
      ) : (
        <PlainList label="Labels">
          {jobs.map((j) => (
            <PlainRow
              key={j.id}
              href={j.status === "ready" ? `/print/labels/${j.id}` : `/labels/jobs/${j.id}`}
              title={j.entityName ?? j.templateName}
              status={<JobStatus status={j.status} voided={!!j.voidedAt} />}
              facts={
                <>
                  {j.copies} {j.copies === 1 ? "label" : "labels"} · {j.media}
                  {j.reprintNo ? ` · printed again (${j.reprintNo})` : ""}
                  {j.statusAtPrint && STATE_WORDS[j.statusAtPrint] ? ` · ${STATE_WORDS[j.statusAtPrint]}` : ""} · {j.printedAt ? `${j.printedByName}, ${fmtDateTime(j.printedAt)}` : `${j.requestedByName}, ${fmtDateTime(j.requestedAt)}`}
                </>
              }
              code={j.entityNumber}
            />
          ))}
        </PlainList>
      )}
      <LabelGuide />
      <MoreDetails title="Label sizes and printers">
        <p className="text-[14px] text-fg-2">
          The administrator and QA set these up in <Link href="/admin/templates" className="font-medium text-primary-text underline">Settings › Labels and printouts</Link>.
        </p>
      </MoreDetails>
    </div>
  );
}
