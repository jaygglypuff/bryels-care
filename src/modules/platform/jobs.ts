import "server-only";
import { and, desc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { ZodError } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { backgroundJobs, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthContext, buildContextForUser } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { type AnyJobDefinition, type BackgroundJobRow, type JobDefinition, type JobRegistry } from "./job-definition";
import { appJobRegistry } from "./job-handlers";
import { notifyRoles } from "./notifications";

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Nil id used by pure system contexts: any write that tries to attribute a row to it fails its FK loudly. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

const SECRET_KEY_RE = /pass|secret|token|cookie|session|hash|signature|credential|api[_-]?key/i;

/** Payload summary for screens and logs: secret-like keys masked, long strings cut, depth limited. */
export function summarizePayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 120 ? value.slice(0, 117) + "…" : value;
  if (typeof value !== "object") return value;
  if (depth >= 3) return "…";
  if (Array.isArray(value)) return value.length > 10 ? [...value.slice(0, 10).map((v) => summarizePayload(v, depth + 1)), `… ${value.length - 10} more`] : value.map((v) => summarizePayload(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY_RE.test(k) ? "•••" : summarizePayload(v, depth + 1);
  return out;
}

export function jobIdempotencyKey(def: AnyJobDefinition, payload: unknown) {
  return `${def.code}:${def.keyTuple(payload).map((v) => (v === null || v === undefined ? "-" : String(v))).join(":")}`;
}

function zodMessage(e: ZodError) {
  return e.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ");
}

/**
 * A context for a job no user triggered (scheduled work): every active site of the organization,
 * only the permissions the job declares, actor `system:<code>`.
 */
export async function systemContext(organizationId: string, def: Pick<AnyJobDefinition, "code" | "systemPermissions">, correlationId?: string) {
  const siteRows = await db
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.isActive, true)))
    .orderBy(sites.code);
  if (siteRows.length === 0) throw new DomainError("not_found", "The organization has no active site.");
  return new AuthContext(SYSTEM_USER_ID, organizationId, `System (${def.code})`, "", [], new Set(def.systemPermissions ?? []), siteRows, siteRows[0].id, {
    actor: { kind: "system", code: def.code, onBehalfOf: null },
    correlationId: correlationId ?? null,
  });
}

export type EnqueueOptions = {
  siteId?: string | null;
  runAfter?: Date;
  /** Defaults to the application registry; tests pass their own. */
  registry?: JobRegistry;
  /** Set by the worker when a pg-boss scheduled tick creates the row (no relay needed). */
  pgbossJobId?: string;
};

/**
 * Enqueues a registered job inside the caller's transaction (or on its own). The row is the
 * outbox: the worker relays it to pg-boss after commit, so a rolled-back command never runs a job.
 * A repeat with the same idempotency key returns the existing row (created = false).
 */
export async function enqueueJob<P>(q: DbOrTx, ctx: AuthContext, def: JobDefinition<P>, payload: P, opts: EnqueueOptions = {}) {
  const registry = opts.registry ?? appJobRegistry();
  if (registry.get(def.code) !== (def as AnyJobDefinition)) throw new DomainError("validation", `Job ${def.code} is not registered (docs/architecture.md §8).`);
  const parsed = def.payload.safeParse(payload);
  if (!parsed.success) throw new DomainError("validation", `Invalid payload for ${def.code}: ${zodMessage(parsed.error)}`);
  if (opts.siteId) ctx.requireSite(opts.siteId);
  const key = jobIdempotencyKey(def, parsed.data);
  const actor = ctx.actor;
  const requestedBy = actor.kind === "user" ? ctx.userId : actor.onBehalfOf;
  const maxAttempts = def.maxAttempts ?? (await getSetting(q, ctx.organizationId, "platform.jobs.max_attempts"));
  const inserted = await q
    .insert(backgroundJobs)
    .values({
      organizationId: ctx.organizationId,
      siteId: opts.siteId ?? null,
      jobKind: def.code,
      payload: parsed.data as object,
      idempotencyKey: key,
      maxAttempts,
      correlationId: ctx.correlationId ?? uuidv7(),
      requestedBy,
      runAfter: opts.runAfter ?? new Date(),
      pgbossJobId: opts.pgbossJobId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { job: inserted[0], created: true };
  const [existing] = await q
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.organizationId, ctx.organizationId), eq(backgroundJobs.idempotencyKey, key)))
    .limit(1);
  return { job: existing, created: false };
}

export type RunOutcome =
  | { status: "succeeded"; result: unknown }
  | { status: "retry"; error: string; attempt: number }
  | { status: "failed"; error: string; deadLettered: boolean }
  | { status: "skipped"; reason: string };

function backoffSeconds(def: AnyJobDefinition | undefined, attempt: number) {
  const base = def?.retryDelaySeconds ?? 30;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 3600);
}

async function finalizeFailure(job: BackgroundJobRow, message: string, now: Date): Promise<RunOutcome> {
  await db.transaction(async (tx) => {
    await tx
      .update(backgroundJobs)
      .set({ status: "failed", errorMessage: message, finishedAt: now, deadLetteredAt: now, updatedAt: now })
      .where(eq(backgroundJobs.id, job.id));
    await notifyRoles(
      tx,
      { roleCodes: ["system_admin"] },
      {
        organizationId: job.organizationId,
        siteId: job.siteId,
        kind: "failed_job",
        severity: "critical",
        title: `Background job failed: ${job.jobKind}`,
        body: `The job stopped after ${job.attempts} attempt(s) and needs attention. Last error: ${message.slice(0, 300)} (correlation ${job.correlationId}).`,
        entityType: "background_job",
        entityId: job.id,
        link: `/admin/diagnostics?job=${job.id}#jobs`,
        dedupeKey: `job:${job.id}:dead:${job.retriedCount}`,
      },
    );
  });
  return { status: "failed", error: message, deadLettered: true };
}

/**
 * Runs one attempt of a job (called by the worker for each pg-boss delivery and directly by
 * tests). Claims the row (queued → running), validates the payload again, rebuilds the context
 * from the triggering user's *current* access, runs the handler and records the outcome.
 * - success → succeeded with the result;
 * - DomainError, invalid payload, unregistered code or lost access → failed at once (no retry);
 * - any other error → queued again with backoff until `max_attempts`, then failed, dead-lettered
 *   and a critical notification to system_admin.
 */
export async function runJob(jobId: string, opts: { registry?: JobRegistry; now?: Date } = {}): Promise<RunOutcome> {
  const registry = opts.registry ?? appJobRegistry();
  const now = opts.now ?? new Date();
  const [peek] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, jobId)).limit(1);
  if (!peek) return { status: "skipped", reason: "not_found" };
  const def = registry.get(peek.jobKind);
  const timeout = def?.timeoutSeconds ?? 900;
  const [job] = await db
    .update(backgroundJobs)
    .set({ status: "running", attempts: sql`${backgroundJobs.attempts} + 1`, startedAt: now, updatedAt: now })
    .where(
      and(
        eq(backgroundJobs.id, jobId),
        // pg-boss owns the timing of deliveries and retries; run_after is informative here.
        or(
          eq(backgroundJobs.status, "queued"),
          and(eq(backgroundJobs.status, "running"), lte(backgroundJobs.startedAt, new Date(now.getTime() - timeout * 1000))),
        ),
      ),
    )
    .returning();
  if (!job) return { status: "skipped", reason: peek.status };

  if (!def) return finalizeFailure(job, `Job code ${job.jobKind} is not registered in this release.`, now);
  const parsed = def.payload.safeParse(job.payload);
  if (!parsed.success) return finalizeFailure(job, `Payload rejected before execution: ${zodMessage(parsed.error)}`, now);

  const options = { actor: { kind: "system" as const, code: def.code, onBehalfOf: job.requestedBy }, correlationId: job.correlationId };
  const ctx = job.requestedBy ? await buildContextForUser(job.requestedBy, job.siteId, options) : await systemContext(job.organizationId, def, job.correlationId);
  if (!ctx) return finalizeFailure(job, "The user who started this job no longer has access; it was not run.", now);
  if (job.siteId && !ctx.allowedSiteIds.includes(job.siteId)) return finalizeFailure(job, "The user who started this job no longer has access to its site; it was not run.", now);

  try {
    const result = await def.run({ ctx, job, attempt: job.attempts, idempotencyKey: job.idempotencyKey, correlationId: job.correlationId, asOf: now }, parsed.data);
    await db
      .update(backgroundJobs)
      .set({ status: "succeeded", result: (result ?? {}) as object, errorMessage: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(backgroundJobs.id, job.id));
    return { status: "succeeded", result: result ?? {} };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
    if (e instanceof DomainError || job.attempts >= job.maxAttempts) return finalizeFailure(job, message, now);
    await db
      .update(backgroundJobs)
      .set({ status: "queued", errorMessage: message, runAfter: new Date(now.getTime() + backoffSeconds(def, job.attempts) * 1000), updatedAt: new Date() })
      .where(eq(backgroundJobs.id, job.id));
    return { status: "retry", error: message, attempt: job.attempts };
  }
}

async function loadScopedJob(ctx: AuthContext, jobId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new DomainError("not_found", "Job not found.");
  const base = db.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, ctx.organizationId)));
  const [job] = forUpdate ? await base.for("update").limit(1) : await base.limit(1);
  if (!job || (job.siteId && !ctx.allowedSiteIds.includes(job.siteId))) throw new DomainError("not_found", "Job not found.");
  return job;
}

/**
 * platform.job.admin: puts a failed or cancelled job back in the queue (attempts reset). The job's
 * idempotency key is unchanged, so a handler that already posted something replays instead of
 * posting twice. Audit platform.background_job.retried.
 */
export async function retryJob(ctx: AuthContext, jobId: string, reason?: string | null) {
  ctx.require("platform.job.admin");
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!job || (job.siteId && !ctx.allowedSiteIds.includes(job.siteId))) throw new DomainError("not_found", "Job not found.");
    if (job.status !== "failed" && job.status !== "cancelled") throw new DomainError("state", `Only failed or cancelled jobs can be retried; this one is ${job.status}.`);
    const [updated] = await tx
      .update(backgroundJobs)
      .set({ status: "queued", attempts: 0, pgbossJobId: null, deadLetteredAt: null, finishedAt: null, runAfter: new Date(), retriedCount: job.retriedCount + 1, cancelledBy: null, updatedAt: new Date() })
      .where(eq(backgroundJobs.id, job.id))
      .returning();
    await audit(tx, ctx, {
      action: "platform.background_job.retried",
      entityType: "background_job",
      entityId: job.id,
      entityNumber: job.jobKind,
      siteId: job.siteId,
      reason: reason?.trim() || null,
      correlationId: job.correlationId,
      before: { status: job.status, attempts: job.attempts, errorMessage: job.errorMessage },
      after: { status: "queued", retriedCount: updated.retriedCount },
    });
    return updated;
  });
}

/** platform.job.admin: cancels a job that has not started (or a failed one, to clear it). Audit platform.background_job.cancelled. */
export async function cancelJob(ctx: AuthContext, jobId: string, reason?: string | null) {
  ctx.require("platform.job.admin");
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!job || (job.siteId && !ctx.allowedSiteIds.includes(job.siteId))) throw new DomainError("not_found", "Job not found.");
    if (job.status !== "queued" && job.status !== "failed") throw new DomainError("state", `A ${job.status} job cannot be cancelled.`);
    const [updated] = await tx
      .update(backgroundJobs)
      .set({ status: "cancelled", cancelledBy: ctx.userId, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(backgroundJobs.id, job.id))
      .returning();
    await audit(tx, ctx, {
      action: "platform.background_job.cancelled",
      entityType: "background_job",
      entityId: job.id,
      entityNumber: job.jobKind,
      siteId: job.siteId,
      reason: reason?.trim() || null,
      correlationId: job.correlationId,
      before: { status: job.status },
      after: { status: "cancelled" },
    });
    return updated;
  });
}

export type JobListItem = Omit<BackgroundJobRow, "payload"> & { payloadSummary: unknown; title: string };

/** Jobs card: newest first, scoped to the viewer's sites (organization-level jobs are visible to every viewer). */
export async function listJobs(ctx: AuthContext, f: { status?: string; limit?: number } = {}): Promise<JobListItem[]> {
  ctx.require("platform.job.view");
  const conds: SQL[] = [eq(backgroundJobs.organizationId, ctx.organizationId), or(isNull(backgroundJobs.siteId), inArray(backgroundJobs.siteId, ctx.allowedSiteIds))!];
  if (f.status && (JOB_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(backgroundJobs.status, f.status));
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(and(...conds))
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(Math.min(f.limit ?? 50, 200));
  const registry = appJobRegistry();
  return rows.map(({ payload, ...r }) => {
    const def = registry.get(r.jobKind);
    return { ...r, title: def?.title ?? r.jobKind, payloadSummary: def?.summarize ? summarizePayload(def.summarize(payload)) : summarizePayload(payload) };
  });
}

export async function getJob(ctx: AuthContext, jobId: string): Promise<JobListItem> {
  ctx.require("platform.job.view");
  const { payload, ...r } = await loadScopedJob(ctx, jobId);
  const def = appJobRegistry().get(r.jobKind);
  return { ...r, title: def?.title ?? r.jobKind, payloadSummary: def?.summarize ? summarizePayload(def.summarize(payload)) : summarizePayload(payload) };
}

/** Counts per status for the card header. */
export async function jobCounts(ctx: AuthContext) {
  ctx.require("platform.job.view");
  const rows = await db
    .select({ status: backgroundJobs.status, n: sql<number>`count(*)::int` })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.organizationId, ctx.organizationId), or(isNull(backgroundJobs.siteId), inArray(backgroundJobs.siteId, ctx.allowedSiteIds))))
    .groupBy(backgroundJobs.status);
  const out: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const r of rows) out[r.status as JobStatus] = Number(r.n);
  return out;
}

// ---- worker relay (outbox → pg-boss) -------------------------------------------------------

/**
 * Worker only: pg-boss gave up on a delivery (its dead-letter queue received it). Our row is the
 * source of truth; unless it already reached a final state, it is failed, dead-lettered and
 * reported like any other exhausted job.
 */
export async function failJobFromDeadLetter(jobId: string, message: string) {
  const [job] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, jobId)).limit(1);
  if (!job || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return;
  await finalizeFailure(job, message, new Date());
}

/** Queued rows not yet handed to pg-boss, oldest first (worker only). */
export async function jobsAwaitingRelay(limit = 50) {
  return db
    .select({ id: backgroundJobs.id, jobKind: backgroundJobs.jobKind, idempotencyKey: backgroundJobs.idempotencyKey, runAfter: backgroundJobs.runAfter })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.status, "queued"), isNull(backgroundJobs.pgbossJobId)))
    .orderBy(backgroundJobs.createdAt)
    .limit(limit);
}

export async function markRelayed(jobId: string, pgbossJobId: string) {
  await db.update(backgroundJobs).set({ pgbossJobId, updatedAt: new Date() }).where(and(eq(backgroundJobs.id, jobId), isNull(backgroundJobs.pgbossJobId)));
}
