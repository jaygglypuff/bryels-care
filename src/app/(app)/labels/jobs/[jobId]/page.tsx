import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getLabelJob, labelHistory, reprintReasonOptions, type LabelJobView } from "@/modules/documents";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { JobStatus, shortRef, STATUS_AT_PRINT } from "../../bits";
import { FailForm, JobCommand, ReprintForm, VoidForm } from "../../forms";

export const metadata = { title: "Label job" };
export const dynamic = "force-dynamic";

export default async function LabelJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ sent?: string }> }) {
  const ctx = await requireContext();
  const reprintReasons = await reprintReasonOptions(ctx);
  const reprintReason = (code: string) => reprintReasons.find((r) => r.code === code) ?? null;
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="label jobs" />;
  const { jobId } = await params;
  const { sent } = await searchParams;
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
  const back = j.entityType === "inventory_lot" ? `/inventory/${j.entityId}` : "/labels";
  const reason = j.reprintReasonCode ? reprintReason(j.reprintReasonCode)?.label ?? j.reprintReasonCode : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={`Label · ${j.entityNumber}`}
        subtitle={`${j.templateCode} · ${j.media} · ref ${shortRef(j.id)}${j.reprintNo ? ` · REPRINT ${j.reprintNo}` : ""}`}
        actions={
          <>
            <LinkButton href="/labels" variant="secondary">Print station</LinkButton>
            <LinkButton href={back} variant="secondary">Record</LinkButton>
          </>
        }
      />
      {sent && <Banner tone="ok" title="Sent to the print station">{j.stationName} will see it in its queue. Print it there, or print it here now.</Banner>}
      {j.voidedAt && <Banner tone="bad" title="Superseded label — destroy">{j.voidReason}</Banner>}
      {j.status === "failed" && <Banner tone="bad" title="Printing failed">{j.errorMessage ?? "The job failed."} Retry keeps the same label identity.</Banner>}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <CardTitle>Job</CardTitle>
          <JobStatus status={j.status} voided={!!j.voidedAt} />
        </div>
        <Dl
          items={[
            ["Copies", String(j.copies)],
            ["Station", `${j.stationName} (${j.printerName ?? "—"})`],
            ["Status at print", j.statusAtPrint ? STATUS_AT_PRINT[j.statusAtPrint] ?? j.statusAtPrint : "—"],
            ["Requested", `${j.requestedByName}, ${fmtDateTime(j.requestedAt)}`],
            ["Printed", j.printedAt ? `${j.printedByName}, ${fmtDateTime(j.printedAt)}` : "—"],
            ["Document", j.generatedDocumentId && j.documentNumber ? <Link key="d" href={`/documents/${j.generatedDocumentId}`} className="text-primary-text hover:underline">{j.documentNumber}</Link> : "—"],
            ...(reason ? ([["Reprint reason", `${reason}${j.reprintNote ? `: ${j.reprintNote}` : ""}`]] as [string, string][]) : []),
          ]}
        />
        {canCreate && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
            {j.status === "ready" && (
              <LinkButton href={`/print/labels/${j.id}`} target="_blank" variant="cta" size="lg">
                <Printer size={18} /> Print here
              </LinkButton>
            )}
            {j.status === "failed" && <JobCommand jobId={j.id} kind="retry" label="Retry (same label)" variant="cta" />}
            {["queued", "ready", "failed"].includes(j.status) && <JobCommand jobId={j.id} kind="cancel" label="Cancel job" confirm="Cancel this label job? It will not be printed." />}
          </div>
        )}
        {canCreate && j.status === "ready" && (
          <details className="mt-3 text-[13px]">
            <summary className="cursor-pointer text-muted">The printer failed?</summary>
            <div className="mt-2"><FailForm jobId={j.id} /></div>
          </details>
        )}
      </Card>

      <Card>
        <CardTitle>Prints and reprints</CardTitle>
        <ol className="divide-y divide-line text-[13px]">
          {chain.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/labels/jobs/${h.id}`} className="text-primary-text hover:underline">{h.reprintNo ? `Reprint ${h.reprintNo}` : "Original"} · {h.copies}×</Link>
              <span className="text-muted">{h.printedAt ? `${h.printedByName}, ${fmtDateTime(h.printedAt)}` : fmtDateTime(h.requestedAt)}{h.reprintReasonCode ? ` · ${reprintReason(h.reprintReasonCode)?.label ?? h.reprintReasonCode}` : ""}</span>
              <JobStatus status={h.status} voided={!!h.voidedAt} />
            </li>
          ))}
        </ol>
      </Card>

      {canReprint ? (
        <Card>
          <CardTitle>Reprint this label</CardTitle>
          <p className="mb-3 text-[13px] text-muted">For a lost or damaged label with the same content. The reprint is marked REPRINT n, linked to the original and logged with your reason.</p>
          <ReprintForm jobId={rootId} reasons={reprintReasons} maxCopies={Math.max(1, root?.copies ?? 1)} />
        </Card>
      ) : (
        root?.status === "printed" && !root.voidedAt && <p className="text-[13px] text-muted">Your role cannot reprint labels.</p>
      )}

      {ctx.can("documents.generated_document.void") && j.status === "printed" && !j.voidedAt && (
        <Card>
          <CardTitle>Label no longer matches?</CardTitle>
          <p className="mb-3 text-[13px] text-muted">After a repack or split, void the old label so the scan card warns anyone who scans it.</p>
          <VoidForm jobId={j.id} />
        </Card>
      )}
    </div>
  );
}
