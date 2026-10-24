import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { SCHEDULE_FORMATS, idempotencyKeys, reportRunFiles, reportRuns, scheduledReportRecipients, scheduledReports, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type Cadence, describeCadence, nextRunAfter } from "./cadence";
import { localDate, parseParams } from "./params";
import { reportByCode } from "./registry";
import { hasOrgWideAssignment, loadReport, reportScope } from "./run";

/**
 * Scheduled reports (US-5-05, docs/analytics-kpis.md §5.2). The creator becomes the owner and is
 * notified when a recipient is skipped. Recipients are system users who must hold the report's view
 * and export permissions; this is checked when saving and again for every recipient at every run
 * (`deliverScheduledReport`). Schedules are paused, never deleted, so their run history stays.
 */

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const ScheduleInput = z
  .object({
    name: z.string().trim().min(3, "Give the schedule a name of at least 3 characters.").max(120),
    reportCode: z.string().trim().min(3).max(60),
    siteId: z.uuid().nullable(),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    runAtTime: z.string().regex(HHMM, "Use a time like 07:00."),
    weekday: z.number().int().min(1).max(7).nullable(),
    monthDay: z.number().int().min(1).max(28).nullable(),
    format: z.enum(SCHEDULE_FORMATS),
    parameters: z.record(z.string(), z.string().max(200)),
    recipientUserIds: z.array(z.uuid()).min(1, "Choose at least one recipient.").max(50, "At most 50 recipients."),
  })
  .strict();
export type ScheduleInput = z.infer<typeof ScheduleInput>;

const TZ_DEFAULT = "Asia/Manila";

function cadenceOf(s: { cadence: string; runAtTime: string; weekday: number | null; monthDay: number | null; timezone: string }): Cadence {
  return { cadence: s.cadence as Cadence["cadence"], runAtTime: s.runAtTime, weekday: s.weekday, monthDay: s.monthDay, timezone: s.timezone };
}

export function scheduleSummary(s: { cadence: string; runAtTime: string; weekday: number | null; monthDay: number | null; timezone: string }) {
  return describeCadence(cadenceOf(s));
}

function parseInput(raw: unknown): ScheduleInput {
  const r = ScheduleInput.safeParse(raw);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    throw new DomainError("validation", "Check the highlighted fields.", { fieldErrors });
  }
  const v = r.data;
  if (v.cadence === "weekly" && !v.weekday) throw new DomainError("validation", "Choose the weekday.", { field: "weekday" });
  if (v.cadence === "monthly" && !v.monthDay) throw new DomainError("validation", "Choose the day of the month (1–28).", { field: "monthDay" });
  return { ...v, weekday: v.cadence === "weekly" ? v.weekday : null, monthDay: v.cadence === "monthly" ? v.monthDay : null };
}

/** Why a user cannot receive this report now (null = eligible). Rebuilds the user's context from current assignments. */
export async function recipientProblem(userId: string, reportCode: string, siteId: string | null): Promise<string | null> {
  const def = reportByCode(reportCode);
  if (!def) return "the report no longer exists";
  const rc = await buildContextForUser(userId, siteId);
  if (!rc) return "the account is inactive or has no site assignment";
  for (const p of ["analytics.report.view", "analytics.report.export", def.viewPermission, ...(def.exportPermission ? [def.exportPermission] : [])] as const) {
    if (!rc.can(p)) return `does not hold ${p}`;
  }
  if (def.orgWideOnly && !(await hasOrgWideAssignment(rc))) return "the report needs an organization-wide role";
  try {
    reportScope(rc, [def.viewPermission, ...(def.exportPermission ? [def.exportPermission] : [])], siteId && rc.allowedSiteIds.includes(siteId) ? siteId : null);
  } catch {
    return "holds the permissions at none of the schedule's sites";
  }
  if (siteId && !rc.allowedSiteIds.includes(siteId)) return "is no longer assigned to the schedule's site";
  return null;
}

async function validateForSave(ctx: AuthContext, v: ScheduleInput) {
  const { def } = await loadReport(ctx, v.reportCode);
  if (!def.schedulable) throw new DomainError("validation", "This report cannot be scheduled; it is delivered by the system.", { field: "reportCode" });
  // The creator must be able to run the report in the schedule's scope.
  ctx.require("analytics.report.view");
  ctx.require(def.viewPermission);
  reportScope(ctx, [def.viewPermission], v.siteId);
  parseParams(def, v.parameters, localDate(new Date(), TZ_DEFAULT));
  const found = await db
    .select({ id: users.id, name: users.displayName, status: users.status })
    .from(users)
    .where(and(eq(users.organizationId, ctx.organizationId), inArray(users.id, v.recipientUserIds)));
  const unknown = v.recipientUserIds.filter((id) => !found.some((u) => u.id === id && u.status === "active"));
  if (unknown.length) throw new DomainError("validation", "Recipients must be active users of your organization.", { field: "recipientUserIds" });
  const problems: string[] = [];
  for (const u of found) {
    const p = await recipientProblem(u.id, def.code, v.siteId);
    if (p) problems.push(`${u.name} (${p})`);
  }
  if (problems.length) throw new DomainError("validation", `These recipients cannot receive this report: ${problems.join("; ")}.`, { field: "recipientUserIds" });
  return def;
}

async function idem<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  if (key.length > 200) throw new DomainError("validation", "The request key is too long.");
  const scoped = `${command}:${key}`;
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key: scoped, command, userId: ctx.userId }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, scoped))).limit(1);
    if (!row?.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return row.result as T;
  }
  const result = await fn();
  await tx.update(idempotencyKeys).set({ result: sql`${JSON.stringify(result)}::jsonb` }).where(eq(idempotencyKeys.id, inserted[0].id));
  return result;
}

/** analytics.scheduled_report.create: the caller becomes the owner. Audit analytics.scheduled_report.created. */
export async function createSchedule(ctx: AuthContext, raw: unknown, opts: { idempotencyKey?: string | null; now?: Date } = {}) {
  ctx.require("analytics.scheduled_report.create");
  const v = parseInput(raw);
  if (v.siteId) ctx.requireSite(v.siteId);
  await validateForSave(ctx, v);
  const now = opts.now ?? new Date();
  return db.transaction((tx) =>
    idem(tx, ctx, opts.idempotencyKey, "analytics.scheduled_report.create", async () => {
      const next = nextRunAfter({ ...v, timezone: TZ_DEFAULT }, now);
      const [s] = await tx
        .insert(scheduledReports)
        .values({
          organizationId: ctx.organizationId,
          siteId: v.siteId,
          name: v.name,
          reportCode: v.reportCode,
          ownerUserId: ctx.userId,
          cadence: v.cadence,
          runAtTime: v.runAtTime,
          weekday: v.weekday,
          monthDay: v.monthDay,
          timezone: TZ_DEFAULT,
          format: v.format,
          parameters: v.parameters,
          nextRunAt: next,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await tx.insert(scheduledReportRecipients).values(v.recipientUserIds.map((userId) => ({ scheduledReportId: s.id, userId })));
      await audit(tx, ctx, {
        action: "analytics.scheduled_report.created",
        entityType: "scheduled_report",
        entityId: s.id,
        entityNumber: s.name,
        siteId: s.siteId,
        after: { reportCode: s.reportCode, cadence: scheduleSummary(s), format: s.format, parameters: s.parameters, recipients: v.recipientUserIds, nextRunAt: next.toISOString() },
      });
      return { id: s.id, nextRunAt: next.toISOString() };
    }),
  );
}

async function loadForChange(tx: Tx, ctx: AuthContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Schedule not found.");
  const [s] = await tx.select().from(scheduledReports).where(and(eq(scheduledReports.id, id), eq(scheduledReports.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!s || (s.siteId && !ctx.allowedSiteIds.includes(s.siteId))) throw new DomainError("not_found", "Schedule not found.");
  if (s.ownerUserId !== ctx.userId) ctx.require("analytics.scheduled_report.admin");
  else ctx.require("analytics.scheduled_report.create");
  return s;
}

/** Owner (or analytics.scheduled_report.admin): change a schedule. Optimistic concurrency on `version`. */
export async function updateSchedule(ctx: AuthContext, id: string, raw: unknown, expectedVersion: number, opts: { now?: Date } = {}) {
  const v = parseInput(raw);
  if (v.siteId) ctx.requireSite(v.siteId);
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const s = await loadForChange(tx, ctx, id);
    if (s.version !== expectedVersion) throw new DomainError("conflict", "Someone changed this schedule meanwhile. Reload the page and try again.");
    await validateForSave(ctx, v);
    const next = nextRunAfter({ ...v, timezone: s.timezone }, now);
    const before = await tx.select({ userId: scheduledReportRecipients.userId }).from(scheduledReportRecipients).where(eq(scheduledReportRecipients.scheduledReportId, s.id));
    const [u] = await tx
      .update(scheduledReports)
      .set({ name: v.name, reportCode: v.reportCode, siteId: v.siteId, cadence: v.cadence, runAtTime: v.runAtTime, weekday: v.weekday, monthDay: v.monthDay, format: v.format, parameters: v.parameters, nextRunAt: s.isActive ? next : null, version: s.version + 1, updatedBy: ctx.userId, updatedAt: now })
      .where(eq(scheduledReports.id, s.id))
      .returning();
    await tx.delete(scheduledReportRecipients).where(eq(scheduledReportRecipients.scheduledReportId, s.id));
    await tx.insert(scheduledReportRecipients).values(v.recipientUserIds.map((userId) => ({ scheduledReportId: s.id, userId })));
    await audit(tx, ctx, {
      action: "analytics.scheduled_report.updated",
      entityType: "scheduled_report",
      entityId: s.id,
      entityNumber: u.name,
      siteId: u.siteId,
      before: { reportCode: s.reportCode, cadence: scheduleSummary(s), format: s.format, parameters: s.parameters, recipients: before.map((r) => r.userId) },
      after: { reportCode: u.reportCode, cadence: scheduleSummary(u), format: u.format, parameters: u.parameters, recipients: v.recipientUserIds },
    });
    return u;
  });
}

/** Pause or resume (reason required). Audit analytics.scheduled_report.paused / .resumed. */
export async function setScheduleActive(ctx: AuthContext, id: string, active: boolean, reason: string, opts: { now?: Date } = {}) {
  const r = reason.trim();
  if (r.length < 3) throw new DomainError("validation", "Give a reason of at least 3 characters.", { field: "reason" });
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const s = await loadForChange(tx, ctx, id);
    if (s.isActive === active) return s;
    const [u] = await tx
      .update(scheduledReports)
      .set({ isActive: active, nextRunAt: active ? nextRunAfter(cadenceOf(s), now) : null, version: s.version + 1, updatedBy: ctx.userId, updatedAt: now })
      .where(eq(scheduledReports.id, s.id))
      .returning();
    await audit(tx, ctx, { action: active ? "analytics.scheduled_report.resumed" : "analytics.scheduled_report.paused", entityType: "scheduled_report", entityId: s.id, entityNumber: s.name, siteId: s.siteId, reason: r, before: { isActive: s.isActive }, after: { isActive: active } });
    return u;
  });
}

function visibleScheduleWhere(ctx: AuthContext, admin: boolean) {
  const site = or(isNull(scheduledReports.siteId), inArray(scheduledReports.siteId, ctx.allowedSiteIds));
  const base = and(eq(scheduledReports.organizationId, ctx.organizationId), site);
  if (admin) return base;
  const mine = or(
    eq(scheduledReports.ownerUserId, ctx.userId),
    inArray(scheduledReports.id, db.select({ id: scheduledReportRecipients.scheduledReportId }).from(scheduledReportRecipients).where(eq(scheduledReportRecipients.userId, ctx.userId))),
  );
  return and(base, mine);
}

/** analytics.scheduled_report.view: own schedules and those the caller receives; administrators see all in their sites. */
export async function listSchedules(ctx: AuthContext) {
  ctx.require("analytics.scheduled_report.view");
  const admin = ctx.can("analytics.scheduled_report.admin");
  const rows = await db
    .select({ s: scheduledReports, owner: users.displayName })
    .from(scheduledReports)
    .innerJoin(users, eq(users.id, scheduledReports.ownerUserId))
    .where(visibleScheduleWhere(ctx, admin))
    .orderBy(desc(scheduledReports.isActive), scheduledReports.name);
  return rows.map((r) => ({ ...r.s, ownerName: r.owner, summary: scheduleSummary(r.s), title: reportByCode(r.s.reportCode)?.title ?? r.s.reportCode, mine: r.s.ownerUserId === ctx.userId }));
}

export async function getSchedule(ctx: AuthContext, id: string) {
  ctx.require("analytics.scheduled_report.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Schedule not found.");
  const admin = ctx.can("analytics.scheduled_report.admin");
  const [r] = await db
    .select({ s: scheduledReports, owner: users.displayName })
    .from(scheduledReports)
    .innerJoin(users, eq(users.id, scheduledReports.ownerUserId))
    .where(and(eq(scheduledReports.id, id), visibleScheduleWhere(ctx, admin)))
    .limit(1);
  if (!r) throw new DomainError("not_found", "Schedule not found.");
  const recipients = await db
    .select({ id: users.id, name: users.displayName, email: users.email, status: users.status })
    .from(scheduledReportRecipients)
    .innerJoin(users, eq(users.id, scheduledReportRecipients.userId))
    .where(eq(scheduledReportRecipients.scheduledReportId, id))
    .orderBy(users.displayName);
  const runs = await db.select().from(reportRuns).where(eq(reportRuns.scheduledReportId, id)).orderBy(desc(reportRuns.createdAt)).limit(20);
  const canEdit = r.s.ownerUserId === ctx.userId ? ctx.can("analytics.scheduled_report.create") : admin;
  return { ...r.s, ownerName: r.owner, summary: scheduleSummary(r.s), title: reportByCode(r.s.reportCode)?.title ?? r.s.reportCode, recipients, runs, canEdit };
}

/** People who could be chosen as recipients (active users of the organization sharing a site with the caller). */
export async function recipientOptions(ctx: AuthContext) {
  ctx.require("analytics.scheduled_report.create");
  return db
    .select({ id: users.id, name: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.organizationId, ctx.organizationId), eq(users.status, "active")))
    .orderBy(users.displayName);
}

/** A delivered run with the files the caller received (recipients only; files re-check access at download). */
export async function getRunForRecipient(ctx: AuthContext, runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new DomainError("not_found", "Report delivery not found.");
  const [run] = await db.select().from(reportRuns).where(and(eq(reportRuns.id, runId), eq(reportRuns.organizationId, ctx.organizationId))).limit(1);
  if (!run) throw new DomainError("not_found", "Report delivery not found.");
  const files = await db
    .select({ id: reportRunFiles.id, fileName: reportRunFiles.fileName, format: reportRunFiles.format, rowCount: reportRunFiles.rowCount, truncated: reportRunFiles.truncated, siteIds: reportRunFiles.siteIds, recipientUserIds: reportRunFiles.recipientUserIds, purgedAt: reportRunFiles.purgedAt, createdAt: reportRunFiles.createdAt, sha256: reportRunFiles.sha256 })
    .from(reportRunFiles)
    .where(eq(reportRunFiles.reportRunId, run.id));
  const mine = files.filter((f) => (f.recipientUserIds as string[]).includes(ctx.userId));
  const owner = run.scheduledReportId ? (await db.select({ o: scheduledReports.ownerUserId }).from(scheduledReports).where(eq(scheduledReports.id, run.scheduledReportId)).limit(1))[0]?.o : null;
  if (mine.length === 0 && owner !== ctx.userId && !ctx.can("analytics.scheduled_report.admin")) throw new DomainError("not_found", "Report delivery not found.");
  return { run, files: mine, title: reportByCode(run.reportCode)?.title ?? run.reportCode, isOwner: owner === ctx.userId };
}

/**
 * Download of a delivered file: only a recipient of that file, re-checked now (the recipient must
 * still hold the report permissions at every site of the file). Audit analytics.report_run_file.downloaded.
 */
export async function downloadRunFile(ctx: AuthContext, runId: string, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId) || !/^[0-9a-f-]{36}$/i.test(runId)) throw new DomainError("not_found", "File not found.");
  const [f] = await db
    .select()
    .from(reportRunFiles)
    .where(and(eq(reportRunFiles.id, fileId), eq(reportRunFiles.reportRunId, runId), eq(reportRunFiles.organizationId, ctx.organizationId)))
    .limit(1);
  if (!f || !(f.recipientUserIds as string[]).includes(ctx.userId)) throw new DomainError("not_found", "File not found.");
  const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, runId)).limit(1);
  const def = reportByCode(run.reportCode);
  if (!def) throw new DomainError("not_found", "File not found.");
  ctx.require("analytics.report.export");
  for (const s of f.siteIds as string[]) {
    ctx.requireSite(s);
    if (!ctx.canAt(def.viewPermission, s) || (def.exportPermission && !ctx.canAt(def.exportPermission, s))) throw new DomainError("forbidden", "You no longer hold the permissions this report needs.");
  }
  if (!f.content || f.purgedAt) throw new DomainError("state", "This file was removed after the retention period. Run the report again from the library.");
  await audit(db, ctx, {
    action: "analytics.report_run_file.downloaded",
    entityType: "report_run_file",
    entityId: f.id,
    entityNumber: run.reportCode,
    siteId: (f.siteIds as string[]).length === 1 ? (f.siteIds as string[])[0] : null,
    after: { runId, fileName: f.fileName, sha256: f.sha256, rowCount: f.rowCount },
  });
  return { fileName: f.fileName, contentType: f.contentType, body: f.content, sha256: f.sha256, rowCount: f.rowCount };
}
