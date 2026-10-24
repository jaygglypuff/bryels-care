import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { IMPORT_STATUS_LABELS, getImportJob, issueImportFileUrl, listImportRows, previewRows, type ImportJobDetail, type ImportJobStatus } from "@/modules/imports";
import { Card, CardTitle, Dl, EmptyState, Kpi, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ApproveForm, DecisionForm, MappingForm, PostForm, ReasonForm, ScanUploadForm, SubmitForm, ValidateButton } from "../forms";
import { STATUS_TONE } from "../ui";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Import" };

const RESULT_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neu" | "hold"> = { accepted: "ok", hold: "hold", duplicate: "neu", possible_duplicate: "warn", rejected: "bad", failed: "bad", pending: "info" };
const RESULT_LABEL: Record<string, string> = { accepted: "Accepted", hold: "Accepted, on hold", duplicate: "Duplicate (skipped)", possible_duplicate: "Possible duplicate", rejected: "Rejected", failed: "Failed at posting", pending: "Not validated" };

async function link(ctx: Awaited<ReturnType<typeof requireContext>>, id: string | null) {
  if (!id) return null;
  try {
    return (await issueImportFileUrl(ctx, id)).url;
  } catch {
    return null;
  }
}

function Steps({ d }: { d: ImportJobDetail }) {
  const s = d.job.status as ImportJobStatus;
  const order: [string, boolean][] = [
    ["1 Upload", true],
    ["2 Map", !!d.mapping],
    ["3 Validate", !["uploaded", "validating"].includes(s)],
    ["4 Review & approve", ["approved", "posting", "posted", "voided"].includes(s)],
    ["5 Post", ["posted", "voided"].includes(s)],
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-[13px]">
      {order.map(([l, done]) => (
        <li key={l}>
          <Chip tone={done ? "ok" : "neu"}>{l}</Chip>
        </li>
      ))}
    </ol>
  );
}

/** One import (US-5-08 steps 2–4 and posting): mapping, validation results, duplicate decisions, approval, posting, void. */
export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ result?: string; page?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.import_job.view")) return <Forbidden what="imports" />;
  const { id } = await params;
  const sp = await searchParams;
  let d: ImportJobDetail;
  try {
    d = await getImportJob(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const j = d.job;
  const s = j.status as ImportJobStatus;
  const page = Math.max(1, Number(sp.page) || 1);
  const [rows, preview, originalUrl, resultsUrl] = await Promise.all([
    s === "uploaded" ? Promise.resolve(null) : listImportRows(ctx, id, { result: sp.result, page }),
    previewRows(ctx, id, 5),
    link(ctx, j.fileAttachmentId),
    link(ctx, j.errorFileAttachmentId),
  ]);
  const can = (p: Parameters<typeof ctx.canAt>[0]) => ctx.canAt(p, j.siteId);
  const editable = ["uploaded", "validated", "under_review", "failed"].includes(s) && !j.approvedAt && can("platform.import_job.create");
  const headers = j.headers as string[];
  const notes = (j.fileNotes as string[] | null) ?? [];
  const missingPerms = d.handler.entityPermissions.filter((p) => !ctx.canAt(p, j.siteId));
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${j.importNumber} · ${d.handler.label}`}
        subtitle={
          <>
            <Chip tone={STATUS_TONE[s] ?? "neu"}>{IMPORT_STATUS_LABELS[s] ?? s}</Chip> <span className="ml-1">{d.siteCode} · uploaded by {d.uploadedByName} {fmtDateTime(j.uploadedAt)}</span>
          </>
        }
      />
      <Steps d={d} />
      {j.failureMessage && (
        <Banner tone={s === "failed" ? "bad" : "warn"} title={s === "failed" ? "The last run failed" : "Some rows need attention"}>
          {j.failureMessage}
        </Banner>
      )}
      {(s === "validating" || s === "posting") && <Banner tone="info" title={s === "validating" ? "Validating in the background" : "Posting in the background"}>Large files run in the worker. You get a notification when it finishes; reload this page to see the progress.</Banner>}

      <Card>
        <CardTitle>File</CardTitle>
        <Dl
          items={[
            ["File", originalUrl ? <a className="text-primary-text underline" href={originalUrl}>{j.fileName}</a> : j.fileName],
            ["Format · size", `${j.fileFormat.toUpperCase()} · ${(j.sizeBytes / 1024).toFixed(1)} KB`],
            ["SHA-256", <span key="sha" className="break-all font-mono text-[12px]">{j.checksumSha256}</span>],
            ["Rows", String(j.rowsTotal)],
            ["Mapping", d.profile ? `${d.profile.code} v${d.profile.version} (${d.profile.name})` : d.mapping ? "Set on this import" : "Not set"],
            ["Source", j.source === "loader" ? "Command-line loader" : "Import wizard"],
            ...(j.reuploadReason ? ([["Loaded again because", j.reuploadReason]] as [string, string][]) : []),
          ]}
        />
        {notes.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-[13px] text-muted">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Card>

      {editable && (
        <Card>
          <CardTitle>Map the columns</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Each template column reads one column of your file. Required columns are marked *. First rows of the file:</p>
          <div className="mb-4 overflow-x-auto">
            <Table head={["Row", ...headers]}>
              {preview.map((r) => (
                <tr key={r.rowNo}>
                  <Td>{r.rowNo}</Td>
                  {headers.map((h) => (
                    <Td key={h} className="max-w-[160px] truncate text-[13px]">
                      {(r.raw as Record<string, string>)[h]}
                    </Td>
                  ))}
                </tr>
              ))}
            </Table>
          </div>
          <MappingForm jobId={j.id} columns={d.handler.columns} headers={headers} mapping={d.mapping} />
          <div className="mt-4 border-t border-line pt-3">
            <ValidateButton jobId={j.id} label={s === "uploaded" ? "Validate the file" : "Validate again"} />
          </div>
        </Card>
      )}

      {d.handler.needsScans && (
        <Card>
          <CardTitle>Scans</CardTitle>
          {d.scans.length === 0 ? <p className="text-[13px] text-muted">No scans uploaded yet.</p> : <p className="text-[13px] text-muted">{d.scans.length} scan(s): {d.scans.map((x) => x.fileName).join(", ")}</p>}
          {editable && ctx.canAt("documents.file_attachment.create", j.siteId) && (
            <div className="mt-3">
              <ScanUploadForm jobId={j.id} />
            </div>
          )}
        </Card>
      )}

      {rows && (
        <Card>
          <CardTitle>Validation results</CardTitle>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi label="Accepted" value={j.rowsAccepted} tone="good" href={`?result=accepted`} />
            <Kpi label="On hold" value={j.rowsHold} href={`?result=hold`} />
            <Kpi label="Duplicates" value={j.rowsDuplicate} href={`?result=duplicate`} />
            <Kpi label="To decide" value={j.rowsPossibleDuplicate} tone={j.rowsPossibleDuplicate ? "warn" : "neutral"} href={`?result=possible_duplicate`} />
            <Kpi label="Rejected" value={j.rowsRejected} tone={j.rowsRejected ? "bad" : "neutral"} href={`?result=rejected`} />
            <Kpi label="Warnings" value={j.rowsWarned} href={`?result=warned`} />
            <Kpi label="Created" value={j.rowsCreated} href={`?result=accepted`} />
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-[13px]">
            <Link className="text-primary-text underline" href={`/admin/imports/${j.id}`}>All rows</Link>
            {resultsUrl && <a className="text-primary-text underline" href={resultsUrl}>Results file (stored)</a>}
            <a className="text-primary-text underline" href={`/api/v1/imports/${j.id}/export?what=results`}>Download results (CSV)</a>
            {j.rowsCreated > 0 && <a className="text-primary-text underline" href={`/api/v1/imports/${j.id}/export?what=crosswalk`}>Crosswalk: row → created record</a>}
          </div>
          {rows.rows.length === 0 ? (
            <EmptyState title="No rows with this result" />
          ) : (
            <Table head={["Row", "Result", "Values", "Messages", "Record"]}>
              {rows.rows.map((r) => {
                const raw = r.raw as Record<string, string>;
                const warnings = (r.warnings as string[] | null) ?? [];
                return (
                  <tr key={r.id} className="align-top">
                    <Td>{r.rowNo}</Td>
                    <Td>
                      <Chip tone={RESULT_TONE[r.result] ?? "neu"}>{RESULT_LABEL[r.result] ?? r.result}</Chip>
                    </Td>
                    <Td className="max-w-[260px] text-[12px] text-muted">
                      {headers
                        .slice(0, 5)
                        .map((h) => raw[h])
                        .filter(Boolean)
                        .join(" · ")}
                    </Td>
                    <Td className="max-w-[340px] text-[13px]">
                      {r.errorMessage && <p className="text-[var(--bad-fg)]">{r.errorMessage}</p>}
                      {warnings.map((w) => (
                        <p key={w} className="text-muted">
                          {w}
                        </p>
                      ))}
                      {r.decision && <p className="text-muted">Decision: {r.decision.replace(/_/g, " ")}{r.decisionNote ? ` (${r.decisionNote})` : ""}</p>}
                      {r.result === "possible_duplicate" && editable && (
                        <div className="mt-2">
                          <DecisionForm jobId={j.id} rowId={r.id} againstFile={r.matchEntityType === "import_job_row"} />
                        </div>
                      )}
                    </Td>
                    <Td className="text-[13px]">{r.createdEntityLabel ?? r.matchLabel ?? ""}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
          {rows.total > rows.pageSize && (
            <div className="mt-2 flex gap-3 text-[13px]">
              {page > 1 && <Link className="text-primary-text underline" href={`?${new URLSearchParams({ ...(sp.result ? { result: sp.result } : {}), page: String(page - 1) })}`}>Previous</Link>}
              <span className="text-muted">
                Page {page} of {Math.ceil(rows.total / rows.pageSize)}
              </span>
              {page * rows.pageSize < rows.total && <Link className="text-primary-text underline" href={`?${new URLSearchParams({ ...(sp.result ? { result: sp.result } : {}), page: String(page + 1) })}`}>Next</Link>}
            </div>
          )}
        </Card>
      )}

      {d.receipts.length > 0 && (
        <Card>
          <CardTitle>Opening-balance receipts</CardTitle>
          <ul className="text-[14px]">
            {d.receipts.map((r) => (
              <li key={r.id}>
                <Link className="font-mono text-primary-text underline" href={`/inventory/receive/${r.id}`}>
                  {r.receiptNumber}
                </Link>{" "}
                · {r.lines} lines · {r.status}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-muted">Opening lots start in quarantine (or on hold / expired). QA releases them with the bulk disposition; labels print from the lot and box pages.</p>
        </Card>
      )}

      <Card>
        <CardTitle>Next step</CardTitle>
        <div className="space-y-4">
          {s === "under_review" && <p className="text-[14px]">Decide every possible duplicate (filter “To decide”), then submit.</p>}
          {s === "validated" && can("platform.import_job.submit") && <SubmitForm jobId={j.id} />}
          {s === "submitted" && can("platform.import_job.approve") && (
            <>
              {ctx.userId === j.uploadedBy || ctx.userId === j.submittedBy ? <p className="text-[14px] text-muted">You prepared this import, so a different person approves it.</p> : <ApproveForm jobId={j.id} />}
              <ReasonForm jobId={j.id} kind="return" />
            </>
          )}
          {s === "submitted" && !can("platform.import_job.approve") && <p className="text-[14px] text-muted">Waiting for approval by a site manager or system administrator (submitted by {d.submittedByName}).</p>}
          {(s === "approved" || (s === "failed" && j.approvedAt)) &&
            (can("platform.import_job.post") && missingPerms.length === 0 ? (
              <PostForm jobId={j.id} label={s === "failed" ? "Resume posting" : `Post ${j.rowsAccepted + j.rowsHold} rows`} />
            ) : (
              <p className="text-[14px] text-muted">Approved by {d.approvedByName}. Posting needs platform.import_job.post{missingPerms.length ? ` and ${missingPerms.join(", ")}` : ""} at this site.</p>
            ))}
          {s === "posted" && (
            <p className="text-[14px]">
              Posted by {d.postedByName} {fmtDateTime(j.postedAt)}: {j.rowsCreated} records created{j.rowsFailed ? `, ${j.rowsFailed} rows failed (see the results; load a corrected file for them)` : ""}.
            </p>
          )}
          {s === "posted" && d.handler.canVoid && can("platform.import_job.void") && <ReasonForm jobId={j.id} kind="void" />}
          {s === "posted" && !d.handler.canVoid && <p className="text-[13px] text-muted">Master data imports are corrected on their screens (deactivate or discontinue the records in the crosswalk).</p>}
          {["uploaded", "validated", "under_review", "submitted", "approved", "failed"].includes(s) && j.rowsCreated === 0 && (ctx.userId === j.uploadedBy ? can("platform.import_job.create") : can("platform.import_job.approve")) && <ReasonForm jobId={j.id} kind="reject" />}
          {["rejected", "voided"].includes(s) && <p className="text-[14px] text-muted">Closed: {j.rejectReason ?? j.voidReason}</p>}
        </div>
      </Card>
    </div>
  );
}
