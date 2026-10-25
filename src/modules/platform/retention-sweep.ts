import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { purgeRuns, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { defineJob } from "./job-definition";
import { resolveHeldSet } from "./retention-holds";
import { PROTECTED_CLASSES, effectivePolicies, periodLabel, policyKey, type PolicyView } from "./retention-policies";

/**
 * The retention sweep (US-9-05, docs/data-model.md §12.4, job `platform.retention_sweep`).
 *
 * Rules, in order, for every policy (stored or shipped default):
 * 1. Protected classes (ledgers, quality, finance, payroll, audit, master data) are never deleted
 *    or anonymised, whatever a row says: the sweep reports archive candidates only.
 * 2. `keep`, `archive` and `anonymise` are reported (counts, held counts); archive manifests and
 *    anonymisation are owner-approved manual procedures (runbook §21) until their own ADR.
 * 3. `delete` acts only when the policy is CONFIRMED by a qualified reviewer, the run is an
 *    execution (not a dry run) and the target has a purger below; held rows are never deleted.
 * 4. Targets purged by another job are reported as "handled elsewhere" with the job's name.
 * Every run writes one `purge_runs` row with the per-target report; a dry run deletes nothing.
 */
export type PurgeOutcome =
  | "deleted"
  | "would_delete"
  | "report_only_unconfirmed"
  | "archive_report"
  | "anonymise_report"
  | "keep"
  | "protected"
  | "handled_elsewhere"
  | "not_in_this_release";

export type TargetReport = {
  key: string;
  dataClass: string;
  target: string;
  action: string;
  period: string;
  policySource: "stored" | "default";
  confirmed: boolean;
  cutoff: string | null;
  outcome: PurgeOutcome;
  candidates: number | null;
  held: number | null;
  deleted: number;
  note: string;
};

type Params = { organizationId: string; cutoff: Date; held: string; asOf: Date };
type Candidates = (p: Params) => SQL;

/** A purger selects (id, held) candidates; deletion removes unheld ones by id, capped per run. */
type Purger = { kind: "purge"; table: string; candidates: Candidates; note: string };
type Counter = { kind: "count"; candidates: Candidates; note: string };
type Elsewhere = { kind: "elsewhere"; note: string };
type Handler = Purger | Counter | Elsewhere;

const heldArr = (p: Params) => sql`${p.held}::uuid[]`;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

const HANDLERS: Record<string, Handler> = {
  "security/password_reset_tokens": {
    kind: "purge",
    table: "password_reset_tokens",
    note: "reset tokens past expiry, use or void",
    candidates: (p) => sql`select id, (user_id = any(${heldArr(p)})) as held from password_reset_tokens where organization_id = ${p.organizationId} and coalesce(used_at, voided_at, expires_at) < ${ts(p.cutoff)}`,
  },
  "idempotency/idempotency_keys": {
    kind: "purge",
    table: "idempotency_keys",
    note: "completed or expired keys",
    candidates: (p) => sql`select id, false as held from idempotency_keys where organization_id = ${p.organizationId} and created_at < ${ts(p.cutoff)} and (completed_at is not null or expires_at < ${ts(p.asOf)})`,
  },
  "jobs_notifications/background_jobs": {
    kind: "purge",
    table: "background_jobs",
    note: "succeeded or cancelled jobs; failed jobs are kept; a job whose payload names a held record is kept",
    candidates: (p) => sql`select j.id, exists (select 1 from unnest(${heldArr(p)}) h where j.payload::text like '%' || h::text || '%') as held
      from background_jobs j where j.organization_id = ${p.organizationId} and j.status in ('succeeded','cancelled') and coalesce(j.finished_at, j.updated_at) < ${ts(p.cutoff)}`,
  },
  "jobs_notifications/notifications": {
    kind: "purge",
    table: "notifications",
    note: "notifications older than the period; unacknowledged critical ones and those about held records are kept",
    candidates: (p) => sql`select n.id, (n.entity_id is not null and n.entity_id = any(${heldArr(p)})) as held
      from notifications n where n.organization_id = ${p.organizationId} and n.created_at < ${ts(p.cutoff)} and not (n.severity = 'critical' and n.acknowledged_at is null)`,
  },
  "platform_ops/worker_heartbeats": {
    kind: "purge",
    table: "worker_heartbeats",
    note: "heartbeat rows of workers silent for longer than the period (not organisation-scoped: one company per deployment)",
    candidates: (p) => sql`select id, false as held from worker_heartbeats where last_heartbeat_at < ${ts(p.cutoff)}`,
  },
  "security/sessions": { kind: "elsewhere", note: "identity.session_purge (daily; setting session.purge_after_days)" },
  "platform_ops/metrics_samples": { kind: "elsewhere", note: "platform.metrics_sample (setting platform.metrics.retention_days)" },
  "exports/*": { kind: "elsewhere", note: "scheduled report delivery clears stored report files (setting reports.file_retention_days)" },
  "backups/*": { kind: "elsewhere", note: "the backup script prunes dumps beyond 35 daily + 12 monthly; held backup runs are never pruned (scripts/backup-dump.ts)" },
  "stock_ledger/*": {
    kind: "count",
    note: "lots whose every movement is older than the period; rows stay (ADR-006), archive by manifest only",
    candidates: (p) => sql`select l.id, (l.id = any(${heldArr(p)})) as held from inventory_lots l
      where l.organization_id = ${p.organizationId}
        and exists (select 1 from stock_movements m where m.lot_id = l.id)
        and not exists (select 1 from stock_movements m where m.lot_id = l.id and m.posted_at >= ${ts(p.cutoff)})`,
  },
  "quality_batch/*": {
    kind: "count",
    note: "completed batches past output-lot expiry + period and the minimum; rows stay, archive by manifest only",
    candidates: (p) => sql`select b.id, (b.id = any(${heldArr(p)}) or (b.output_lot_id is not null and b.output_lot_id = any(${heldArr(p)}))) as held
      from batches b left join inventory_lots l on l.id = b.output_lot_id
      where b.organization_id = ${p.organizationId} and b.completed_at is not null
        and coalesce(l.expires_on::timestamptz, b.completed_at) < ${ts(p.cutoff)}`,
  },
  "audit/*": {
    kind: "count",
    note: "audit events older than the minimum period (kept; partitions archived only with owner approval)",
    candidates: (p) => sql`select id, false as held from audit_events where organization_id = ${p.organizationId} and occurred_at < ${ts(p.cutoff)}`,
  },
  "sales_customer/*": {
    kind: "count",
    note: "customers without an order since the cutoff; contact persons would be blanked after owner approval",
    candidates: (p) => sql`select c.id, (c.id = any(${heldArr(p)})) as held from customers c
      where c.organization_id = ${p.organizationId}
        and coalesce((select max(o.created_at) from sales_orders o where o.customer_id = c.id), c.created_at) < ${ts(p.cutoff)}`,
  },
  "identity/users": {
    kind: "count",
    note: "users deactivated before the cutoff; would become 'Former user' after owner approval",
    candidates: (p) => sql`select u.id, (u.id = any(${heldArr(p)})) as held from users u
      where u.organization_id = ${p.organizationId} and u.deactivated_at is not null and u.deactivated_at < ${ts(p.cutoff)}`,
  },
  "platform_ops/*": {
    kind: "count",
    note: "reconciliation runs older than the period (backup runs, drills and purge runs follow the same rule)",
    candidates: (p) => sql`select id, false as held from reconciliation_runs where organization_id = ${p.organizationId} and created_at < ${ts(p.cutoff)}`,
  },
};

/** The date before which a record is past its period (minimum months win when longer). */
export function cutoffFor(p: Pick<PolicyView, "retentionMonths" | "retentionDays" | "minimumMonths">, asOf: Date): Date | null {
  const minus = (months: number | null, days: number | null) => {
    const d = new Date(asOf);
    if (months) d.setUTCMonth(d.getUTCMonth() - months);
    if (days) d.setUTCDate(d.getUTCDate() - days);
    return d;
  };
  if (!p.retentionMonths && !p.retentionDays && !p.minimumMonths) return null;
  const a = p.retentionMonths || p.retentionDays ? minus(p.retentionMonths, p.retentionDays) : null;
  const b = p.minimumMonths ? minus(p.minimumMonths, null) : null;
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

async function countCandidates(q: DbOrTx, h: Purger | Counter, p: Params) {
  const [r] = await q.execute<{ n: string; held: string }>(sql`select count(*)::text as n, count(*) filter (where c.held)::text as held from (${h.candidates(p)}) c`);
  return { candidates: Number(r?.n ?? 0), held: Number(r?.held ?? 0) };
}

async function deleteCandidates(q: DbOrTx, h: Purger, p: Params, limit: number) {
  const rows = await q.execute<{ id: string }>(
    sql`delete from ${sql.identifier(h.table)} where id in (select c.id from (${h.candidates(p)}) c where not c.held limit ${limit}) returning id`,
  );
  return rows.length;
}

export type SweepInput = { mode: "dry_run" | "execute"; trigger: "manual" | "scheduled"; asOf?: Date; idempotencyKey?: string | null };
export type PurgeRunRow = typeof purgeRuns.$inferSelect;

/** Runs the sweep in one transaction (serialised per organisation) and records the `purge_runs` row. */
export async function runRetentionSweep(ctx: AuthContext, input: SweepInput): Promise<PurgeRunRow> {
  ctx.require(input.mode === "execute" ? "platform.purge_run.post" : "platform.purge_run.create");
  ctx.assertWritable();
  const asOf = input.asOf ?? new Date();
  const key = input.idempotencyKey?.trim() || null;
  if (key) {
    const [prev] = await db.select().from(purgeRuns).where(and(eq(purgeRuns.organizationId, ctx.organizationId), eq(purgeRuns.idempotencyKey, key)));
    if (prev) return prev;
  }
  const startedAt = new Date();
  const limit = await getSetting(db, ctx.organizationId, "platform.retention.max_rows_per_target");
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform.retention_sweep'), hashtext(${ctx.organizationId}))`);
      const held = await resolveHeldSet(tx, ctx.organizationId);
      const policies = await effectivePolicies(tx, ctx.organizationId);
      const params = (cutoff: Date): Params => ({ organizationId: ctx.organizationId, cutoff, held: `{${held.ids.join(",")}}`, asOf });
      const report: TargetReport[] = [];
      for (const pol of policies) {
        const k = policyKey(pol);
        const h = HANDLERS[k];
        const cutoff = cutoffFor(pol, asOf);
        const base = {
          key: k,
          dataClass: pol.dataClass,
          target: pol.target,
          action: pol.action,
          period: periodLabel(pol),
          policySource: pol.source,
          confirmed: pol.isConfirmed,
          cutoff: cutoff ? cutoff.toISOString() : null,
          candidates: null as number | null,
          held: null as number | null,
          deleted: 0,
        };
        const counted = async () => (h && h.kind !== "elsewhere" && cutoff ? countCandidates(tx, h, params(cutoff)) : { candidates: null, held: null });
        if (PROTECTED_CLASSES.includes(pol.dataClass) && (pol.action === "delete" || pol.action === "anonymise")) {
          report.push({ ...base, ...(await counted()), outcome: "protected", note: "immutable business records: never deleted or anonymised by the sweep (ADR-006); fix the policy row" });
          continue;
        }
        if (pol.action === "keep") {
          report.push({ ...base, ...(await counted()), outcome: "keep", note: h && h.kind !== "elsewhere" ? h.note : "kept indefinitely" });
          continue;
        }
        if (pol.action === "archive") {
          report.push({ ...base, ...(await counted()), outcome: "archive_report", note: h && h.kind !== "elsewhere" ? h.note : "archive by manifest only (runbook §21); no counter in this release" });
          continue;
        }
        if (pol.action === "anonymise") {
          report.push({ ...base, ...(await counted()), outcome: "anonymise_report", note: h && h.kind !== "elsewhere" ? h.note : "anonymisation runs only after owner approval (data-model §12.4); no counter in this release" });
          continue;
        }
        // action = delete
        if (!h) {
          report.push({ ...base, outcome: "not_in_this_release", note: "no tables of this class exist yet, or their purger is not built" });
          continue;
        }
        if (h.kind === "elsewhere") {
          report.push({ ...base, outcome: "handled_elsewhere", note: h.note });
          continue;
        }
        if (!cutoff) {
          report.push({ ...base, outcome: "not_in_this_release", note: "no period set" });
          continue;
        }
        const c = await countCandidates(tx, h, params(cutoff));
        if (h.kind === "count") {
          report.push({ ...base, ...c, outcome: "archive_report", note: h.note });
          continue;
        }
        if (!pol.isConfirmed) {
          report.push({ ...base, ...c, outcome: "report_only_unconfirmed", note: `${h.note}; not confirmed by a qualified reviewer, so nothing is deleted` });
          continue;
        }
        if (input.mode === "dry_run") {
          report.push({ ...base, ...c, outcome: "would_delete", note: `${h.note}; up to ${limit} rows per run` });
          continue;
        }
        const deleted = await deleteCandidates(tx, h, params(cutoff), limit);
        report.push({ ...base, ...c, deleted, outcome: "deleted", note: deleted < c.candidates - c.held ? `${h.note}; capped at ${limit} rows, the next run continues` : h.note });
      }
      const totals = {
        candidateRows: report.reduce((s, r) => s + (r.outcome === "deleted" || r.outcome === "would_delete" || r.outcome === "report_only_unconfirmed" ? (r.candidates ?? 0) : 0), 0),
        heldRows: report.reduce((s, r) => s + (r.held ?? 0), 0),
        deletedRows: report.reduce((s, r) => s + r.deleted, 0),
      };
      const [run] = await tx
        .insert(purgeRuns)
        .values({
          organizationId: ctx.organizationId,
          mode: input.mode,
          trigger: input.trigger,
          asOf,
          status: "succeeded",
          requestedBy: ctx.actor.kind === "user" ? ctx.userId : null,
          startedAt,
          finishedAt: new Date(),
          ...totals,
          report: { targets: report, held: { ids: held.ids.length, explicit: held.explicit, ...held.implicit } },
          idempotencyKey: key,
        })
        .returning();
      await audit(tx, ctx, {
        action: "platform.purge_run.completed",
        entityType: "purge_runs",
        entityId: run.id,
        siteId: null,
        after: { mode: run.mode, trigger: run.trigger, asOf: asOf.toISOString(), ...totals, deletedByTarget: Object.fromEntries(report.filter((r) => r.deleted > 0).map((r) => [r.key, r.deleted])) },
      });
      return run;
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    await db.insert(purgeRuns).values({
      organizationId: ctx.organizationId,
      mode: input.mode,
      trigger: input.trigger,
      asOf,
      status: "failed",
      requestedBy: ctx.actor.kind === "user" ? ctx.userId : null,
      startedAt,
      finishedAt: new Date(),
      errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 1000),
      idempotencyKey: null,
    });
    throw e;
  }
}

/** "Run purge now" from the screen: restricted (re-authentication) and always an execution. */
export async function executePurgeNow(ctx: AuthContext, input: { idempotencyKey?: string | null }, password: string | null) {
  ctx.require("platform.purge_run.post");
  ctx.assertWritable();
  await requireReauthentication(ctx, password, "delete records past their retention period");
  return runRetentionSweep(ctx, { mode: "execute", trigger: "manual", idempotencyKey: input.idempotencyKey });
}

export type PurgeRunView = PurgeRunRow & { requestedByName: string | null; targets: TargetReport[] };

export async function listPurgeRuns(ctx: AuthContext, limit = 20): Promise<PurgeRunView[]> {
  ctx.require("platform.purge_run.view");
  const rows = await db
    .select({ r: purgeRuns, name: users.displayName })
    .from(purgeRuns)
    .leftJoin(users, eq(users.id, purgeRuns.requestedBy))
    .where(eq(purgeRuns.organizationId, ctx.organizationId))
    .orderBy(desc(purgeRuns.startedAt))
    .limit(limit);
  return rows.map(({ r, name }) => ({ ...r, requestedByName: name, targets: ((r.report as { targets?: TargetReport[] } | null)?.targets ?? []) as TargetReport[] }));
}

/** `platform.retention_sweep` (docs/architecture.md §8): weekly; report-only unless the setting says execute. */
export const platformRetentionSweepJob = defineJob<{ asOf: string }>({
  code: "platform.retention_sweep",
  title: "Retention sweep",
  description: "Weekly: reports what is past its retention period; deletes only confirmed delete policies when platform.retention.sweep_mode is execute. Never touches held records, ledgers or audit.",
  payload: z.object({ asOf: z.iso.datetime() }).strict(),
  keyTuple: (p) => [isoWeek(new Date(p.asOf))],
  systemPermissions: ["platform.purge_run.create", "platform.purge_run.post"],
  schedule: { cron: "0 3 * * 0", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString() }) },
  maxAttempts: 2,
  run: async (run) => {
    const mode = await getSetting(db, run.ctx.organizationId, "platform.retention.sweep_mode");
    const r = await runRetentionSweep(run.ctx, { mode: mode === "execute" ? "execute" : "dry_run", trigger: "scheduled", asOf: run.asOf, idempotencyKey: run.idempotencyKey });
    return { purgeRunId: r.id, mode: r.mode, deletedRows: r.deletedRows, heldRows: r.heldRows };
  },
});

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}
