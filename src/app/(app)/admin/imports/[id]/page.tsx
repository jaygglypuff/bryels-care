import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { IMPORT_STATUS_LABELS, getImportJob, issueImportFileUrl, listImportRows, previewRows, type ImportJobDetail, type ImportJobStatus } from "@/modules/imports";
import { Card, CardTitle, Dl, EmptyState, Kpi, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../forbidden";
import { ApproveForm, DecisionForm, MappingForm, PostForm, ReasonForm, ScanUploadForm, SubmitForm, ValidateButton } from "../forms";
import { STATUS_TONE } from "../ui";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Import" };

const RESULT_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neu" | "hold"> = { accepted: "ok", hold: "hold", duplicate: "neu", possible_duplicate: "warn", rejected: "bad", failed: "bad", pending: "info" };
const RESULT_LABEL: Record<string, string> = { accepted: "OK", hold: "OK, stopped for QA", duplicate: "Already there (skipped)", possible_duplicate: "Maybe already there", rejected: "Refused", failed: "Failed when saving", pending: "Not checked yet" };

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

/** The one thing to do now on this import, in plain words (ADR-088). */
function NextStepFor({ d, canApprove, canSubmit, canPost, editable, isPreparer }: { d: ImportJobDetail; canApprove: boolean; canSubmit: boolean; canPost: boolean; editable: boolean; isPreparer: boolean }) {
  const s = d.job.status as ImportJobStatus;
  if (s === "uploaded" && editable) return <NextStep text="Match the columns of your file, then press “Validate the file”." action={{ label: "Match columns", href: "#map" }} />;
  if (s === "under_review") return <NextStep text="Some rows may already exist. Decide each one, then send the file for OK." action={{ label: "Decide rows", href: "?result=possible_duplicate" }} />;
  if (s === "validated" && canSubmit) return <NextStep text="The check is done. Send the file for OK." action={{ label: "Send for OK", href: "#next" }} />;
  if (s === "submitted") return canApprove && !isPreparer ? <NextStep text="This file waits for your OK." action={{ label: "Decide", href: "#next" }} /> : <NextStep text="Waiting for an OK." waitingFor="The site manager or the IT person (not the person who prepared it) says OK." />;
  if ((s === "approved" || (s === "failed" && d.job.approvedAt)) && canPost) return <NextStep text="OK'd. Save the rows for good." action={{ label: "Save now", href: "#next" }} />;
  if (s === "failed") return <NextStep text="The last try failed. Read the message, fix the file, and validate again." action={{ label: "See what to do", href: "#next" }} />;
  return null;
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
        title={`${d.handler.label}: ${j.fileName}`}
        subtitle={
          <>
            <Chip tone={STATUS_TONE[s] ?? "neu"}>{IMPORT_STATUS_LABELS[s] ?? s}</Chip> <span className="ml-1">{d.siteCode} · uploaded by {d.uploadedByName} {fmtDateTime(j.uploadedAt)} · </span>
            <RecordNo>{j.importNumber}</RecordNo>
          </>
        }
      />
      <PageIntro>This screen is for loading one spreadsheet: match the columns, let the system check every row, decide the rows it is unsure about, get an OK, then save it for good. Nothing is saved for good before the last step.</PageIntro>
      <NextStepFor d={d} canApprove={can("platform.import_job.approve")} canSubmit={can("platform.import_job.submit")} canPost={can("platform.import_job.post") && missingPerms.length === 0} editable={editable} isPreparer={ctx.userId === j.uploadedBy || ctx.userId === j.submittedBy} />
      <Steps d={d} />
      {j.failureMessage && (
        <Banner tone={s === "failed" ? "bad" : "warn"} title={s === "failed" ? "The last run failed" : "Some rows need attention"}>
          {j.failureMessage}
        </Banner>
      )}
      {(s === "validating" || s === "posting") && <Banner tone="info" title={s === "validating" ? "Checking the rows in the background" : "Saving in the background"}>Big files take a while. You get a message when it is done; open this page again to see how far it is.</Banner>}

      <MoreDetails title="About the file (name, size, check number)">
        <Dl
          items={[
            ["File", originalUrl ? <a className="text-primary-text underline" href={originalUrl}>{j.fileName}</a> : j.fileName],
            ["Format · size", `${j.fileFormat.toUpperCase()} · ${(j.sizeBytes / 1024).toFixed(1)} KB`],
            ["Check number (SHA-256)", <span key="sha" className="break-all font-mono text-[12px]">{j.checksumSha256}</span>],
            ["Rows", String(j.rowsTotal)],
            ["Column matching", d.profile ? `${d.profile.name} (change ${d.profile.version})` : d.mapping ? "Set on this file" : "Not set yet"],
            ["Loaded with", j.source === "loader" ? "The IT person's loader" : "This screen"],
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
      </MoreDetails>

      {editable && (
        <Card id="map">
          <CardTitle>Match the columns</CardTitle>
          <p className="mb-3 text-[13px] text-muted">For each line below, pick the column of your file that holds it. Lines marked * must be matched.</p>
          <details className="mb-4">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">See the first rows of your file</summary>
          <div className="overflow-x-auto">
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
          </details>
          <MappingForm jobId={j.id} columns={d.handler.columns} headers={headers} mapping={d.mapping} />
          <div className="mt-4 border-t border-line pt-3">
            <ValidateButton jobId={j.id} label={s === "uploaded" ? "Validate the file" : "Validate again"} />
            <p className="mt-1 text-[13px] text-muted">“Validate” = the system checks every row. Nothing is saved yet.</p>
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
          <CardTitle>What the check found</CardTitle>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi label="Accepted" value={j.rowsAccepted} tone="good" href={`?result=accepted`} />
            <Kpi label="On hold" value={j.rowsHold} href={`?result=hold`} />
            <Kpi label="Already there" value={j.rowsDuplicate} href={`?result=duplicate`} />
            <Kpi label="To decide" value={j.rowsPossibleDuplicate} tone={j.rowsPossibleDuplicate ? "warn" : "neutral"} href={`?result=possible_duplicate`} />
            <Kpi label="Refused" value={j.rowsRejected} tone={j.rowsRejected ? "bad" : "neutral"} href={`?result=rejected`} />
            <Kpi label="Warnings" value={j.rowsWarned} href={`?result=warned`} />
            <Kpi label="Created" value={j.rowsCreated} href={`?result=accepted`} />
          </div>
          <div className="mb-2 flex flex-wrap gap-x-4 text-[14px]">
            <Link className="inline-flex min-h-[44px] items-center text-primary-text underline" href={`/admin/imports/${j.id}`}>All rows</Link>
            <a className="inline-flex min-h-[44px] items-center text-primary-text underline" href={`/api/v1/imports/${j.id}/export?what=results`}>Download what was found (CSV)</a>
            {resultsUrl && <a className="inline-flex min-h-[44px] items-center text-primary-text underline" href={resultsUrl}>Saved results file</a>}
            {j.rowsCreated > 0 && <a className="inline-flex min-h-[44px] items-center text-primary-text underline" href={`/api/v1/imports/${j.id}/export?what=crosswalk`}>Which row made which record</a>}
          </div>
          {rows.rows.length === 0 ? (
            <EmptyState title="No rows with this result" />
          ) : (
            <ul aria-label="Rows" className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {rows.rows.map((r) => {
                const raw = r.raw as Record<string, string>;
                const warnings = (r.warnings as string[] | null) ?? [];
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-fg">Row {r.rowNo}</span>
                      <Chip tone={RESULT_TONE[r.result] ?? "neu"}>{RESULT_LABEL[r.result] ?? r.result}</Chip>
                      {(r.createdEntityLabel ?? r.matchLabel) && <span className="text-[13px] text-fg-2">→ {r.createdEntityLabel ?? r.matchLabel}</span>}
                    </div>
                    <p className="mt-0.5 break-words text-[13px] text-muted">
                      {headers
                        .slice(0, 5)
                        .map((h) => raw[h])
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="text-[13px]">
                      {r.errorMessage && <p className="text-[var(--bad-fg)]">{r.errorMessage}</p>}
                      {warnings.map((w) => (
                        <p key={w} className="text-muted">
                          {w}
                        </p>
                      ))}
                      {r.decision && <p className="text-muted">Decision: {r.decision.replace(/_/g, " ")}{r.decisionNote ? ` (${r.decisionNote})` : ""}</p>}
                      {r.result === "possible_duplicate" && editable && (
                        <div className="mt-2 max-w-md">
                          <DecisionForm jobId={j.id} rowId={r.id} againstFile={r.matchEntityType === "import_job_row"} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
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
          <CardTitle>Opening stock deliveries</CardTitle>
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
          <p className="mt-2 text-[13px] text-muted">Opening stock starts as “waiting for QA check” (or stopped / expired). QA lets it be used with “Decide many lots at once”; labels print from the lot and box pages.</p>
        </Card>
      )}

      <Card id="next">
        <CardTitle>What to do now</CardTitle>
        <div className="space-y-4">
          {s === "under_review" && <p className="text-[14px]">Decide every row marked “Maybe already there” (tap “To decide” above), then send it for OK.</p>}
          {s === "validated" && can("platform.import_job.submit") && <SubmitForm jobId={j.id} />}
          {s === "submitted" && can("platform.import_job.approve") && (
            <>
              {ctx.userId === j.uploadedBy || ctx.userId === j.submittedBy ? <p className="text-[14px] text-muted">You prepared this file, so another person must say OK.</p> : <ApproveForm jobId={j.id} />}
              <ReasonForm jobId={j.id} kind="return" />
            </>
          )}
          {s === "submitted" && !can("platform.import_job.approve") && <p className="text-[14px] text-muted">Waiting for an OK from the site manager or the IT person (sent by {d.submittedByName}).</p>}
          {(s === "approved" || (s === "failed" && j.approvedAt)) &&
            (can("platform.import_job.post") && missingPerms.length === 0 ? (
              <PostForm jobId={j.id} label={s === "failed" ? "Carry on saving" : `Save ${j.rowsAccepted + j.rowsHold} rows for good`} />
            ) : (
              <>
                <p className="text-[14px] text-muted">OK&apos;d by {d.approvedByName}. Saving it for good needs more permission at this site; ask the site manager or the IT person.</p>
                <MoreDetails title="Technical names">
                  <p className="break-all font-mono text-[12px] text-muted">platform.import_job.post{missingPerms.length ? `, ${missingPerms.join(", ")}` : ""}</p>
                </MoreDetails>
              </>
            ))}
          {s === "posted" && (
            <p className="text-[14px]">
              Saved for good by {d.postedByName} {fmtDateTime(j.postedAt)}: {j.rowsCreated} records made{j.rowsFailed ? `, ${j.rowsFailed} rows failed (see what was found; load a fixed file for them)` : ""}.
            </p>
          )}
          {s === "posted" && d.handler.canVoid && can("platform.import_job.void") && <ReasonForm jobId={j.id} kind="void" />}
          {s === "posted" && !d.handler.canVoid && <p className="text-[13px] text-muted">To fix records made from this file, change them on their own screens (switch off the ones listed in “Which row made which record”).</p>}
          {["uploaded", "validated", "under_review", "submitted", "approved", "failed"].includes(s) && j.rowsCreated === 0 && (ctx.userId === j.uploadedBy ? can("platform.import_job.create") : can("platform.import_job.approve")) && <ReasonForm jobId={j.id} kind="reject" />}
          {["rejected", "voided"].includes(s) && <p className="text-[14px] text-muted">Closed: {j.rejectReason ?? j.voidReason}</p>}
        </div>
      </Card>
    </div>
  );
}
