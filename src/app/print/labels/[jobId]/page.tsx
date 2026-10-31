import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { JobCommand } from "@/app/(app)/labels/forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { labelJobForPrint, labelKindFor, reprintReasonOptions } from "@/modules/documents";
import { LabelFace, LabelSheet, LABEL_KIND_WORDS, labelCountWords, plainPrinter, PrintLabelsButton } from "@/ui/labels";
import { Banner } from "@/ui/status";
import { recordHref, safeBack } from "../back";
import { AutoPrint, PrintedCheck, PrintNow } from "../print-bits";

export const metadata = { title: "Print labels" };
export const dynamic = "force-dynamic";

/**
 * Print page of one label job (ADR-099). The screen shows THE label (the same component as the task-screen
 * preview) and one green "Print N labels"; on paper only the labels print, one per page, at the label's size
 * (the browser's "Save as PDF" gives the same pages). The labels are re-rendered from the stored dataset with
 * the pinned layout and hash-checked, so what prints is the recorded label. A printed job does not print
 * again from here: a second set is a reprint with a reason.
 */
export default async function PrintLabelJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ auto?: string; back?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { jobId } = await params;
  const sp = await searchParams;
  let r: Awaited<ReturnType<typeof labelJobForPrint>>;
  try {
    r = await labelJobForPrint(ctx, jobId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { job, render, face } = r;
  const kind = labelKindFor({ entityType: job.entityType as "inventory_lot", appliesTo: job.appliesTo });
  const words = LABEL_KIND_WORDS[kind];
  const back = safeBack(sp.back) ?? recordHref(job.entityType, job.entityId);
  const canCreate = ctx.can("inventory.label_job.create");
  const ok = !!face && !job.voidedAt;
  const toPrint = ok && job.status === "ready" && canCreate;
  const what = job.entityName ?? job.templateName;
  const reasons = job.status === "printed" && !job.voidedAt ? await reprintReasonOptions(ctx) : [];
  const rootId = job.reprintOfId ?? job.id;

  return (
    <main className="min-h-dvh pb-10">
      <div className="no-print mx-auto grid max-w-2xl gap-4 px-4 pt-4">
        <a href={back} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back
        </a>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">
            {job.status === "printed" ? "Labels printed" : `Print ${labelCountWords(job.copies)}`}: {what}
          </h1>
          <p className="mt-1 text-[16px] text-fg-2">
            {words.stick} {job.reprintNo ? `Printed again (${job.reprintNo}).` : ""}
          </p>
        </div>
        {job.voidedAt && <Banner tone="bad" title="This label is old: do not use it">{job.voidReason} A newer label replaces it.</Banner>}
        {!render && <Banner tone="warn" title="This label is not ready">{job.errorMessage ?? "It could not be made."} Go back and press Print again.</Banner>}
        {render && render.integrity !== "ok" && (
          <Banner tone="bad" title="This label can't be printed exactly as recorded">
            Do not print it. Ask the administrator. ({render.integrity}{render.error ? `: ${render.error}` : ""})
          </Banner>
        )}
        {job.status === "failed" && (
          <Banner tone="bad" title="It did not print last time" action={canCreate ? <JobCommand jobId={job.id} kind="retry" label="Try again" variant="cta" /> : undefined}>
            {job.errorMessage ?? "The printer did not print it."}
          </Banner>
        )}
        {job.status === "cancelled" && <Banner tone="info" title="Cancelled">This label was cancelled. Go back and print a new one.</Banner>}
        {toPrint && (
          <div className="grid gap-2">
            <PrintNow label={`Print ${labelCountWords(job.copies)}`} />
            <p className="text-[14px] text-fg-2">
              In the print window pick <strong>{plainPrinter(job.printerName)}</strong> and <strong>Actual size / 100 %</strong>. To keep a file, pick <strong>Save as PDF</strong>: it looks exactly like this.
            </p>
          </div>
        )}
      </div>

      {face && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          {toPrint ? (
            <LabelSheet faces={[face]} captions={[job.copies > 1 ? `All ${job.copies} labels look like this. Real size ${face.widthMm} × ${face.heightMm} mm.` : `Real size ${face.widthMm} × ${face.heightMm} mm.`]} />
          ) : (
            <div className="grid justify-items-center">
              <LabelFace face={face} />
            </div>
          )}
        </div>
      )}

      <div className="no-print mx-auto mt-4 grid max-w-2xl gap-4 px-4">
        {toPrint && <PrintedCheck jobIds={[job.id]} count={job.copies} stick={words.stick} back={back} />}
        {job.status === "printed" && !job.voidedAt && (
          <section className="grid gap-3 rounded-[16px] border border-line bg-surface p-4">
            <p className="text-[15px]">
              Printed by {job.printedByName}
              {job.printedAt ? `, ${fmtDateTime(job.printedAt)}` : ""}.
            </p>
            {face && (
              <PrintLabelsButton
                entityType={job.entityType as "inventory_lot"}
                entityId={job.entityId}
                labelTemplateId={job.labelTemplateId}
                kind={kind}
                suggested={1}
                max={99}
                existing={{ jobId: rootId, templateId: job.labelTemplateId, status: "printed", copies: job.copies, printedAt: job.printedAt, printedByName: job.printedByName }}
                canReprint={canCreate && ctx.can("documents.reprint.create")}
                reprintReasons={reasons.map((x) => ({ code: x.code, label: x.label, requiresNote: x.requiresNote }))}
                returnTo={back}
              />
            )}
          </section>
        )}
      </div>
      <AutoPrint enabled={toPrint && sp.auto === "1"} />
    </main>
  );
}
