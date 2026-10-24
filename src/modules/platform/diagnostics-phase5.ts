import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { redact as redactTokens } from "@/lib/auth/tokens";
import { emailSetupStatus } from "@/lib/email";
import { redact } from "@/lib/log";

/**
 * Diagnostics Phase 5 cards (US-5-13, FR-platform-09; Wave 3 W3B): Database, Imports, Alerts, Errors and
 * Integrations. Like the Phase 1 cards they render booleans, counts, names, ages and versions only:
 * never a variable value, connection string, query text, key or token (`diagnostics.no_secrets`).
 * Error messages shown are truncated and passed through both redactors.
 */

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Row[];
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const set = (name: string) => typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
const clean = (s: unknown) => String(redactTokens(redact(String(s ?? "")))).slice(0, 200);

export type DatabaseCard = {
  serverVersion: string;
  sizeBytes: number;
  connections: { used: number; max: number };
  longestTransactionSeconds: number | null;
  waitingLocks: number;
  tables: { name: string; estimatedRows: number; totalBytes: number }[];
};

export async function databaseCard(ctx: AuthContext): Promise<DatabaseCard> {
  ctx.require("platform.diagnostics.view");
  const [v] = await q(sql`select split_part(current_setting('server_version'), ' ', 1) as v, pg_database_size(current_database())::text as size`);
  const [c] = await q(sql`select (select count(*)::int from pg_stat_activity where datname = current_database()) as used, current_setting('max_connections')::int as max`);
  // Ages and counts only; query text is never read.
  const [t] = await q(sql`select extract(epoch from max(now() - xact_start))::int as age from pg_stat_activity where datname = current_database() and state <> 'idle' and xact_start is not null and pid <> pg_backend_pid()`);
  const [l] = await q(sql`select count(*)::int as n from pg_locks where not granted`);
  const tables = await q(sql`select relname as name, n_live_tup::bigint::text as rows, pg_total_relation_size(relid)::text as bytes from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc limit 10`);
  return {
    serverVersion: String(v?.v ?? "?"),
    sizeBytes: num(v?.size),
    connections: { used: num(c?.used), max: num(c?.max) },
    longestTransactionSeconds: t?.age === null || t?.age === undefined ? null : num(t.age),
    waitingLocks: num(l?.n),
    tables: tables.map((r) => ({ name: String(r.name), estimatedRows: num(r.rows), totalBytes: num(r.bytes) })),
  };
}

export type ImportStatsProvider = (organizationId: string) => Promise<{ label: string; total: number; failed: number; lastAt: Date | null }[]>;
const IMPORTS_KEY = "__bc_import_stats_providers__";

/** Plug-in point for the import wizard (W3C, US-5-08): adds its import runs to the Imports card. */
export function registerImportStatsProvider(name: string, p: ImportStatsProvider) {
  const g = globalThis as unknown as Record<string, Map<string, ImportStatsProvider> | undefined>;
  g[IMPORTS_KEY] ??= new Map();
  g[IMPORTS_KEY]!.set(name, p);
}

export type ImportsCard = { sources: { label: string; total: number; failed: number; lastAt: Date | null }[]; importJobs: { status: string; count: number }[]; wizardAvailable: boolean };

export async function importsCard(ctx: AuthContext): Promise<ImportsCard> {
  ctx.require("platform.diagnostics.view");
  const jobs = await q(sql`select status, count(*)::int as n from background_jobs where organization_id = ${ctx.organizationId}::uuid and job_kind like '%import%' and created_at > now() - interval '30 days' group by status order by status`);
  const g = globalThis as unknown as Record<string, Map<string, ImportStatsProvider> | undefined>;
  const providers = [...(g[IMPORTS_KEY]?.values() ?? [])];
  const sources = (await Promise.all(providers.map((p) => p(ctx.organizationId).catch(() => [])))).flat();
  return { sources, importJobs: jobs.map((r) => ({ status: String(r.status), count: num(r.n) })), wizardAvailable: providers.length > 0 };
}

export type AlertsCard = {
  last24h: { kind: string; count: number; open: number }[];
  actionItems: { severity: string; open: number; escalated: number }[];
  activeRules: number;
};

export async function alertsCard(ctx: AuthContext): Promise<AlertsCard> {
  ctx.require("platform.diagnostics.view");
  const alerts = await q(sql`
    select kind, count(*)::int as n, count(*) filter (where acknowledged_at is null)::int as open from notifications
    where organization_id = ${ctx.organizationId}::uuid and (kind like 'alert.%' or kind like 'action.%.escalated') and created_at > now() - interval '24 hours'
    group by kind order by kind`);
  const items = await q(sql`
    select severity, count(*)::int as open, count(*) filter (where escalated_at is not null)::int as escalated from action_items
    where organization_id = ${ctx.organizationId}::uuid and resolved_at is null group by severity order by severity`);
  const [rules] = await q(sql`select count(*)::int as n from notification_rules where organization_id = ${ctx.organizationId}::uuid and is_active`);
  return {
    last24h: alerts.map((r) => ({ kind: String(r.kind), count: num(r.n), open: num(r.open) })),
    actionItems: items.map((r) => ({ severity: String(r.severity), open: num(r.open), escalated: num(r.escalated) })),
    activeRules: num(rules?.n),
  };
}

export type ErrorsCard = {
  reporting: "disabled" | "console" | "provider";
  deadLettered24h: number;
  recentFailures: { jobKind: string; finishedAt: Date | null; message: string }[];
  failedEmails24h: number;
  failedDocuments24h: number;
  failedLabelJobs24h: number;
  deniedRequests24h: number;
};

export async function errorsCard(ctx: AuthContext): Promise<ErrorsCard> {
  ctx.require("platform.diagnostics.view");
  const dsn = (process.env.ERROR_REPORTING_DSN ?? "").trim();
  const org = ctx.organizationId;
  const [dl] = await q(sql`select count(*)::int as n from background_jobs where organization_id = ${org}::uuid and dead_lettered_at > now() - interval '24 hours'`);
  const recent = await q(sql`select job_kind, finished_at, error_message from background_jobs where organization_id = ${org}::uuid and status = 'failed' order by finished_at desc nulls last limit 5`);
  const [em] = await q(sql`select count(*)::int as n from email_outbox where (organization_id = ${org}::uuid or organization_id is null) and status = 'failed' and created_at > now() - interval '24 hours'`);
  const [gd] = await q(sql`select count(*)::int as n from generated_documents where organization_id = ${org}::uuid and status = 'failed' and generated_at > now() - interval '24 hours'`);
  const [lj] = await q(sql`select count(*)::int as n from label_jobs where organization_id = ${org}::uuid and status = 'failed' and requested_at > now() - interval '24 hours'`);
  const [dn] = await q(sql`select count(*)::int as n from audit_events where organization_id = ${org}::uuid and action = 'identity.authorization.denied' and occurred_at > now() - interval '24 hours'`);
  return {
    reporting: !dsn ? "disabled" : dsn === "console" ? "console" : "provider",
    deadLettered24h: num(dl?.n),
    recentFailures: recent.map((r) => ({ jobKind: String(r.job_kind), finishedAt: r.finished_at ? new Date(String(r.finished_at)) : null, message: clean(r.error_message) })),
    failedEmails24h: num(em?.n),
    failedDocuments24h: num(gd?.n),
    failedLabelJobs24h: num(lj?.n),
    deniedRequests24h: num(dn?.n),
  };
}

export type IntegrationStatus = "configured" | "setup_required" | "not_built";
export type IntegrationsCard = { adapters: { name: string; status: IntegrationStatus; detail: string }[] };

/** Integrations: configured / setup required per adapter, from variable presence and adapter self-checks (no values). */
export function integrationsCard(ctx: AuthContext): IntegrationsCard {
  ctx.require("platform.diagnostics.view");
  const email = emailSetupStatus();
  const storage = (process.env.FILE_STORAGE ?? "").trim().toLowerCase();
  const s3Ready = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].every(set);
  const pdf = (process.env.PDF_RENDERER ?? "disabled").trim().toLowerCase();
  return {
    adapters: [
      { name: "Email", status: email.ready ? "configured" : "setup_required", detail: email.ready ? `provider ${email.provider}` : (email.problem ?? "not set up") },
      {
        name: "File storage",
        status: storage === "local" || (storage === "s3" && s3Ready) ? "configured" : "setup_required",
        detail: storage === "s3" ? (s3Ready ? "S3-compatible bucket; all S3 variables set" : "FILE_STORAGE=s3 but an S3 variable is missing") : storage === "local" ? "local disk (development)" : "FILE_STORAGE is not set; uploads are refused",
      },
      { name: "Error reporting", status: set("ERROR_REPORTING_DSN") ? "configured" : "setup_required", detail: set("ERROR_REPORTING_DSN") ? "reporting enabled" : "ERROR_REPORTING_DSN is not set; errors are only logged" },
      { name: "Backup status", status: (process.env.BACKUP_STATUS_SOURCE ?? "").trim() === "table" ? "configured" : "setup_required", detail: "BACKUP_STATUS_SOURCE=table reads backup_runs" },
      { name: "PDF rendering", status: pdf === "disabled" ? "configured" : "setup_required", detail: pdf === "disabled" ? "browser print and Save as PDF (ADR-026); no server-side PDF" : "a server PDF renderer is not built in this release" },
      { name: "Alert webhook", status: "not_built", detail: set("ALERT_WEBHOOK_URL") ? "variable set, but chat delivery is not built yet; alerts are in-app" : "chat delivery is not built yet; alerts are in-app" },
      { name: "Payment provider", status: "not_built", detail: "customer portal payments arrive in Phase 8" },
      { name: "Accountant export", status: "not_built", detail: "arrives with finance in Phase 6" },
    ],
  };
}
