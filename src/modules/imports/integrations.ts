import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Read models the import wizard offers other modules (plugged in by src/modules/wiring.ts): the
 * action centre's "failed import" and "import to approve" items and the diagnostics Imports card.
 * Raw rows only; the action centre and diagnostics apply their own permission checks.
 */
type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];
const at = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export type ImportActionCandidate = {
  kind: "failed_import" | "approval.import_job";
  siteId: string | null;
  entityType: string;
  entityId: string;
  recordNumber: string | null;
  title: string;
  detail: string | null;
  link: string;
  openedAt: Date;
};

/** Import jobs that failed (validation or posting), plus failed import background jobs without a job row. */
export async function failedImportCandidates(organizationId: string): Promise<ImportActionCandidate[]> {
  const jobs = await run(sql`
    select id, site_id, import_number, import_kind, left(coalesce(failure_message, ''), 200) as err, updated_at as at
    from import_jobs where organization_id = ${organizationId}::uuid and status = 'failed'`);
  const bg = await run(sql`
    select id, site_id, job_kind, finished_at as at, left(coalesce(error_message, ''), 200) as err from background_jobs
    where organization_id = ${organizationId}::uuid and status = 'failed' and job_kind like '%import%'
      and not exists (select 1 from import_jobs j where j.organization_id = background_jobs.organization_id and j.status = 'failed' and background_jobs.payload->>'importJobId' = j.id::text)`);
  return [
    ...jobs.map((r) => ({
      kind: "failed_import" as const, siteId: r.site_id ? String(r.site_id) : null, entityType: "import_job", entityId: String(r.id), recordNumber: String(r.import_number),
      title: `Import ${r.import_number} (${String(r.import_kind).replace(/_/g, " ")}) failed`, detail: String(r.err) || null, link: `/admin/imports/${r.id}`, openedAt: at(r.at),
    })),
    ...bg.map((r) => ({
      kind: "failed_import" as const, siteId: r.site_id ? String(r.site_id) : null, entityType: "background_job", entityId: String(r.id), recordNumber: String(r.job_kind),
      title: `Import job ${r.job_kind} failed`, detail: String(r.err) || null, link: `/admin/diagnostics?job=${r.id}#jobs`, openedAt: at(r.at ?? new Date()),
    })),
  ];
}

/** Submitted imports waiting for a second person's approval. */
export async function importApprovalCandidates(organizationId: string): Promise<ImportActionCandidate[]> {
  const rows = await run(sql`
    select id, site_id, import_number, import_kind, rows_total, coalesce(submitted_at, updated_at) as at
    from import_jobs where organization_id = ${organizationId}::uuid and status = 'submitted'`);
  return rows.map((r) => ({
    kind: "approval.import_job" as const, siteId: r.site_id ? String(r.site_id) : null, entityType: "import_job", entityId: String(r.id), recordNumber: String(r.import_number),
    title: `Import ${r.import_number} (${String(r.import_kind).replace(/_/g, " ")}) waits for approval`, detail: `${r.rows_total} row(s)`, link: `/admin/imports/${r.id}`, openedAt: at(r.at),
  }));
}

/** Import wizard runs of the last 30 days per kind, for the diagnostics Imports card. */
export async function importWizardStats(organizationId: string) {
  const rows = await run(sql`
    select import_kind, count(*)::int as total, count(*) filter (where status = 'failed')::int as failed, max(uploaded_at) as last_at
    from import_jobs where organization_id = ${organizationId}::uuid and uploaded_at > now() - interval '30 days'
    group by import_kind order by import_kind`);
  return rows.map((r) => ({ label: `Import wizard: ${String(r.import_kind).replace(/_/g, " ")}`, total: Number(r.total), failed: Number(r.failed), lastAt: r.last_at ? at(r.last_at) : null }));
}
