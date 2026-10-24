/**
 * Background worker (ADR-015, docs/architecture.md §8, docs/deployment-railway.md §2.2).
 * Same image as `web`, started with `pnpm worker` (Railway service `worker`).
 *
 * 1. Serves /api/health and /api/ready on PORT (Railway healthcheck).
 * 2. Waits until every bundled migration is applied (polls 10 s, gives up after 15 min).
 * 3. Starts pg-boss (schema `pgboss`), creates one queue per registered job code (retry with
 *    exponential backoff, dead-letter queue `platform.dead_letter`) and registers schedules.
 * 4. Relays queued `background_jobs` rows (the outbox written inside command transactions) to
 *    pg-boss every 2 s; each delivery runs `runJob`, which records attempts, retries and
 *    dead-lettering in our table.
 * 5. Writes a `worker_heartbeats` row every 30 s.
 * 6. On SIGTERM stops fetching, lets in-flight jobs finish (up to 50 s) and exits 0.
 *
 * Runs under `tsx --conditions=react-server` so the `server-only` guard of the domain modules
 * resolves to its server build.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { appJobRegistry } from "@/modules/platform/job-handlers";
import { enqueueJob, failJobFromDeadLetter, jobsAwaitingRelay, markRelayed, runJob, systemContext } from "@/modules/platform/jobs";
import { queuedJobCount, writeHeartbeat } from "@/modules/platform/diagnostics";
import { envPresence } from "@/modules/governance/variables";
import { logger } from "@/lib/log";
import { reportError } from "@/lib/log/error-reporter";
import { registerAppHooks } from "@/modules/wiring";

const DEAD_LETTER = "platform.dead_letter";
const workerId = `${os.hostname()}-${process.pid}-${uuidv7().slice(-6)}`;
const startedAt = new Date();
const release = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? process.env.RELEASE_TAG ?? null;
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));
// Structured JSON lines with service/release/RAILWAY_* fields (US-1-25, src/lib/log).
process.env.SERVICE_NAME ??= "worker";
const workerLog = logger.child({ workerId });
const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) => workerLog[level](msg, extra);

const state = { migrations: false, boss: false, lastHeartbeat: 0, stopping: false };

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/health")) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, service: "worker", release, uptimeSeconds: Math.round(process.uptime()) }));
    return;
  }
  if (url.startsWith("/api/ready")) {
    const heartbeatAge = state.lastHeartbeat ? Math.round((Date.now() - state.lastHeartbeat) / 1000) : null;
    const ok = state.migrations && state.boss && heartbeatAge !== null && heartbeatAge < 90 && !state.stopping;
    res
      .writeHead(ok ? 200 : 503, { "Content-Type": "application/json" })
      .end(JSON.stringify({ ok, service: "worker", checks: { migrations: state.migrations ? "ok" : "pending", queue: state.boss ? "ok" : "pending", heartbeatSeconds: heartbeatAge } }));
    return;
  }
  res.writeHead(404).end();
});

async function migrationsCurrent(): Promise<boolean> {
  const journal = JSON.parse(readFileSync(path.resolve(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8")) as { entries: unknown[] };
  try {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return Number(r[0]?.n ?? 0) >= journal.entries.length;
  } catch {
    return false;
  }
}

async function waitForMigrations() {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!(await migrationsCurrent())) {
    if (Date.now() > deadline) {
      log("error", "schema still behind after 15 minutes; exiting");
      process.exit(1);
    }
    log("info", "waiting for migrations");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  state.migrations = true;
}

async function main() {
  registerAppHooks(); // execution ↔ QA hooks for jobs that run batch services (src/modules/wiring.ts)
  const port = Number(process.env.PORT ?? 3001);
  // No host: Node binds "::" when IPv6 is available (Railway private networking) and 0.0.0.0 otherwise.
  server.listen(port, () => log("info", "health server listening", { port }));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  await waitForMigrations();

  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss", max: 2, application_name: "bryels-worker" });
  boss.on("error", (e) => log("error", "pg-boss error", { error: e instanceof Error ? e.message : String(e) }));
  await boss.start();
  state.boss = true;

  const registry = appJobRegistry();
  await boss.createQueue(DEAD_LETTER, { retryLimit: 0 }).catch(() => undefined);
  await boss.work<{ backgroundJobId?: string }>(DEAD_LETTER, async ([job]) => {
    if (job?.data?.backgroundJobId) await failJobFromDeadLetter(job.data.backgroundJobId, "pg-boss exhausted its retries for this job.");
  });

  for (const def of registry.list()) {
    // Our runner decides when a job is finally failed; pg-boss only needs enough retries to deliver the attempts.
    await boss
      .createQueue(def.code, {
        retryLimit: 19,
        retryDelay: def.retryDelaySeconds ?? 30,
        retryBackoff: true,
        retryDelayMax: 3600,
        expireInSeconds: def.timeoutSeconds ?? 900,
        deadLetter: DEAD_LETTER,
      })
      .catch(() => undefined);
    await boss.work<{ backgroundJobId?: string; scheduled?: boolean }>(def.code, { localConcurrency: concurrency }, async ([job]) => {
      if (!job) return;
      const backgroundJobId = job.data?.backgroundJobId;
      if (!backgroundJobId && job.data?.scheduled && def.schedule) {
        // A scheduled tick: one keyed row per organization, then run it here (no relay needed).
        const orgs = await db.select({ id: organizations.id }).from(organizations);
        for (const o of orgs) {
          const ctx = await systemContext(o.id, def);
          const { job: row } = await enqueueJob(db, ctx, def, def.schedule.payload(new Date()), { pgbossJobId: job.id });
          const outcome = await runJob(row.id);
          log("info", "scheduled job", { code: def.code, jobId: row.id, outcome: outcome.status });
          if (outcome.status === "retry") throw new Error(outcome.error);
        }
        return;
      }
      if (!backgroundJobId) return;
      const outcome = await runJob(backgroundJobId);
      log(outcome.status === "succeeded" || outcome.status === "skipped" ? "info" : "warn", "job attempt", { code: def.code, jobId: backgroundJobId, outcome: outcome.status });
      if (outcome.status === "retry") throw new Error(outcome.error);
    });
    if (def.schedule) await boss.schedule(def.code, def.schedule.cron, { scheduled: true }, { tz: def.schedule.tz });
  }
  log("info", "worker started", { jobs: registry.list().map((d) => d.code), concurrency });

  const relay = async () => {
    if (state.stopping) return;
    try {
      for (const row of await jobsAwaitingRelay(50)) {
        if (!registry.has(row.jobKind)) {
          // Not registered in this release: runJob fails it with a clear message.
          await runJob(row.id);
          continue;
        }
        const pgId = uuidv7();
        const sent = await boss.send(row.jobKind, { backgroundJobId: row.id }, { id: pgId, singletonKey: row.idempotencyKey, startAfter: row.runAfter });
        // null = an active pg-boss job with the same key already carries this row.
        await markRelayed(row.id, sent ?? pgId);
      }
    } catch (e) {
      log("error", "relay failed", { error: e instanceof Error ? e.message : String(e) });
    }
  };
  const heartbeat = async () => {
    try {
      await writeHeartbeat({ workerId, hostname: os.hostname(), releaseTag: release, queueDepth: await queuedJobCount(), startedAt, envPresence: envPresence("worker") });
      state.lastHeartbeat = Date.now();
    } catch (e) {
      log("error", "heartbeat failed", { error: e instanceof Error ? e.message : String(e) });
    }
  };
  await heartbeat();
  const relayTimer = setInterval(relay, 2000);
  const heartbeatTimer = setInterval(heartbeat, 30_000);

  const shutdown = async (signal: string) => {
    if (state.stopping) return;
    state.stopping = true;
    log("info", "stopping", { signal });
    clearInterval(relayTimer);
    clearInterval(heartbeatTimer);
    await boss.stop({ graceful: true, timeout: 50_000 }).catch(() => undefined);
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// docs/deployment-railway.md §8.1: unhandled failures are reported, then the process exits 1 (Railway restarts it).
process.on("unhandledRejection", (e) => {
  log("error", "unhandled rejection", { error: e instanceof Error ? e.message : String(e) });
  void reportError(e, { routeType: "worker" }).finally(() => process.exit(1));
});
main().catch((e) => {
  log("error", "worker failed to start", { error: e instanceof Error ? e.message : String(e) });
  void reportError(e, { routeType: "worker" }).finally(() => process.exit(1));
});
