import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { FailForm, JobCommand } from "@/app/(app)/labels/forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelJobForPrint } from "@/modules/documents";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../../lot-label/print-button";

export const metadata = { title: "Print labels" };
export const dynamic = "force-dynamic";

/**
 * Print route for one label job: the label pages are re-rendered from the stored dataset with
 * the pinned template version and hash-checked, so what prints is the recorded label.
 */
export default async function PrintLabelJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { jobId } = await params;
  let r: Awaited<ReturnType<typeof labelJobForPrint>>;
  try {
    r = await labelJobForPrint(ctx, jobId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { job, render } = r;
  const printable = render && render.integrity === "ok" && !job.voidedAt && ["ready", "printed"].includes(job.status);
  return (
    <main>
      <div className="no-print mx-auto max-w-xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-all text-[18px] font-semibold">Labels · {job.entityNumber}</h1>
            <p className="text-[13px] text-muted">
              {job.templateCode} · {job.media} · {job.copies} {job.copies === 1 ? "label" : "labels"}, one per page{job.reprintNo ? ` · REPRINT ${job.reprintNo}` : ""}. Printer: {job.printerName ?? job.stationName}. Choose &quot;Actual size&quot; (100 %).
            </p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/labels/jobs/${job.id}`} variant="secondary" size="lg">Back</LinkButton>
            {printable && <PrintButton label={`Print ${job.copies}`} />}
          </div>
        </div>
        {job.voidedAt && <Banner tone="bad" title="This label was voided">{job.voidReason} Do not print it; request a new label.</Banner>}
        {!render && <Banner tone="warn" title="This label is not ready">Status: {job.status}. {job.errorMessage ?? ""}</Banner>}
        {render && render.integrity !== "ok" && (
          <Banner tone="bad" title="This label can't be reproduced exactly">
            The stored label and the current renderer disagree ({render.integrity}). Do not print; ask an administrator. {render.error ?? ""}
          </Banner>
        )}
        {printable && job.status === "ready" && ctx.can("inventory.label_job.create") && (
          <div className="grid gap-3 rounded-[16px] border border-line bg-surface p-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[13px] text-fg-2">After the labels come out of the printer:</p>
              <JobCommand jobId={job.id} kind="printed" label="Printed OK" variant="cta" />
            </div>
            <FailForm jobId={job.id} />
          </div>
        )}
        {job.status === "printed" && !job.voidedAt && <Banner tone="ok" title="Recorded as printed">Printed by {job.printedByName}. Stick the label on the container now. Printing again from here is not recorded; for a lost or damaged label use Reprint with a reason.</Banner>}
      </div>
      {printable && render.css && render.body && (
        <>
          <style>{render.css}</style>
          <div className={job.status === "printed" ? "no-print" : undefined} dangerouslySetInnerHTML={{ __html: render.body }} />
        </>
      )}
    </main>
  );
}
