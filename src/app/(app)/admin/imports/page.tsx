import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { IMPORT_STATUS_LABELS, importKindCatalogue, listImportJobs, listMappingProfiles, type ImportJobStatus } from "@/modules/imports";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Help } from "@/ui/help/help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { UploadForm } from "./forms";
import { STATUS_TONE } from "./ui";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Imports" };


/**
 * Import wizard home (US-5-08): upload a file of one import kind, templates per kind, saved mapping
 * profiles and the list of imports of the user's sites. Posting is a separate, approved step per import.
 */
export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.import_job.view")) return <Forbidden what="imports" />;
  const f = await searchParams;
  const [jobs, kinds, profiles] = await Promise.all([listImportJobs(ctx, { status: f.status, kind: f.kind }), Promise.resolve(importKindCatalogue(ctx)), listMappingProfiles(ctx)]);
  const label = Object.fromEntries(kinds.map((k) => [k.kind, k.label]));
  const canCreate = ctx.can("platform.import_job.create");
  const uploadSites = ctx.allowedSites.filter((s) => ctx.canAt("platform.import_job.create", s.id));
  const STATUS_FILTERS = ["under_review", "submitted", "approved", "posted", "failed"] as const;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Load data from a spreadsheet"
        actions={
          <>
            <Help screen="platform.import" />
            {ctx.can("documents.legacy_document.view") && (
              <MoreMenu>
                <LinkButton href="/admin/imports/legacy-documents" variant="secondary" size="sm">Old paper documents (scans)</LinkButton>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for the IT person or the owner, when starting out: load materials, products, suppliers or opening stock from Excel. Steps: download the template, fill it in, upload it, match the columns, check, get an OK, then save it for good.</PageIntro>
      {canCreate && uploadSites.length > 0 ? (
        <Card>
          <CardTitle>Load a new file</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Load in this order: units and reasons, places, materials, products, suppliers, then scanned batch records and the opening stock count.</p>
          <UploadForm
            kinds={kinds.map((k) => ({ kind: k.kind, label: k.label, available: k.available, unavailableReason: k.unavailableReason }))}
            sites={uploadSites}
            currentSiteId={uploadSites.some((s) => s.id === ctx.currentSiteId) ? ctx.currentSiteId : uploadSites[0].id}
            profiles={profiles.map((p) => ({ code: p.code, name: p.name, kindLabel: label[p.importKind] ?? p.importKind }))}
          />
        </Card>
      ) : (
        <Banner tone="info" title="You can look, not load">Your role can see the files loaded so far but not load new ones. Ask the owner.</Banner>
      )}
      <section aria-labelledby="imports-h">
        <h2 id="imports-h" className="mb-2 font-display text-[18px] font-semibold">Files loaded</h2>
        <FilterTabs
          label="Filter files"
          active={f.status ?? "all"}
          tabs={[["all", "All", "/admin/imports"] as const, ...STATUS_FILTERS.map((s) => [s, IMPORT_STATUS_LABELS[s], `/admin/imports?status=${s}`] as const)]}
        />
        {jobs.length === 0 ? (
          <Card>
            <EmptyState title="No files yet">{f.status ? "No file has this status." : "Files you upload appear here with what was found in them."}</EmptyState>
          </Card>
        ) : (
          <PlainList label="Files loaded">
            {jobs.map((j) => (
              <PlainRow
                key={j.id}
                href={`/admin/imports/${j.id}`}
                title={`${label[j.importKind] ?? j.importKind}: ${j.fileName}`}
                code={j.importNumber}
                status={<Chip tone={STATUS_TONE[j.status as ImportJobStatus] ?? "neu"}>{IMPORT_STATUS_LABELS[j.status as ImportJobStatus] ?? j.status}</Chip>}
                tone={j.status === "failed" ? "bad" : undefined}
                facts={
                  <>
                    {j.rowsTotal} rows · {j.rowsAccepted + j.rowsHold} OK · {j.rowsDuplicate} already there · {j.rowsRejected} refused
                    {j.rowsPossibleDuplicate ? ` · ${j.rowsPossibleDuplicate} to check` : ""} · {j.siteCode} · {j.uploadedBy} · {fmtDateTime(j.uploadedAt)}
                  </>
                }
              />
            ))}
          </PlainList>
        )}
      </section>
      <Card>
        <CardTitle>Templates to fill in</CardTitle>
        <ul className="divide-y divide-line text-[14px]">
          {kinds.map((k) => (
            <li key={k.kind} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <span className="font-medium">{k.label}</span>
                <p className="text-[13px] text-muted">{k.available ? k.description : k.unavailableReason}</p>
              </div>
              <div className="flex gap-2 text-[14px]">
                <a className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-primary-text" href={`/api/v1/imports/templates/${k.kind}?format=xlsx`}>
                  Excel
                </a>
                <a className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-primary-text" href={`/api/v1/imports/templates/${k.kind}?format=csv`}>
                  CSV
                </a>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-muted">The example rows are made up; delete them before you upload. Formulas and macros are never run; only the values are read.</p>
      </Card>
      <MoreDetails title={`Saved column matchings (${profiles.length})`}>
        {profiles.length === 0 ? (
          <p className="text-[13px] text-muted">None yet. When you match the columns of a file, you can save the matching for the next file from the same place.</p>
        ) : (
          <ul className="divide-y divide-line text-[14px]">
            {profiles.map((p) => (
              <li key={p.id} className="py-2">
                <span className="font-medium">{p.name}</span> <span className="text-muted">· {label[p.importKind] ?? p.importKind} · change {p.version} · {p.createdBy} · {fmtDateTime(p.createdAt)}</span>
                <span className="block font-mono text-[12px] text-muted">{p.code}</span>
              </li>
            ))}
          </ul>
        )}
      </MoreDetails>
    </div>
  );
}
