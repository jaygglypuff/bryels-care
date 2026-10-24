import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { kpiRefreshLog, organizations, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { defineJob, type JobRunContext } from "@/modules/platform/job-definition";
import { notifyRoles } from "@/modules/platform/notifications";
import { computeSnapshots, reconcileSnapshots } from "./kpi/engine";
import { addDays, isIsoDate, localDate } from "./kpi/time";

/**
 * analytics.snapshot_kpis (01:30) and analytics.reconcile_kpis (02:00), docs/analytics-kpis.md §4.3,
 * docs/architecture.md §8. Both run as the organization's system actor over every active site and
 * write one kpi_refresh_log row; a failure leaves the previous snapshots in place and the charts
 * show "Stale". Neither job corrects anything.
 */

const manilaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export type KpiJobPayload = { asOf: string; businessDate: string | null; trigger: "schedule" | "manual" };

const payloadSchema = z
  .object({
    asOf: z.iso.datetime(),
    /** The business day to close; default: the day before asOf in the organization's time zone. */
    businessDate: z.string().refine(isIsoDate, "Use YYYY-MM-DD.").nullable(),
    trigger: z.enum(["schedule", "manual"]),
  })
  .strict();

const keyDate = (p: KpiJobPayload) => p.businessDate ?? addDays(manilaDate(p.asOf), -1);

async function orgContext(organizationId: string, asOf: Date, businessDate: string | null) {
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const orgTz = org?.tz ?? "Asia/Manila";
  const siteRows = await db
    .select({ id: sites.id, tz: sites.timezone })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.isActive, true)));
  const bd = businessDate ?? addDays(localDate(asOf, orgTz), -1);
  if (bd > localDate(asOf, orgTz)) throw new DomainError("validation", `The business date ${bd} is in the future.`);
  return { orgTz, sites: siteRows, businessDate: bd };
}

async function startLog(run: JobRunContext, kind: "snapshot" | "reconcile", businessDate: string) {
  const [row] = await db
    .insert(kpiRefreshLog)
    .values({ organizationId: run.ctx.organizationId, runKind: kind, businessDate, asOf: run.asOf, backgroundJobId: run.job.id, startedAt: new Date() })
    .returning();
  return row;
}

async function failLog(id: string, e: unknown) {
  await db
    .update(kpiRefreshLog)
    .set({ status: "failed", errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 2000), finishedAt: new Date() })
    .where(eq(kpiRefreshLog.id, id));
}

export async function runKpiSnapshot(run: JobRunContext, p: KpiJobPayload) {
  const ctx = run.ctx;
  const org = await orgContext(ctx.organizationId, run.asOf, p.businessDate);
  const log = await startLog(run, "snapshot", org.businessDate);
  try {
    const settings = {
      fefoWindowDays: await getSetting(db, ctx.organizationId, "analytics.fefo_window_days"),
      otifGraceDays: await getSetting(db, ctx.organizationId, "analytics.otif_grace_days"),
    };
    // One consistent read of every source table for the whole run.
    const res = await db.transaction(
      (tx) => computeSnapshots(tx, { organizationId: ctx.organizationId, sites: org.sites, orgTz: org.orgTz, businessDate: org.businessDate, now: run.asOf, settings, refreshLogId: log.id }),
      { isolationLevel: "repeatable read" },
    );
    await db.transaction(async (tx) => {
      await tx.update(kpiRefreshLog).set({ status: "succeeded", snapshotsWritten: res.written, checked: res.computed, finishedAt: new Date() }).where(eq(kpiRefreshLog.id, log.id));
      await audit(tx, ctx, {
        action: "analytics.kpi_snapshot.computed",
        entityType: "kpi_refresh_log",
        entityId: log.id,
        entityNumber: org.businessDate,
        siteId: null,
        after: { businessDate: org.businessDate, written: res.written, computed: res.computed, sites: org.sites.length },
      });
    });
    return { refreshLogId: log.id, businessDate: org.businessDate, ...res };
  } catch (e) {
    await failLog(log.id, e);
    throw e;
  }
}

export async function runKpiReconciliation(run: JobRunContext, p: KpiJobPayload) {
  const ctx = run.ctx;
  const org = await orgContext(ctx.organizationId, run.asOf, p.businessDate);
  const log = await startLog(run, "reconcile", org.businessDate);
  try {
    const res = await db.transaction((tx) => reconcileSnapshots(tx, { organizationId: ctx.organizationId, businessDate: org.businessDate, refreshLogId: log.id }), { isolationLevel: "repeatable read" });
    await db.transaction(async (tx) => {
      await tx.update(kpiRefreshLog).set({ status: "succeeded", checked: res.checked, mismatches: res.mismatches.length, finishedAt: new Date() }).where(eq(kpiRefreshLog.id, log.id));
      if (res.mismatches.length > 0) {
        const codes = [...new Set(res.mismatches.map((m) => m.kpiCode))];
        await notifyRoles(
          tx,
          { roleCodes: ["system_admin", "owner_director"] },
          {
            organizationId: ctx.organizationId,
            kind: "kpi_reconciliation_mismatch",
            severity: "critical",
            title: `KPI reconciliation: ${res.mismatches.length} value(s) differ from the source records (${org.businessDate})`,
            body: `The nightly check recomputed the KPIs of ${org.businessDate} from the posted records and found differences in ${codes.join(", ")}. First: ${res.mismatches[0].kpiCode} ${res.mismatches[0].scopeKey} ${res.mismatches[0].grain} from ${res.mismatches[0].periodStart}: ${res.mismatches[0].detail}. Nothing was changed; the dashboards show the recomputed figures, the snapshots keep what was reported.`.slice(0, 2000),
            entityType: "kpi_refresh_log",
            entityId: log.id,
            link: `/analytics/definitions?run=${log.id}#reconciliation`,
            dedupeKey: `kpi_reconcile:${log.id}`,
          },
        );
      } else if (res.checked === 0) {
        await notifyRoles(
          tx,
          { roleCodes: ["system_admin"] },
          {
            organizationId: ctx.organizationId,
            kind: "kpi_reconciliation_empty",
            severity: "warning",
            title: `KPI reconciliation found no snapshots for ${org.businessDate}`,
            body: "The nightly KPI snapshot did not write values for this day, so nothing could be checked. Look at the analytics.snapshot_kpis job in Diagnostics.",
            entityType: "kpi_refresh_log",
            entityId: log.id,
            link: "/admin/diagnostics#jobs",
            dedupeKey: `kpi_reconcile_empty:${org.businessDate}`,
          },
        );
      }
      await audit(tx, ctx, {
        action: "analytics.kpi_reconciliation.completed",
        entityType: "kpi_refresh_log",
        entityId: log.id,
        entityNumber: org.businessDate,
        siteId: null,
        after: { businessDate: org.businessDate, checked: res.checked, mismatches: res.mismatches.length, codes: [...new Set(res.mismatches.map((m) => m.kpiCode))] },
      });
    });
    return { refreshLogId: log.id, businessDate: org.businessDate, checked: res.checked, mismatches: res.mismatches.length };
  } catch (e) {
    await failLog(log.id, e);
    throw e;
  }
}

export const analyticsSnapshotKpisJob = defineJob<KpiJobPayload>({
  code: "analytics.snapshot_kpis",
  title: "KPI snapshots",
  description: "Computes every KPI for the previous day, week to date and month to date per site and for all sites, as of the end of the day; append-only.",
  payload: payloadSchema,
  keyTuple: (p) => [keyDate(p), p.trigger === "schedule" ? "schedule" : p.asOf.slice(0, 16)],
  systemPermissions: ["analytics.dashboard.view"],
  schedule: { cron: "30 1 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString(), businessDate: null, trigger: "schedule" }) },
  maxAttempts: 3,
  timeoutSeconds: 1800,
  run: (run, p) => runKpiSnapshot(run, p),
});

export const analyticsReconcileKpisJob = defineJob<KpiJobPayload>({
  code: "analytics.reconcile_kpis",
  title: "KPI reconciliation",
  description: "Recomputes the previous day's KPI snapshots from the posted records (R-queries) and raises a critical notification on any difference; never corrects.",
  payload: payloadSchema,
  keyTuple: (p) => [keyDate(p), p.trigger === "schedule" ? "schedule" : p.asOf.slice(0, 16)],
  systemPermissions: ["analytics.dashboard.view"],
  schedule: { cron: "0 2 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString(), businessDate: null, trigger: "schedule" }) },
  maxAttempts: 3,
  timeoutSeconds: 1800,
  run: (run, p) => runKpiReconciliation(run, p),
});
