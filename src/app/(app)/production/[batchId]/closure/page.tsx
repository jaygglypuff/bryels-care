import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { type ClosureView, getClosureView, listPaperRecords, paperScanDownloadUrl } from "@/modules/production";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { AmendmentForm, AttachPaperForm, CloseBatchForm, DecideReopenForm, IssuePaperForm, ReopenRequestForm, ReviewPaperForm, VoidPaperForm, WithdrawReopenForm } from "./forms";
import { Help } from "@/ui/help/help";
import { PageIntro } from "@/ui/guide";

export const metadata = { title: "Batch closure and records" };
export const dynamic = "force-dynamic";

/**
 * Batch closure, controlled reopen / amendment and hybrid paper pages (US-3-19, US-3-20).
 * Readiness checks come from the service; buttons appear only for people the service would accept,
 * and the service re-checks everything.
 */
export default async function ClosurePage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="batch records" />;
  const { batchId } = await params;
  let v: ClosureView;
  try {
    v = await getClosureView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const papers = await listPaperRecords(ctx, batchId);
  const canDownload = ctx.can("documents.file_attachment.view");
  const links = new Map<string, string>();
  if (canDownload) for (const p of papers) if (p.fileAttachmentId && p.status !== "void") links.set(p.id, await paperScanDownloadUrl(ctx, p.id));
  const decided = v.batch.status === "released" || v.batch.status === "rejected";
  const blockers = v.checks.filter((c) => c.blocking && !c.ok);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={`Close the batch · ${v.batch.number}`}
        subtitle={`${v.batch.productName} · site ${v.batch.siteCode}${v.reopenCount ? ` · reopened ${v.reopenCount} ${v.reopenCount === 1 ? "time" : "times"}` : ""}`}
        actions={
          <>
            <Help screen="production.bmr" />
            <LinkButton href={`/production/${v.batch.id}`} variant="secondary">
              Back to batch
            </LinkButton>
            <LinkButton href={`/print/bmr/${v.batch.id}`} variant="secondary" target="_blank">
              Print batch record
            </LinkButton>
          </>
        }
      />
      <PageIntro>Last check after QA: every record is complete, then the batch is closed for good.</PageIntro>

      {v.activeReopenNo && (
        <Banner tone="warn" title={`Reopened for amendment (rev ${v.activeReopenNo})`}>
          Record each correction below with its reason, then close the batch again. The new batch record prints as AMENDED rev {v.activeReopenNo} and replaces the earlier copy.
        </Banner>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CardTitle>Closure checks</CardTitle>
          <StatusChip status={v.batch.status} />
        </div>
        <ul className="divide-y divide-line text-[14px]">
          {v.checks.map((c) => (
            <li key={c.code} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="font-medium">{c.label}</span>
              <span className="flex min-w-0 flex-col items-start gap-1 sm:items-end sm:text-right">
                <Chip tone={c.ok ? "ok" : c.blocking ? "bad" : "warn"}>{c.ok ? "OK" : c.blocking ? "Blocks closure" : "Info"}</Chip>
                <span className="text-[13px] text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          {v.batch.status === "closed" ? (
            <p className="text-[13px] text-muted">This batch is closed. The record is final; corrections need a controlled reopen.</p>
          ) : !decided ? (
            <p className="text-[13px] text-muted">The batch can be closed after QA releases or rejects it.</p>
          ) : !v.can.close ? (
            <p className="text-[13px] text-muted">Closing needs a site manager (production.batch.approve).</p>
          ) : blockers.length ? (
            <Banner tone="bad" title={`${blockers.length} item(s) block closure`}>
              Resolve the items marked “Blocks closure”, then close.
            </Banner>
          ) : (
            <CloseBatchForm batchId={v.batch.id} batchNumber={v.batch.number} />
          )}
        </div>
        {v.closures.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-[13px] font-semibold">Closures</h3>
            <ul className="divide-y divide-line text-[13px]">
              {v.closures.map((c) => (
                <li key={c.id} className="py-2">
                  Closure {c.closureNo} from {c.fromState} · {c.closedByName}, {fmtDateTime(c.closedAt)}
                  {c.reservationsReleased ? ` · ${c.reservationsReleased} ${c.reservationsReleased === 1 ? "reservation" : "reservations"} released` : ""} ·{" "}
                  <Link href={`/print/bmr/${v.batch.id}?doc=${c.generatedDocumentId}`} className="text-primary-text hover:underline">
                    final batch record
                  </Link>
                  {c.note ? <span className="block text-muted">{c.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Controlled reopen</CardTitle>
        <p className="mb-3 text-[13px] text-muted">
          A closed batch is reopened only with a reason, approved by a site manager and co-approved by a different QA user (two approvals). Revisions and the snapshot never change.
        </p>
        {v.pending ? (
          <div className="space-y-3">
            <Banner tone="info" title={`Waiting for ${v.pending.nextStep?.label.toLowerCase() ?? "a decision"}`}>
              {v.reopens.find((r) => r.id === v.pending!.id)?.reason}
            </Banner>
            {v.pending.canDecide && v.pending.nextStep && <DecideReopenForm batchId={v.batch.id} requestId={v.pending.id} stepLabel={`Step ${v.pending.nextStep.step}: ${v.pending.nextStep.label}`} />}
            {v.can.requestReopen && <WithdrawReopenForm batchId={v.batch.id} requestId={v.pending.id} />}
          </div>
        ) : v.batch.status === "closed" && v.can.requestReopen ? (
          <ReopenRequestForm batchId={v.batch.id} fromState={v.lastClosureFromState} />
        ) : v.batch.status === "closed" ? (
          <p className="text-[13px] text-muted">Only a site manager can request a reopen.</p>
        ) : null}
        {v.reopens.length > 0 && (
          <ul className="mt-4 divide-y divide-line text-[13px]">
            {v.reopens.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-medium">
                  {r.status === "reopened" ? `Reopen ${r.reopenNo}` : "Request"} · {r.status}
                </span>{" "}
                → {r.targetState} · requested by {r.requestedByName}, {fmtDateTime(r.requestedAt)}
                <span className="block text-muted">
                  {r.reason} (scope: {r.amendmentScope})
                </span>
                {r.decisions.map((d) => (
                  <span key={`${d.step}-${d.by}`} className="block text-muted">
                    Step {d.step}: {d.decision} by {d.by}, {fmtDateTime(d.at)}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Amendments</CardTitle>
        {v.amendments.length === 0 ? (
          <p className="text-[13px] text-muted">No amendments. They can be recorded only while the batch is reopened.</p>
        ) : (
          <ul className="mb-3 divide-y divide-line text-[13px]">
            {v.amendments.map((a) => (
              <li key={a.id} className="py-2">
                <span className="font-medium">A{a.amendmentNo}</span> · {a.section.replace(/_/g, " ")} · {a.reference}: <s>{a.previousValue}</s> → <b className={a.superseded ? "line-through" : ""}>{a.correctedValue}</b>
                <span className="block text-muted">
                  {a.reason} · {a.recordedByName}, {fmtDateTime(a.recordedAt)}
                  {a.superseded ? " · corrected by a later amendment" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {v.activeReopenNo && v.can.amend && <AmendmentForm batchId={v.batch.id} amendments={v.amendments.map((a) => ({ id: a.id, amendmentNo: a.amendmentNo, reference: a.reference, superseded: a.superseded }))} />}
      </Card>

      <Card>
        <CardTitle>Paper record pages</CardTitle>
        <p className="mb-3 text-[13px] text-muted">
          For steps your SOP requires on paper: print a numbered blank page, complete it by hand, enter the values in the system, attach the scan, and have a different person confirm the transcription. Unreviewed pages block QA release and closure.
        </p>
        {v.can.issuePaper && v.batch.status !== "closed" && <IssuePaperForm batchId={v.batch.id} steps={v.steps} />}
        {papers.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No paper pages">All steps of this batch are recorded electronically.</EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {papers.map((p) => (
              <li key={p.id} className="rounded-[12px] border border-line p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{p.paperReference}</span>
                  <Chip tone={p.status === "reviewed" ? "ok" : p.status === "void" ? "neu" : p.status === "returned" ? "bad" : "warn"}>{p.status}</Chip>
                </div>
                <p className="mt-1">
                  Step {p.stepNo}. {p.stepName} · mode {p.recordMode.replace(/_/g, " ")} · issued by {p.issuedByName}, {fmtDateTime(p.issuedAt)}
                </p>
                {p.generatedDocumentId && (
                  <Link href={`/print/documents/${p.generatedDocumentId}`} target="_blank" className="mt-1 inline-flex min-h-[44px] items-center text-primary-text hover:underline">
                    Print blank page
                  </Link>
                )}
                {p.fileName && (
                  <p className="text-muted">
                    Scan: {links.get(p.id) ? <a href={links.get(p.id)} className="text-primary-text hover:underline">{p.fileName}</a> : p.fileName} ({p.sha8}) · transcribed by {p.transcribedByName}
                    {p.transcribedAt ? `, ${fmtDateTime(p.transcribedAt)}` : ""}
                  </p>
                )}
                {p.reviewedByName && <p className="text-muted">Reviewed by {p.reviewedByName}, {fmtDateTime(p.reviewedAt)}</p>}
                {p.reviewNote && <p className="text-muted">Review note: {p.reviewNote}</p>}
                {p.voidReason && <p className="text-muted">Void: {p.voidReason}</p>}
                <div className="mt-2 space-y-3">
                  {(p.status === "issued" || p.status === "returned") && v.can.attachPaper && <AttachPaperForm paperRecordId={p.id} />}
                  {p.status === "attached" && v.can.reviewPaper && p.transcribedBy !== ctx.userId && <ReviewPaperForm batchId={v.batch.id} paperRecordId={p.id} />}
                  {p.status === "attached" && p.transcribedBy === ctx.userId && <p className="text-muted">You transcribed this page; another person must review it.</p>}
                  {(p.status === "issued" || p.status === "returned") && v.can.issuePaper && <VoidPaperForm batchId={v.batch.id} paperRecordId={p.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
