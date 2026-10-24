import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { IMPORT_STATUS_LABELS, importKindCatalogue, listImportJobs, listMappingProfiles, type ImportJobStatus } from "@/modules/imports";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
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
  return (
    <div className="space-y-5">
      <PageHeader
        title="Imports"
        subtitle="Load master data, opening stock and scanned records from spreadsheets: upload → map columns → validate → review → approve → post."
        actions={ctx.can("documents.legacy_document.view") ? <LinkButton href="/admin/imports/legacy-documents" variant="secondary">Legacy documents</LinkButton> : undefined}
      />
      {canCreate && uploadSites.length > 0 ? (
        <Card>
          <CardTitle>New import</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Start from the template of the kind (below). Load in this order: units and reason codes, locations, materials, products, suppliers, then scanned BMRs and the opening stock count.</p>
          <UploadForm kinds={kinds.map((k) => ({ kind: k.kind, label: k.label, available: k.available, unavailableReason: k.unavailableReason }))} sites={uploadSites} currentSiteId={uploadSites.some((s) => s.id === ctx.currentSiteId) ? ctx.currentSiteId : uploadSites[0].id} />
        </Card>
      ) : (
        <Banner tone="info" title="Read only">Your role can see imports but not upload them.</Banner>
      )}
      <Card>
        <CardTitle>Imports</CardTitle>
        <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
          <Link className="text-primary-text underline" href="/admin/imports">All</Link>
          {(["under_review", "submitted", "approved", "posted", "failed"] as const).map((s) => (
            <Link key={s} className="text-primary-text underline" href={`/admin/imports?status=${s}`}>
              {IMPORT_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet">{f.status ? "No import has this status." : "Uploaded files appear here with their validation results."}</EmptyState>
        ) : (
          <Table head={["Import", "Kind", "Site", "File", "Status", "Rows", "Created", "Uploaded"]}>
            {jobs.map((j) => (
              <tr key={j.id}>
                <Td>
                  <Link className="font-mono text-primary-text underline" href={`/admin/imports/${j.id}`}>
                    {j.importNumber}
                  </Link>
                  {j.source === "loader" && <span className="ml-1 text-[12px] text-muted">(loader)</span>}
                </Td>
                <Td>{label[j.importKind] ?? j.importKind}</Td>
                <Td>{j.siteCode}</Td>
                <Td className="max-w-[220px] truncate">{j.fileName}</Td>
                <Td>
                  <Chip tone={STATUS_TONE[j.status as ImportJobStatus] ?? "neu"}>{IMPORT_STATUS_LABELS[j.status as ImportJobStatus] ?? j.status}</Chip>
                </Td>
                <Td className="text-[13px]">
                  {j.rowsTotal} · ok {j.rowsAccepted + j.rowsHold} · dup {j.rowsDuplicate} · rej {j.rowsRejected}
                  {j.rowsPossibleDuplicate ? ` · review ${j.rowsPossibleDuplicate}` : ""}
                </Td>
                <Td>{j.rowsCreated}</Td>
                <Td className="text-[13px]">
                  {j.uploadedBy} · {fmtDateTime(j.uploadedAt)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card>
        <CardTitle>Templates</CardTitle>
        <ul className="divide-y divide-line text-[14px]">
          {kinds.map((k) => (
            <li key={k.kind} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-medium">{k.label}</span>
                <p className="text-[13px] text-muted">{k.available ? k.description : k.unavailableReason}</p>
              </div>
              <div className="flex gap-3 text-[13px]">
                <a className="text-primary-text underline" href={`/api/v1/imports/templates/${k.kind}?format=xlsx`}>
                  XLSX
                </a>
                <a className="text-primary-text underline" href={`/api/v1/imports/templates/${k.kind}?format=csv`}>
                  CSV
                </a>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted">Example rows are fictional; delete them before you upload. Formulas and macros are never run; only the values are read.</p>
      </Card>
      <Card>
        <CardTitle>Saved mapping profiles</CardTitle>
        {profiles.length === 0 ? (
          <p className="text-[13px] text-muted">None yet. Save a mapping as a profile on an import to reuse it for the next file from the same source.</p>
        ) : (
          <Table head={["Code", "Name", "Kind", "Version", "Saved by"]}>
            {profiles.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono">{p.code}</Td>
                <Td>{p.name}</Td>
                <Td>{label[p.importKind] ?? p.importKind}</Td>
                <Td>v{p.version}</Td>
                <Td className="text-[13px]">
                  {p.createdBy} · {fmtDateTime(p.createdAt)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
