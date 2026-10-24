import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { backupRuns, workerHeartbeats } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getMaintenanceState } from "@/lib/maintenance";
import { VARIABLE_ALLOW_LIST, type ServiceName, envPresence } from "./variables";

/**
 * Diagnostics Health, Backups and Variables cards (US-1-26, docs/operations-runbook.md §17).
 * Every card renders booleans, counts, names, ages and versions only; never a value of an
 * environment variable or a connection string (`diagnostics.no_secrets`).
 */

const WORKER_STALE_SECONDS = 300;

function journalEntries(): number | null {
  try {
    const j = JSON.parse(readFileSync(path.resolve(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8")) as { entries: unknown[] };
    return j.entries.length;
  } catch {
    return null;
  }
}

export type HealthCard = {
  web: { ready: boolean; database: "ok" | "down"; databaseLatencyMs: number | null; release: string; appEnv: string; uptimeSeconds: number };
  migrations: { applied: number | null; bundled: number | null; current: boolean | null };
  queue: "ok" | "not_started";
  worker: { present: boolean; alive: boolean; heartbeatAgeSeconds: number | null; release: string | null };
  readOnlyMode: boolean;
};

export async function healthCard(ctx: AuthContext): Promise<HealthCard> {
  ctx.require("platform.diagnostics.view");
  const t0 = Date.now();
  let database: "ok" | "down" = "ok";
  let latency: number | null = null;
  let applied: number | null = null;
  try {
    await db.execute(sql`select 1`);
    latency = Date.now() - t0;
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = Number(r[0]?.n ?? 0);
  } catch {
    database = "down";
  }
  let queue: "ok" | "not_started" = "not_started";
  try {
    await db.execute(sql`select 1 from pgboss.version limit 1`);
    queue = "ok";
  } catch {
    queue = "not_started";
  }
  const bundled = journalEntries();
  const [hb] = await db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(1);
  const age = hb ? Math.round((Date.now() - hb.lastHeartbeatAt.getTime()) / 1000) : null;
  const maintenance = await getMaintenanceState(db, ctx.organizationId);
  return {
    web: {
      ready: database === "ok",
      database,
      databaseLatencyMs: latency,
      release: process.env.RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev",
      appEnv: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
    },
    migrations: { applied, bundled, current: applied === null || bundled === null ? null : applied >= bundled },
    queue,
    worker: { present: !!hb, alive: age !== null && age <= WORKER_STALE_SECONDS, heartbeatAgeSeconds: age, release: hb?.releaseTag ?? null },
    readOnlyMode: maintenance.enabled,
  };
}

export type BackupsCard =
  | { configured: false; source: string | null }
  | {
      configured: true;
      source: "table";
      lastSuccess: { finishedAt: Date; ageHours: number; offsiteOk: boolean; sizeBytes: number | null; label: string | null } | null;
      lastRun: { status: string; startedAt: Date; errorMessage: string | null } | null;
      nextDueAt: Date | null;
      overdue: boolean;
      lastRestoreDrill: null;
    };

/**
 * Backups card. The status source is configurable (BACKUP_STATUS_SOURCE): `table` reads the
 * `backup_runs` rows the backup service writes; unset says "not configured" instead of showing
 * anything that looks like a backup. Restore drills arrive in Phase 9 (empty until then).
 */
export async function backupsCard(ctx: AuthContext, now = new Date()): Promise<BackupsCard> {
  ctx.require("platform.diagnostics.view");
  const source = process.env.BACKUP_STATUS_SOURCE?.trim() || null;
  if (source !== "table") return { configured: false, source };
  const [ok] = await db
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.organizationId, ctx.organizationId), eq(backupRuns.status, "succeeded")))
    .orderBy(desc(backupRuns.finishedAt))
    .limit(1);
  const [last] = await db.select().from(backupRuns).where(eq(backupRuns.organizationId, ctx.organizationId)).orderBy(desc(backupRuns.startedAt)).limit(1);
  const finished = ok?.finishedAt ?? null;
  const nextDueAt = finished ? new Date(finished.getTime() + 24 * 3_600_000) : null;
  return {
    configured: true,
    source: "table",
    lastSuccess: ok && finished ? { finishedAt: finished, ageHours: Math.round(((now.getTime() - finished.getTime()) / 3_600_000) * 10) / 10, offsiteOk: !!ok.offsiteBucketKey, sizeBytes: ok.sizeBytes, label: ok.label } : null,
    lastRun: last ? { status: last.status, startedAt: last.startedAt, errorMessage: last.errorMessage ? last.errorMessage.slice(0, 300) : null } : null,
    nextDueAt,
    overdue: !nextDueAt || nextDueAt.getTime() < now.getTime(),
    lastRestoreDrill: null,
  };
}

export type VariablesCard = { services: { service: ServiceName; reportedAt: Date | null; variables: { name: string; required: string; note: string; present: boolean | null }[] }[] };

/** Variables card: allow-listed NAMES with present/missing per service; values are never read into the result. */
export async function variablesCard(ctx: AuthContext): Promise<VariablesCard> {
  ctx.require("platform.diagnostics.view");
  const web = envPresence("web");
  const [hb] = await db.select({ envPresence: workerHeartbeats.envPresence, at: workerHeartbeats.lastHeartbeatAt }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(1);
  const worker = (hb?.envPresence ?? null) as Record<string, boolean> | null;
  return {
    services: [
      { service: "web", reportedAt: new Date(), variables: VARIABLE_ALLOW_LIST.web.map((v) => ({ ...v, present: web[v.name] ?? false })) },
      { service: "worker", reportedAt: worker ? (hb?.at ?? null) : null, variables: VARIABLE_ALLOW_LIST.worker.map((v) => ({ ...v, present: worker ? worker[v.name] === true : null })) },
    ],
  };
}

/** Records one backup run (called by scripts/record-backup-run.ts from the backup service). */
export async function recordBackupRun(input: typeof backupRuns.$inferInsert) {
  const [r] = await db.insert(backupRuns).values(input).returning();
  return r;
}
