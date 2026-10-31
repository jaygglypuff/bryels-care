import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getLabelJob, labelHistory, reprintReasonOptions, type LabelJobView } from "@/modules/documents";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { recordHref } from "@/app/print/labels/back";
import { Forbidden } from "../../../forbidden";
import { JobStatus, shortRef, STATE_WORDS } from "../../bits";
import { FailForm, JobCommand, ReprintForm, VoidForm } from "../../forms";

export const metadata = { title: "Label" };
export const dynamic = "force-dynamic";

/**
 * One label job (US-2-12), grade-5 (ADR-088): one next step (print / try again / nothing), the reprint chain,
 * and the rare actions (cancel, "did not print", old label) in ⋯ More. Reprints keep their reason on record.
 */
export default async function LabelJobPage({ params, }: { params: Promise<{ jobId: string }> }) {
  const ctx = await requireContext();
  const reprintReasons = await reprintReasonOptions(ctx);
  const reprintReason = (code: string) => reprintReasons.find((r) => r.code === code) ?? null;
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="labels" />;
  const { jobId } = await params;
  let j: LabelJobView;
  try {
    j = await getLabelJob(ctx, jobId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const history = await labelHistory(ctx, j.entityType, j.entityId);
  const rootId = j.reprintOfId ?? j.id;
  const chain = history.filter((h) => h.id === rootId || h.reprintOfId === rootId).sort((a, b) => a.reprintNo - b.reprintNo);
  const root = chain.find((h) => h.id === rootId);
  const canCreate = ctx.can("inventory.label_job.create");
  const canReprint = canCreate && ctx.can("documents.reprint.create") && root?.status === "printed" && !root.voidedAt;
  const canVoid = ctx.can("documents.generated_document.void") && j.status === "printed" && !j.voidedAt;
  const back = recordHref(j.entityType, j.entityId);
  const reason = j.reprintReasonCode ? reprintReason(j.reprintReasonCode)?.label ?? j.reprintReasonCode : null;
  const what = j.entityName ?? j.templateName;

  const next = j.voidedAt ? (
    <NextStep text="This label is old: throw it away. A newer label replaces it." />
  ) : j.status === "ready" && canCreate ? (
    <NextStep text="Not printed yet. Open it and print it." action={{ label: "Print it", href: `/print/labels/${j.id}?back=${encodeURIComponent(back)}` }} />
  ) : j.status === "ready" || j.status === "queued" || j.status === "rendering" ? (
    <NextStep text="Not printed yet." waitingFor="Waiting for someone who may print labels." />
  ) : j.status === "failed" ? (
    <NextStep text="It did not print. Fix the printer, then try again (the label stays the same)." action={canCreate ? { label: "Try again", href: "#retry" } : undefined} />
  ) : j.status === "printed" ? (
    <NextStep text="Printed. Stick it on the sack or box. Nothing more to do." />
  ) : (
    <NextStep text="Cancelled. Nothing more to do." />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={`Label: ${what}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <RecordNo>{j.entityNumber}</RecordNo> <JobStatus status={j.status} voided={!!j.voidedAt} />
            {j.reprintNo ? <span>printed again ({j.reprintNo})</span> : null}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href={back} variant="secondary">Open what the label is for</LinkButton>
              <LinkButton href="/labels" variant="secondary">Labels printed</LinkButton>
              {canCreate && ["queued", "ready", "failed"].includes(j.status) && <JobCommand jobId={j.id} kind="cancel" label="Cancel this label" confirm="Cancel this label? It will not be printed." />}
              {canCreate && j.status === "ready" && (
                <div>
                  <p className="mb-2 text-[13px] font-medium">The printer did not print it?</p>
                  <FailForm jobId={j.id} />
                </div>
              )}
              {canVoid && (
                <div>
                  <p className="mb-2 text-[13px] text-fg-2">After a repack or split, mark the old label so anyone who scans it is warned.</p>
                  <VoidForm jobId={j.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one label: see who printed it and when, or print it again when it got lost or damaged.</PageIntro>
      {j.voidedAt && <Banner tone="bad" title="Old label: throw it away">{j.voidReason}</Banner>}
      {j.status === "failed" && <Banner tone="bad" title="It did not print">{j.errorMessage ?? "The printer did not print it."}</Banner>}
      {next}
      {canCreate && j.status === "failed" && (
        <div id="retry">
          <JobCommand jobId={j.id} kind="retry" label="Try again (same label)" variant="cta" />
        </div>
      )}

      <Card>
        <CardTitle>About this label</CardTitle>
        <Dl
          items={[
            ["How many", `${j.copies} × ${j.media}`],
            ["State on the label", j.statusAtPrint ? STATE_WORDS[j.statusAtPrint] ?? j.statusAtPrint : "—"],
            ["Asked by", `${j.requestedByName}, ${fmtDateTime(j.requestedAt)}`],
            ["Printed", j.printedAt ? `${j.printedByName}, ${fmtDateTime(j.printedAt)}` : "—"],
            ...(reason ? ([["Why printed again", `${reason}${j.reprintNote ? `: ${j.reprintNote}` : ""}`]] as [string, string][]) : []),
          ]}
        />
        <div className="mt-3">
          <MoreDetails>
            <Dl
              items={[
                ["Label layout", j.templateName],
                ["Reference", shortRef(j.id)],
                ["Paper record", j.generatedDocumentId && j.documentNumber ? <Link key="d" href={`/documents/${j.generatedDocumentId}`} className="text-primary-text hover:underline">{j.documentNumber}</Link> : "—"],
              ]}
            />
          </MoreDetails>
        </div>
      </Card>

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">First print and prints again</h2>
        <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
          {chain.map((h) => (
            <li key={h.id}>
              <Link href={`/labels/jobs/${h.id}`} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-4 py-2 hover:bg-surface-2">
                <span className="min-w-0 text-[14px]">
                  <span className="font-semibold">{h.reprintNo ? `Printed again (${h.reprintNo})` : "First print"}</span> · {h.copies}×
                  <span className="block text-[13px] text-fg-2">
                    {h.printedAt ? `${h.printedByName}, ${fmtDateTime(h.printedAt)}` : fmtDateTime(h.requestedAt)}
                    {h.reprintReasonCode ? ` · ${reprintReason(h.reprintReasonCode)?.label ?? h.reprintReasonCode}` : ""}
                  </span>
                </span>
                <JobStatus status={h.status} voided={!!h.voidedAt} />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {canReprint ? (
        <Card>
          <CardTitle>Print this label again</CardTitle>
          <p className="mb-3 text-[13px] text-fg-2">For a lost or damaged label with the same content. It is marked as printed again, linked to the first one, and kept on record with your reason.</p>
          <ReprintForm jobId={rootId} reasons={reprintReasons} maxCopies={Math.max(1, root?.copies ?? 1)} />
        </Card>
      ) : (
        root?.status === "printed" && !root.voidedAt && <p className="text-[13px] text-fg-2">Your job cannot print labels again. Ask the warehouse lead.</p>
      )}
    </div>
  );
}
