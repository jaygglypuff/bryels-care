import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { reportRunFiles, reportRuns, scheduledReportRecipients, scheduledReports, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { appUrl } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/log";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { notifyUsers, usersWithRoles } from "@/modules/platform/notifications";
import { nextRunAfter, slotKey } from "./cadence";
import { addDays, isoWeekKey, isoWeekday, localDate } from "./params";
import { reportByCode } from "./registry";
import { type ReportFormat, exportReport, hasOrgWideAssignment, reportScope } from "./run";

/**
 * Scheduled delivery with recipient re-check (US-5-05, docs/analytics-kpis.md §5.2 rules 2–3,
 * docs/permissions-matrix.md §6 rule 3; tests `reports.recipient_recheck`, `jobs.revoked_user_report_skipped`).
 *
 * At run time an AuthContext is rebuilt for every recipient from their *current* assignments. A
 * recipient who lost a permission, the site or their account is skipped and listed in report_runs,
 * and the schedule owner is notified. The report is rendered once per distinct (site scope, visible
 * columns, organization-level rows) group, so two recipients never share a file one of them could
 * not open on screen. Delivery is an in-app notification plus an email that carries only a link
 * (sign-in required), never the data.
 */

export type DeliveryInput = {
  organizationId: string;
  runKey: string;
  trigger: "schedule" | "access_report";
  scheduleId: string | null;
  scheduleName: string;
  reportCode: string;
  params: Record<string, string>;
  format: ReportFormat;
  siteId: string | null;
  recipientIds: string[];
  /** Notified when recipients are skipped. */
  ownerUserIds: string[];
  periodKey: string;
  jobId: string | null;
  correlationId: string | null;
  actorCode: string;
  onBehalfOf: string | null;
  now: Date;
};

export type DeliveryResult = { runId: string; status: string; sent: number; skipped: { userId: string; name: string; reason: string }[]; files: number; replayed?: boolean };

type Eligible = { userId: string; name: string; email: string; ctx: AuthContext; siteIds: string[]; fingerprint: string };

async function recipientContext(input: DeliveryInput, userId: string) {
  return buildContextForUser(userId, input.siteId, { actor: { kind: "system", code: input.actorCode, onBehalfOf: input.onBehalfOf }, correlationId: input.correlationId });
}

/** Re-check one recipient now; returns the eligible entry or the reason for skipping. */
async function recheck(input: DeliveryInput, u: { id: string; name: string; email: string; status: string }): Promise<Eligible | { reason: string }> {
  const def = reportByCode(input.reportCode);
  if (!def) return { reason: "the report no longer exists" };
  if (u.status !== "active") return { reason: `the account is ${u.status}` };
  const ctx = await recipientContext(input, u.id);
  if (!ctx) return { reason: "the account has no active site assignment" };
  const needed: Permission[] = ["analytics.report.view", "analytics.report.export", def.viewPermission, ...(def.exportPermission ? [def.exportPermission] : [])];
  const missing = needed.filter((p) => !ctx.can(p));
  if (missing.length) return { reason: `no longer holds ${missing.join(", ")}` };
  const orgWide = await hasOrgWideAssignment(ctx);
  if (def.orgWideOnly && !orgWide) return { reason: "the report needs an organization-wide role" };
  if (input.siteId && !ctx.allowedSiteIds.includes(input.siteId)) return { reason: "is no longer assigned to the schedule's site" };
  let siteIds: string[];
  try {
    siteIds = reportScope(ctx, [def.viewPermission, ...(def.exportPermission ? [def.exportPermission] : [])], input.siteId).map((s) => s.id).sort();
  } catch {
    return { reason: "holds the report's permissions at none of the schedule's sites" };
  }
  const columns = def.columns.filter((c) => !c.requires || siteIds.every((s) => ctx.canAt(c.requires!, s))).map((c) => c.key);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ siteIds, columns, orgLevel: def.category === "Audit and access" && orgWide && siteIds.length === ctx.allowedSiteIds.length }))
    .digest("hex")
    .slice(0, 32);
  return { userId: u.id, name: u.name, email: u.email, ctx, siteIds, fingerprint };
}

export async function deliverReport(input: DeliveryInput): Promise<DeliveryResult> {
  const def = reportByCode(input.reportCode);
  if (!def) throw new DomainError("not_found", `Report ${input.reportCode} no longer exists.`);
  // One delivery per run key: a repeat of a finished run returns it (job retries, duplicate ticks).
  await db
    .insert(reportRuns)
    .values({ organizationId: input.organizationId, scheduledReportId: input.scheduleId, reportCode: input.reportCode, trigger: input.trigger, runKey: input.runKey, periodKey: input.periodKey, backgroundJobId: input.jobId, startedAt: input.now })
    .onConflictDoNothing();
  const [run] = await db.select().from(reportRuns).where(and(eq(reportRuns.organizationId, input.organizationId), eq(reportRuns.runKey, input.runKey))).limit(1);
  if (run.status !== "running") {
    return { runId: run.id, status: run.status, sent: run.recipientsSent, skipped: run.skipped as DeliveryResult["skipped"], files: run.filesCount, replayed: true };
  }
  // A retried attempt starts the files over (the notifications are deduplicated per run).
  await db.delete(reportRunFiles).where(eq(reportRunFiles.reportRunId, run.id));

  const people = input.recipientIds.length
    ? await db.select({ id: users.id, name: users.displayName, email: users.email, status: users.status }).from(users).where(and(eq(users.organizationId, input.organizationId), inArray(users.id, input.recipientIds)))
    : [];
  const skipped: DeliveryResult["skipped"] = [];
  const eligible: Eligible[] = [];
  for (const id of input.recipientIds) {
    const u = people.find((p) => p.id === id);
    if (!u) {
      skipped.push({ userId: id, name: "unknown user", reason: "the user no longer exists" });
      continue;
    }
    const r = await recheck(input, u);
    if ("reason" in r) skipped.push({ userId: u.id, name: u.name, reason: r.reason });
    else eligible.push(r);
  }

  const groups = new Map<string, Eligible[]>();
  for (const e of eligible) groups.set(e.fingerprint, [...(groups.get(e.fingerprint) ?? []), e]);
  let files = 0;
  try {
    for (const [fingerprint, members] of groups) {
      const names = members.map((m) => m.name).join(", ");
      const file = await exportReport(members[0].ctx, input.reportCode, input.params, input.format, {
        now: input.now,
        generatedBy: `${input.trigger === "schedule" ? `Scheduled report “${input.scheduleName}”` : input.scheduleName} (system) for ${names}`,
      });
      await db.insert(reportRunFiles).values({
        organizationId: input.organizationId,
        reportRunId: run.id,
        format: input.format,
        fileName: file.fileName,
        contentType: file.contentType,
        content: file.body,
        sha256: file.sha256,
        rowCount: file.rowCount,
        truncated: file.truncated,
        siteIds: file.siteIds,
        recipientUserIds: members.map((m) => m.userId),
        permissionFingerprint: fingerprint,
      });
      files += 1;
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    if (e instanceof DomainError) {
      await db.update(reportRuns).set({ status: "failed", errorMessage: message, finishedAt: new Date(), skipped, recipientsSkipped: skipped.length }).where(eq(reportRuns.id, run.id));
      await notifyUsers(db, input.ownerUserIds, {
        organizationId: input.organizationId,
        kind: "report_failed",
        severity: "warning",
        title: `Report not delivered: ${def.title}`,
        body: `${input.scheduleName} (${input.periodKey}) could not be produced: ${message}`,
        entityType: "report_run",
        entityId: run.id,
        link: input.scheduleId ? `/reports/schedules/${input.scheduleId}` : `/reports/runs/${run.id}`,
        dedupeKey: `report_run:${run.id}:failed`,
      });
    }
    throw e;
  }

  // Delivery: in-app notification to every eligible recipient, plus an email link when configured.
  const sentIds = eligible.map((e) => e.userId);
  await notifyUsers(db, sentIds, {
    organizationId: input.organizationId,
    siteId: input.siteId,
    kind: "report_ready",
    severity: "info",
    title: `Report ready: ${def.title}`,
    body: `${input.scheduleName} · ${input.periodKey}. Open it to download your file (it follows your current access).`,
    entityType: "report_run",
    entityId: run.id,
    link: `/reports/runs/${run.id}`,
    dedupeKey: `report_run:${run.id}`,
  });
  let emailsSent = 0;
  let emailStatus: string | null = null;
  if (sentIds.length && (await getSetting(db, input.organizationId, "reports.email_delivery"))) {
    for (const e of eligible) {
      const r = await sendEmail({
        organizationId: input.organizationId,
        to: e.email,
        template: "reports.report_ready",
        subject: `Report ready: ${def.title}`,
        text: `Hello ${e.name},\n\nThe report "${def.title}" (${input.scheduleName}, ${input.periodKey}) is ready.\n\nOpen it here after signing in: ${appUrl(`/reports/runs/${run.id}`)}\n\nThe file follows your access at the time you open it; this email does not contain the report data.`,
      });
      emailStatus = r.status;
      if (r.status === "sent" || r.status === "captured") emailsSent += 1;
    }
  }
  if (skipped.length) {
    logger.warn("scheduled report recipients skipped", { reportCode: input.reportCode, runKey: input.runKey, skipped: skipped.length });
    await notifyUsers(db, input.ownerUserIds, {
      organizationId: input.organizationId,
      kind: "report_recipient_skipped",
      severity: "warning",
      title: `${skipped.length} recipient(s) skipped: ${def.title}`,
      body: `Not delivered to ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}. Update the recipients or their access.`.slice(0, 2000),
      entityType: "report_run",
      entityId: run.id,
      link: input.scheduleId ? `/reports/schedules/${input.scheduleId}` : `/reports/runs/${run.id}`,
      dedupeKey: `report_run:${run.id}:skipped`,
    });
  }
  const status = sentIds.length === 0 ? "skipped" : skipped.length ? "partial" : "succeeded";
  await db
    .update(reportRuns)
    .set({ status, recipientsSent: sentIds.length, recipientsSkipped: skipped.length, skipped, filesCount: files, emailsSent, emailStatus, finishedAt: new Date() })
    .where(eq(reportRuns.id, run.id));
  if (input.scheduleId) await db.update(scheduledReports).set({ lastRunAt: input.now }).where(eq(scheduledReports.id, input.scheduleId));
  return { runId: run.id, status, sent: sentIds.length, skipped, files };
}

/** The job body of `analytics.scheduled_report`: one delivery of a schedule for one due slot. */
export async function deliverScheduledReport(ctx: AuthContext, scheduleId: string, periodKey: string, opts: { jobId?: string | null; now: Date }) {
  const [s] = await db.select().from(scheduledReports).where(and(eq(scheduledReports.id, scheduleId), eq(scheduledReports.organizationId, ctx.organizationId))).limit(1);
  if (!s) throw new DomainError("not_found", "The schedule no longer exists.");
  if (!s.isActive) return { status: "paused", runId: null };
  const recipients = await db.select({ userId: scheduledReportRecipients.userId }).from(scheduledReportRecipients).where(eq(scheduledReportRecipients.scheduledReportId, s.id));
  return deliverReport({
    organizationId: s.organizationId,
    runKey: `schedule:${s.id}:${periodKey}`,
    trigger: "schedule",
    scheduleId: s.id,
    scheduleName: s.name,
    reportCode: s.reportCode,
    params: s.parameters as Record<string, string>,
    format: s.format as ReportFormat,
    siteId: s.siteId,
    recipientIds: recipients.map((r) => r.userId),
    ownerUserIds: [s.ownerUserId],
    periodKey,
    jobId: opts.jobId ?? null,
    correlationId: ctx.correlationId,
    actorCode: "analytics.scheduled_report",
    onBehalfOf: s.ownerUserId,
    now: opts.now,
  });
}

/**
 * Weekly access-and-exceptions report (US-5-14): the previous Monday–Sunday week, printable HTML, to
 * every holder of the roles in reports.access_report.recipient_role_codes (organization-wide
 * assignments); skipped recipients are reported to system administrators.
 */
export async function deliverAccessReport(ctx: AuthContext, opts: { now: Date; asOfDate?: string; jobId?: string | null }) {
  const tz = "Asia/Manila";
  const today = opts.asOfDate ?? localDate(opts.now, tz);
  const monday = addDays(today, 1 - isoWeekday(today) - 7);
  const week = isoWeekKey(monday);
  const roles = await getSetting(db, ctx.organizationId, "reports.access_report.recipient_role_codes");
  const recipients = await usersWithRoles(db, ctx.organizationId, roles);
  const admins = await usersWithRoles(db, ctx.organizationId, ["system_admin"]);
  return deliverReport({
    organizationId: ctx.organizationId,
    runKey: `access:${week}`,
    trigger: "access_report",
    scheduleId: null,
    scheduleName: `Weekly access and exceptions ${week}`,
    reportCode: "RPT-SEC-ACCESS",
    params: { period: "custom", from: monday, to: addDays(monday, 6) },
    format: "html",
    siteId: null,
    recipientIds: recipients,
    ownerUserIds: admins,
    periodKey: week,
    jobId: opts.jobId ?? null,
    correlationId: ctx.correlationId,
    actorCode: "analytics.access_report",
    onBehalfOf: null,
    now: opts.now,
  });
}

/**
 * Dispatcher (`analytics.schedule_dispatch`, every 5 minutes): for each active schedule whose
 * next_run_at has passed, enqueue one `analytics.scheduled_report` job for that slot and move
 * next_run_at past now (missed slots while the worker was down produce one catch-up run, not many).
 * Also clears file contents older than reports.file_retention_days (A-SEC-30).
 */
export async function dispatchDueSchedules(
  ctx: AuthContext,
  now: Date,
  enqueue: (tx: Tx, scheduleId: string, periodKey: string, siteId: string | null) => Promise<void>,
): Promise<{ dispatched: number; purged: number }> {
  let dispatched = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(scheduledReports)
      .where(and(eq(scheduledReports.organizationId, ctx.organizationId), eq(scheduledReports.isActive, true), isNotNull(scheduledReports.nextRunAt), lte(scheduledReports.nextRunAt, now)))
      .for("update", { skipLocked: true });
    for (const s of due) {
      await enqueue(tx, s.id, slotKey(s.nextRunAt!, s.timezone), s.siteId);
      const next = nextRunAfter({ cadence: s.cadence as "daily", runAtTime: s.runAtTime, weekday: s.weekday, monthDay: s.monthDay, timezone: s.timezone }, now);
      await tx.update(scheduledReports).set({ nextRunAt: next }).where(eq(scheduledReports.id, s.id));
      dispatched += 1;
    }
  });
  const days = await getSetting(db, ctx.organizationId, "reports.file_retention_days");
  const purged = await db
    .update(reportRunFiles)
    .set({ content: null, purgedAt: now })
    .where(and(eq(reportRunFiles.organizationId, ctx.organizationId), isNull(reportRunFiles.purgedAt), lt(reportRunFiles.createdAt, new Date(now.getTime() - days * 86_400_000))))
    .returning({ id: reportRunFiles.id });
  if (dispatched) await audit(db, ctx, { action: "analytics.scheduled_report.dispatched", entityType: "scheduled_report", siteId: null, after: { dispatched, at: now.toISOString() } });
  return { dispatched, purged: purged.length };
}
