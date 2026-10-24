import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backgroundJobs, backupRuns, metricsSamples, reconciliationRuns, workerHeartbeats } from "@/db/schema";
import { logger } from "@/lib/log";
import { sweepBuckets } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import { defineJob } from "@/modules/platform/job-definition";
import { notifyUsers, usersWithRoles } from "@/modules/platform/notifications";

/**
 * `platform.metrics_sample` and `platform.alerts_evaluate` (docs/architecture.md §8,
 * docs/deployment-railway.md §8.2–8.3). Both run every 5 minutes as the organization's system
 * actor, keyed by the 5-minute slot so a duplicate tick is dropped.
 */
const slotOf = (now: Date) => new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
const SlotPayload = z.object({ slot: z.iso.datetime() }).strict();
type SlotPayload = z.infer<typeof SlotPayload>;

export type MetricReading = { metric: string; value: number; labels?: Record<string, string> };

/** Current readings (exported for tests). Values only: counts, ages, sizes. */
export async function readMetrics(organizationId: string, now: Date): Promise<MetricReading[]> {
  const out: MetricReading[] = [];
  const [q] = await db.execute<{ queued: number; oldest: number | null }>(sql`
    select count(*)::int as queued, extract(epoch from (${now.toISOString()}::timestamptz - min(created_at)))::int as oldest
    from background_jobs where organization_id = ${organizationId} and status = 'queued'`);
  out.push({ metric: "jobs.queue_depth", value: Number(q?.queued ?? 0) });
  out.push({ metric: "jobs.oldest_queued_seconds", value: Number(q?.oldest ?? 0) });
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, organizationId), eq(backgroundJobs.status, "failed"), gte(backgroundJobs.finishedAt, hourAgo)));
  out.push({ metric: "jobs.failed_last_hour", value: Number(f?.n ?? 0) });
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, organizationId), isNotNull(backgroundJobs.deadLetteredAt), gte(backgroundJobs.deadLetteredAt, hourAgo)));
  out.push({ metric: "jobs.dead_lettered_last_hour", value: Number(d?.n ?? 0) });
  const [hb] = await db.select({ at: workerHeartbeats.lastHeartbeatAt }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(1);
  if (hb) out.push({ metric: "worker.heartbeat_age_seconds", value: Math.round((now.getTime() - hb.at.getTime()) / 1000) });
  const [b] = await db.select({ at: backupRuns.finishedAt }).from(backupRuns).where(and(eq(backupRuns.organizationId, organizationId), eq(backupRuns.status, "succeeded"))).orderBy(desc(backupRuns.finishedAt)).limit(1);
  if (b?.at) out.push({ metric: "backup.age_hours", value: Math.round(((now.getTime() - b.at.getTime()) / 3_600_000) * 100) / 100 });
  const [r] = await db.select({ n: reconciliationRuns.differencesCount }).from(reconciliationRuns).where(and(eq(reconciliationRuns.organizationId, organizationId), eq(reconciliationRuns.kind, "inventory_balances"))).orderBy(desc(reconciliationRuns.createdAt)).limit(1);
  if (r) out.push({ metric: "reconciliation.differences", value: Number(r.n) });
  const [size] = await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`);
  out.push({ metric: "database.size_bytes", value: Number(size?.bytes ?? 0) });
  const [conn] = await db.execute<{ used: number; max: number }>(sql`select (select count(*)::int from pg_stat_activity) as used, current_setting('max_connections')::int as max`);
  out.push({ metric: "database.connections_used", value: Number(conn?.used ?? 0), labels: { max: String(conn?.max ?? "") } });
  return out;
}

export async function sampleMetrics(organizationId: string, now: Date) {
  const readings = await readMetrics(organizationId, now);
  await db.insert(metricsSamples).values(readings.map((m) => ({ organizationId, sampledAt: now, metric: m.metric, value: String(m.value), labels: m.labels ?? {} })));
  const retention = await getSetting(db, organizationId, "platform.metrics.retention_days");
  await db.delete(metricsSamples).where(and(eq(metricsSamples.organizationId, organizationId), lt(metricsSamples.sampledAt, new Date(now.getTime() - retention * 86_400_000))));
  const swept = await sweepBuckets(db, 24, now);
  return { samples: readings.length, rateLimitBucketsSwept: swept };
}

export const platformMetricsSampleJob = defineJob<SlotPayload>({
  code: "platform.metrics_sample",
  title: "Sample operational metrics",
  description: "Writes queue depth, failed jobs, worker heartbeat age, backup age, reconciliation differences and database size to metrics_samples; prunes old samples and idle rate-limit buckets.",
  payload: SlotPayload,
  keyTuple: (p) => [p.slot],
  maxAttempts: 2,
  systemPermissions: ["platform.diagnostics.view", "platform.job.view"],
  schedule: { cron: "*/5 * * * *", tz: "Asia/Manila", payload: (now) => ({ slot: slotOf(now) }) },
  run: (run) => sampleMetrics(run.ctx.organizationId, run.asOf),
});

/* ------------------------------------------------------------------ alerts */

export type AlertFinding = { code: string; severity: "warning" | "critical"; title: string; body: string; link: string };

/** Evaluates the alert conditions with the `alerts.*` settings (exported for tests). */
export async function evaluateAlerts(organizationId: string, now: Date): Promise<AlertFinding[]> {
  const findings: AlertFinding[] = [];
  const heartbeatMax = await getSetting(db, organizationId, "alerts.worker_heartbeat_max_seconds");
  const [hb] = await db.select({ at: workerHeartbeats.lastHeartbeatAt, host: workerHeartbeats.hostname }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(1);
  if (hb) {
    const age = Math.round((now.getTime() - hb.at.getTime()) / 1000);
    if (age > heartbeatMax) findings.push({ code: "worker_down", severity: "critical", title: "Worker heartbeat is missing", body: `The last worker heartbeat was ${age}s ago (limit ${heartbeatMax}s). Background jobs are not running. Runbook §12.`, link: "/admin/diagnostics#health" });
  }
  const windowMin = await getSetting(db, organizationId, "alerts.failed_jobs_window_minutes");
  const [dl] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.organizationId, organizationId), isNotNull(backgroundJobs.deadLetteredAt), gte(backgroundJobs.deadLetteredAt, new Date(now.getTime() - windowMin * 60_000))));
  if (Number(dl?.n ?? 0) > 0) findings.push({ code: "failed_jobs", severity: "critical", title: "Background jobs were dead-lettered", body: `${dl.n} job(s) failed for good in the last ${windowMin} minutes. Open the Jobs card to retry or cancel. Runbook §6.`, link: "/admin/diagnostics?status=failed#jobs" });
  if (process.env.BACKUP_STATUS_SOURCE?.trim() === "table") {
    const maxAge = await getSetting(db, organizationId, "alerts.backup_max_age_hours");
    const [b] = await db.select({ at: backupRuns.finishedAt, offsite: backupRuns.offsiteBucketKey }).from(backupRuns).where(and(eq(backupRuns.organizationId, organizationId), eq(backupRuns.status, "succeeded"))).orderBy(desc(backupRuns.finishedAt)).limit(1);
    const age = b?.at ? (now.getTime() - b.at.getTime()) / 3_600_000 : null;
    if (age === null || age > maxAge) findings.push({ code: "backup_age", severity: "critical", title: "No recent successful backup", body: age === null ? "No successful logical dump is recorded. Runbook §9, §13." : `The newest successful dump is ${Math.round(age)} hours old (limit ${maxAge} h). Runbook §9, §13.`, link: "/admin/diagnostics#backups" });
    else if (!b?.offsite) findings.push({ code: "backup_offsite", severity: "warning", title: "Newest backup has no offsite copy", body: "The newest successful dump was not copied to the offsite bucket. Runbook §9.", link: "/admin/diagnostics#backups" });
  }
  return findings;
}

/** In-app delivery to system_admin, deduplicated per alert and `alerts.dedupe_minutes` window. */
export async function deliverAlerts(organizationId: string, now: Date) {
  const findings = await evaluateAlerts(organizationId, now);
  const dedupeMin = await getSetting(db, organizationId, "alerts.dedupe_minutes");
  const window = Math.floor(now.getTime() / (dedupeMin * 60_000));
  let delivered = 0;
  const admins = findings.length ? await usersWithRoles(db, organizationId, ["system_admin"]) : [];
  for (const f of findings) {
    const got = await notifyUsers(db, admins, { organizationId, kind: `alert.${f.code}`, severity: f.severity, title: f.title, body: f.body, link: f.link, dedupeKey: `alert:${f.code}:${window}` });
    delivered += got.length;
    if (got.length) logger.warn("alert raised", { alert: f.code, severity: f.severity, recipients: got.length });
  }
  return { findings: findings.map((f) => f.code), delivered };
}

export const platformAlertsEvaluateJob = defineJob<SlotPayload>({
  code: "platform.alerts_evaluate",
  title: "Evaluate operational alerts",
  description: "Checks worker heartbeat, dead-lettered jobs and backup age against the alerts.* settings and notifies system administrators in-app, at most once per alert and window.",
  payload: SlotPayload,
  keyTuple: (p) => [p.slot],
  maxAttempts: 2,
  systemPermissions: ["platform.diagnostics.view", "platform.job.view"],
  schedule: { cron: "*/5 * * * *", tz: "Asia/Manila", payload: (now) => ({ slot: slotOf(now) }) },
  run: (run) => deliverAlerts(run.ctx.organizationId, run.asOf),
});
