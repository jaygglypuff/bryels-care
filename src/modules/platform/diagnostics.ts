import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { workerHeartbeats } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

/** A worker is considered down when its last heartbeat is older than this (deployment-railway §6). */
export const WORKER_STALE_SECONDS = 300;

/**
 * Worker card: last heartbeat per worker process. With no heartbeat at all the card shows the
 * "worker not running" state, so queued jobs that never start are explained, not hidden.
 */
export async function workerStatus(ctx: AuthContext) {
  if (!ctx.can("platform.diagnostics.view")) ctx.require("platform.job.view");
  const rows = await db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastHeartbeatAt)).limit(10);
  const now = Date.now();
  const workers = rows.map((r) => {
    const age = Math.round((now - r.lastHeartbeatAt.getTime()) / 1000);
    return { workerId: r.workerId, hostname: r.hostname, releaseTag: r.releaseTag, startedAt: r.startedAt, lastHeartbeatAt: r.lastHeartbeatAt, ageSeconds: age, queueDepth: r.queueDepth, alive: age <= WORKER_STALE_SECONDS };
  });
  return { workers, anyAlive: workers.some((w) => w.alive) };
}

/** Worker only: upsert this process's heartbeat row. */
export async function writeHeartbeat(w: { workerId: string; hostname: string; releaseTag: string | null; queueDepth: number | null; startedAt: Date; envPresence?: Record<string, boolean> | null }) {
  await db
    .insert(workerHeartbeats)
    .values({ ...w, envPresence: w.envPresence ?? null, lastHeartbeatAt: new Date(), migrationsCurrent: true })
    .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastHeartbeatAt: new Date(), queueDepth: w.queueDepth, releaseTag: w.releaseTag, envPresence: w.envPresence ?? null } });
}

/** Queued jobs waiting (for the heartbeat's queue depth). */
export async function queuedJobCount(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from background_jobs where status = 'queued'`);
  return Number(r[0]?.n ?? 0);
}
