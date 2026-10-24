/**
 * US-5-05 scheduled reports with recipient re-check (docs/analytics-kpis.md §5.2; tests
 * `reports.recipient_recheck`, `jobs.revoked_user_report_skipped`) and US-5-14 delivery of the weekly
 * access report. Jobs are called directly through the runner (docs/testing.md §2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, backgroundJobs, dispositions, emailOutbox, notifications, reportRunFiles, reportRuns, rolePermissions, roles, scheduledReports, userSiteAssignments, users } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { systemContext } from "@/lib/auth/system";
import { runJob } from "@/modules/platform/jobs";
import {
  analyticsScheduledReportJob,
  createSchedule,
  deliverAccessReport,
  deliverScheduledReport,
  type DeliveryResult,
  dispatchDueSchedules,
  downloadRunFile,
  getRunForRecipient,
  getSchedule,
  listSchedules,
  setScheduleActive,
  updateSchedule,
} from "@/modules/reports";
import { enqueueJob } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";


let kit: Kit;
let manager: AuthContext;
let qa: AuthContext;
let owner: AuthContext;
let operator: AuthContext;
let whNfd: AuthContext;
const ids: Record<string, string> = {};

const userId = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;
const sys = () => systemContext(kit.orgId, { code: "analytics.scheduled_report", systemPermissions: ["analytics.report.view"] });

beforeAll(async () => {
  process.env.EMAIL_PROVIDER = "outbox";
  await resetTestDatabase();
  kit = await loadKit();
  for (const e of ["manager.nfd", "qa.nfd", "owner", "warehouse.nfd", "admin", "operator.nfd"]) ids[e] = await userId(`${e}@bryels-care.test`);
  manager = (await buildContextForUser(ids["manager.nfd"]))!;
  qa = (await buildContextForUser(ids["qa.nfd"]))!;
  owner = (await buildContextForUser(ids.owner))!;
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  whNfd = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  // a QA decision at each site, so the dispositions report has rows in both scopes
  const whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  for (const [w, site, code] of [[whNfd, kit.nfd, "A-01"], [whRvs, kit.rvs, "FG-01"]] as const) {
    const lot = await makeLot(w, site.id, (await loc(site.id, code)).id, "10", { status: "quarantine" });
    await db.insert(dispositions).values({ organizationId: kit.orgId, siteId: site.id, subjectType: "lot", subjectId: lot.id, decision: "release", fromStatus: "quarantine", toStatus: "released", reason: "CoA reviewed (demo)", decidedBy: ids["qa.nfd"] });
  }
});

const base = () => ({
  name: "Weekly QA decisions",
  reportCode: "RPT-QUA-DISPOSITIONS",
  siteId: null,
  cadence: "weekly" as const,
  runAtTime: "07:00",
  weekday: 1,
  monthDay: null,
  format: "xlsx" as const,
  parameters: { period: "last_7_days" },
  recipientUserIds: [] as string[],
});

let scheduleId: string;

describe("schedules (US-5-05)", () => {
  it("validates cadence, parameters and recipients at save; the creator becomes the owner", async () => {
    await expectCode(createSchedule(operator, { ...base(), recipientUserIds: [ids["manager.nfd"]] }), "forbidden");
    await expectCode(createSchedule(manager, { ...base(), recipientUserIds: [] }), "validation");
    await expectCode(createSchedule(manager, { ...base(), weekday: null, recipientUserIds: [ids["manager.nfd"]] }), "validation");
    await expectCode(createSchedule(manager, { ...base(), parameters: { period: "decade" }, recipientUserIds: [ids["manager.nfd"]] }), "validation");
    await expectCode(createSchedule(manager, { ...base(), reportCode: "RPT-SEC-ACCESS", recipientUserIds: [ids["manager.nfd"]] }), "validation"); // system-delivered only
    // the warehouse operator has report view only: cannot receive files
    const e = await expectCode(createSchedule(manager, { ...base(), recipientUserIds: [ids["manager.nfd"], ids["warehouse.nfd"]] }), "validation");
    expect(e.message).toContain("Lito Pascual");
    // cross-site: a NFD manager cannot schedule for RVS
    await expectCode(createSchedule(manager, { ...base(), siteId: kit.rvs.id, recipientUserIds: [ids["manager.nfd"]] }), "not_found");
    const now = new Date("2026-10-21T02:00:00Z"); // Wednesday 10:00 Manila
    const r = await createSchedule(manager, { ...base(), recipientUserIds: [ids["manager.nfd"], ids["qa.nfd"], ids.owner] }, { idempotencyKey: "k-1", now });
    expect(r.nextRunAt).toBe("2026-10-25T23:00:00.000Z"); // Monday 07:00 Manila
    const again = await createSchedule(manager, { ...base(), recipientUserIds: [ids["manager.nfd"], ids["qa.nfd"], ids.owner] }, { idempotencyKey: "k-1", now });
    expect(again.id).toBe(r.id);
    scheduleId = r.id;
    const s = await getSchedule(manager, r.id);
    expect(s.ownerUserId).toBe(ids["manager.nfd"]);
    expect(s.summary).toBe("Every Monday at 07:00 (Asia/Manila)");
    expect(s.recipients).toHaveLength(3);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "analytics.scheduled_report.created"), eq(auditEvents.entityId, r.id)));
    expect(ev.actorId).toBe(ids["manager.nfd"]);
  });

  it("visibility: owners and recipients see the schedule; others do not; only the owner or an admin edits", async () => {
    expect((await listSchedules(qa)).map((s) => s.id)).toContain(scheduleId);
    const sales = (await buildContextForUser(await userId("sales@bryels-care.test")))!;
    expect((await listSchedules(sales)).map((s) => s.id)).not.toContain(scheduleId);
    await expectCode(getSchedule(sales, scheduleId), "not_found");
    await expectCode(setScheduleActive(qa, scheduleId, false, "not mine"), "forbidden");
    const s = await getSchedule(manager, scheduleId);
    await expectCode(updateSchedule(manager, scheduleId, { ...base(), recipientUserIds: [ids["manager.nfd"]] }, s.version + 5), "conflict");
  });
});

describe("reports.recipient_recheck", () => {
  it("rebuilds a context per recipient; one file per distinct site/permission group; in-app and email delivery", async () => {
    const ctx = await sys();
    const r = <DeliveryResult>await deliverScheduledReport(ctx, scheduleId, "2026-10-26T07:00", { now: new Date() });
    expect(r).toMatchObject({ status: "succeeded", sent: 3, files: 2 });
    const files = await db.select().from(reportRunFiles).where(eq(reportRunFiles.reportRunId, r.runId!));
    const byRecipients = Object.fromEntries(files.map((f) => [[...(f.recipientUserIds as string[])].sort().join(","), f]));
    const nfdOnly = byRecipients[ids["manager.nfd"]];
    expect(nfdOnly.siteIds).toEqual([kit.nfd.id]);
    const both = byRecipients[[ids.owner, ids["qa.nfd"]].sort().join(",")];
    expect([...(both.siteIds as string[])].sort()).toEqual([kit.nfd.id, kit.rvs.id].sort());
    expect(both.rowCount).toBeGreaterThan(nfdOnly.rowCount);
    expect(nfdOnly.format).toBe("xlsx");
    const ready = await db.select().from(notifications).where(and(eq(notifications.kind, "report_ready"), eq(notifications.entityId, r.runId!)));
    expect(ready.map((n) => n.recipientUserId).sort()).toEqual([ids["manager.nfd"], ids["qa.nfd"], ids.owner].sort());
    expect(ready[0].link).toBe(`/reports/runs/${r.runId}`);
    const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.template, "reports.report_ready"));
    expect(mails).toHaveLength(3);
    expect(mails[0].bodyText).toContain(`/reports/runs/${r.runId}`);
    expect(mails[0].bodyText).not.toContain("CoA reviewed"); // a link, never the data
    const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, r.runId!));
    expect(run).toMatchObject({ status: "succeeded", recipientsSent: 3, recipientsSkipped: 0, filesCount: 2, emailsSent: 3 });
    // the export audit records the system actor acting for the schedule owner
    const exp = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "analytics.report.exported"), eq(auditEvents.actorLabel, "system:analytics.scheduled_report")));
    expect(exp.length).toBe(2);
    expect(exp.every((e) => e.onBehalfOf === ids["manager.nfd"])).toBe(true);
    // a repeat of the same slot is a replay, not a second delivery
    const replay = await deliverScheduledReport(ctx, scheduleId, "2026-10-26T07:00", { now: new Date() });
    expect(replay).toMatchObject({ runId: r.runId, replayed: true });
  });

  it("recipients download only their own file, re-checked at download time", async () => {
    const [run] = await db.select().from(reportRuns).where(eq(reportRuns.scheduledReportId, scheduleId));
    const qaView = await getRunForRecipient(qa, run.id);
    expect(qaView.files).toHaveLength(1);
    const file = await downloadRunFile(qa, run.id, qaView.files[0].id);
    expect(file.body.length).toBeGreaterThan(100);
    await expectCode(downloadRunFile(manager, run.id, qaView.files[0].id), "not_found");
    const sales = (await buildContextForUser(await userId("sales@bryels-care.test")))!;
    await expectCode(getRunForRecipient(sales, run.id), "not_found");
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.action, "analytics.report_run_file.downloaded"));
    expect(ev.actorId).toBe(ids["qa.nfd"]);
  });
});

describe("jobs.revoked_user_report_skipped", () => {
  it("a recipient who lost a permission or their access is skipped and logged; the owner is notified", async () => {
    const [qaRole] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, "qa_qc")));
    await db.delete(rolePermissions).where(and(eq(rolePermissions.roleId, qaRole.id), eq(rolePermissions.permissionCode, "analytics.report.export")));
    // the owner's assignment ends
    await db.update(userSiteAssignments).set({ validFrom: new Date(Date.now() - 2 * 86_400_000), validTo: new Date(Date.now() - 60_000) }).where(eq(userSiteAssignments.userId, ids.owner));
    try {
      const r = <DeliveryResult>await deliverScheduledReport(await sys(), scheduleId, "2026-11-02T07:00", { now: new Date() });
      expect(r.status).toBe("partial");
      expect(r.sent).toBe(1);
      expect(r.skipped.map((s) => s.userId).sort()).toEqual([ids["qa.nfd"], ids.owner].sort());
      expect(r.skipped.find((s) => s.userId === ids["qa.nfd"])?.reason).toBe("no longer holds analytics.report.export");
      expect(r.skipped.find((s) => s.userId === ids.owner)?.reason).toBe("the account has no active site assignment");
      const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, r.runId));
      expect(run.recipientsSkipped).toBe(2);
      const warn = await db.select().from(notifications).where(and(eq(notifications.kind, "report_recipient_skipped"), eq(notifications.entityId, r.runId)));
      expect(warn.map((n) => n.recipientUserId)).toEqual([ids["manager.nfd"]]);
      expect(warn[0].body).toContain("Nina Quiambao");
      // the earlier file can no longer be downloaded by qa (re-check at download)
      const qaNow = (await buildContextForUser(ids["qa.nfd"]))!;
      const [old] = await db.select().from(reportRuns).where(eq(reportRuns.runKey, `schedule:${scheduleId}:2026-10-26T07:00`));
      const f = (await getRunForRecipient(qaNow, old.id)).files[0];
      await expectCode(downloadRunFile(qaNow, old.id, f.id), "forbidden");
    } finally {
      await db.insert(rolePermissions).values({ roleId: qaRole.id, permissionCode: "analytics.report.export" });
      await db.update(userSiteAssignments).set({ validTo: null }).where(eq(userSiteAssignments.userId, ids.owner));
    }
  });

  it("when nobody is eligible the run is skipped, not failed", async () => {
    await db.update(users).set({ status: "deactivated" }).where(eq(users.id, ids["qa.nfd"]));
    const s = await getSchedule(manager, scheduleId);
    await updateSchedule(manager, scheduleId, { ...base(), recipientUserIds: [ids["manager.nfd"]] }, s.version);
    await db.update(users).set({ status: "deactivated" }).where(eq(users.id, ids["manager.nfd"]));
    try {
      const r = <DeliveryResult>await deliverScheduledReport(await sys(), scheduleId, "2026-11-09T07:00", { now: new Date() });
      expect(r).toMatchObject({ status: "skipped", sent: 0 });
    } finally {
      await db.update(users).set({ status: "active" }).where(eq(users.id, ids["manager.nfd"]));
      await db.update(users).set({ status: "active" }).where(eq(users.id, ids["qa.nfd"]));
    }
  });
});

describe("dispatcher and job", () => {
  it("analytics.schedule_dispatch enqueues one delivery per due slot and moves next_run_at past now", async () => {
    const ctx = await systemContext(kit.orgId, { code: "analytics.schedule_dispatch", systemPermissions: ["analytics.scheduled_report.view"] });
    await db.update(scheduledReports).set({ nextRunAt: new Date("2026-10-19T23:00:00Z") }).where(eq(scheduledReports.id, scheduleId));
    const now = new Date("2026-10-21T02:00:00Z");
    const r = await dispatchDueSchedules(ctx, now, async (tx, id, periodKey) => {
      await enqueueJob(tx, ctx, analyticsScheduledReportJob, { scheduleId: id, periodKey });
    });
    expect(r.dispatched).toBe(1);
    const [s] = await db.select().from(scheduledReports).where(eq(scheduledReports.id, scheduleId));
    expect(s.nextRunAt?.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    const [job] = await db.select().from(backgroundJobs).where(like(backgroundJobs.idempotencyKey, `analytics.scheduled_report:${scheduleId}:%`));
    expect(job.idempotencyKey).toBe(`analytics.scheduled_report:${scheduleId}:2026-10-20T07:00`);
    expect(await runJob(job.id, { now })).toMatchObject({ status: "succeeded" });
    expect((await dispatchDueSchedules(ctx, now, async () => undefined)).dispatched).toBe(0);
  });

  it("a paused schedule is not delivered", async () => {
    await setScheduleActive(manager, scheduleId, false, "Holiday shutdown");
    const r = <DeliveryResult>await deliverScheduledReport(await sys(), scheduleId, "2026-11-16T07:00", { now: new Date() });
    expect(r).toMatchObject({ status: "paused" });
    const [s] = await db.select().from(scheduledReports).where(eq(scheduledReports.id, scheduleId));
    expect(s.nextRunAt).toBeNull();
  });
});

describe("US-5-14 weekly access report delivery", () => {
  it("goes to the owner roles as printable HTML, once per ISO week", async () => {
    const ctx = await systemContext(kit.orgId, { code: "analytics.access_report", systemPermissions: ["platform.audit.view"] });
    const r = await deliverAccessReport(ctx, { now: new Date(), asOfDate: "2026-10-26" });
    expect(r.status).toBe("succeeded");
    const [run] = await db.select().from(reportRuns).where(eq(reportRuns.id, r.runId));
    expect(run.runKey).toBe("access:2026-W43");
    const files = await db.select().from(reportRunFiles).where(eq(reportRunFiles.reportRunId, r.runId));
    expect(files).toHaveLength(1);
    expect(files[0].recipientUserIds).toEqual([ids.owner]);
    expect(files[0].format).toBe("html");
    expect(files[0].content!.toString("utf8")).toContain("Access and exceptions (weekly)");
    expect(files[0].content!.toString("utf8")).toContain("2026-10-19 to 2026-10-25");
    expect((await deliverAccessReport(ctx, { now: new Date(), asOfDate: "2026-10-26" })).replayed).toBe(true);
  });
});
