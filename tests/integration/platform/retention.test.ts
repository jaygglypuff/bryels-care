/**
 * US-9-05 retention policies, legal holds and the purge sweep; US-9-03 restore-drill evidence.
 * Test ids (docs/testing.md §5.2): retention.unconfirmed_reports_only, retention.legal_hold_blocks_purge,
 * retention.implicit_hold_open_complaint, retention.protected_classes_never_purged,
 * retention.dry_run_deletes_nothing, retention.confirm_not_editor, legal_hold.release_not_placer,
 * authz.cross_site.legal_hold, authz.role_escalation.retention, restore_drill.signoff_not_performer.
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, backgroundJobs, complaints, customers, idempotencyKeys, inventoryLots, legalHolds, notifications, purgeRuns, restoreDrills, retentionPolicies, stockMovements, users, workerHeartbeats } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  confirmRetentionPolicy,
  enqueueJob,
  executePurgeNow,
  listLegalHolds,
  listPurgeRuns,
  listRestoreDrills,
  listRetentionPolicies,
  placeLegalHold,
  platformRetentionSweepJob,
  recordRestoreDrill,
  releaseLegalHold,
  resolveHeldSet,
  runJob,
  runRetentionSweep,
  saveRetentionPolicy,
  signOffRestoreDrill,
  systemContext,
  type TargetReport,
} from "@/modules/platform";
import { deliverAlerts, evaluateAlerts } from "@/modules/governance/jobs/metrics";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let admin: AuthContext;
let qaLead: AuthContext;
let qaNfd: AuthContext;
let manager: AuthContext;
let wh: AuthContext;
let auditor: AuthContext;

const PW = "demo1234";
const OLD = new Date("2025-01-01T00:00:00Z");
const target = (runReport: unknown, key: string) => ((runReport as { targets: TargetReport[] }).targets ?? []).find((t) => t.key === key)!;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  qaNfd = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  // The W4F demo seed loads and confirms policies; these tests start from the shipped defaults.
  await db.delete(retentionPolicies);
  await db.delete(legalHolds);
});

async function lotAt(siteId: string) {
  const [l] = await db.select().from(inventoryLots).where(eq(inventoryLots.siteId, siteId)).limit(1);
  return l;
}

async function oldNotification(entityId: string | null, severity = "info", ack = false) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
  const [n] = await db
    .insert(notifications)
    .values({ organizationId: kit.orgId, siteId: kit.nfd.id, recipientUserId: u.id, kind: "test", severity, title: "Old notice (fictional)", body: "fictional", entityType: entityId ? "inventory_lots" : null, entityId, createdAt: OLD, acknowledgedAt: ack ? OLD : null })
    .returning();
  return n.id;
}

describe("retention policies", () => {
  it("authz.role_escalation.retention: only holders of the view permission read policies; site managers and operators are refused", async () => {
    const list = await listRetentionPolicies(admin);
    expect(list.find((p) => p.dataClass === "stock_ledger")).toMatchObject({ source: "default", isConfirmed: false, action: "archive", protected: true });
    expect(list.find((p) => p.dataClass === "jobs_notifications" && p.target === "notifications")).toMatchObject({ retentionDays: 180, action: "delete" });
    expect((await listRetentionPolicies(auditor)).length).toBe(list.length);
    await expectCode(listRetentionPolicies(manager), "forbidden");
    await expectCode(listRetentionPolicies(wh), "forbidden");
  });

  it("retention.protected_classes_never_purged (config): ledgers, quality, audit cannot be set to delete or anonymise", async () => {
    const base = { target: "*", period: { unit: "months" as const, value: 12 }, basis: "record_date" as const, minimumMonths: null, effectiveFrom: "2026-10-01", reason: "trying to shorten" };
    for (const dataClass of ["stock_ledger", "quality_batch", "audit"] as const) {
      await expectCode(saveRetentionPolicy(admin, { ...base, dataClass, action: "delete" }, PW), "validation");
      await expectCode(saveRetentionPolicy(admin, { ...base, dataClass, action: "anonymise" }, PW), "validation");
    }
    await expectCode(saveRetentionPolicy(qaLead, { ...base, dataClass: "jobs_notifications", target: "notifications", action: "delete" }, PW), "forbidden");
    await expectCode(saveRetentionPolicy(admin, { ...base, dataClass: "jobs_notifications", target: "notifications", action: "delete" }, "wrong-password"), "reauth_required");
  });

  it("retention.confirm_not_editor: an edit clears the confirmation; the editor cannot confirm; system_admin cannot confirm at all", async () => {
    const row = await saveRetentionPolicy(admin, { dataClass: "jobs_notifications", target: "notifications", period: { unit: "days", value: 180 }, basis: "record_date", minimumMonths: null, action: "delete", effectiveFrom: "2026-10-01", reason: "Reviewed by the fictional DPO" }, PW);
    expect(row).toMatchObject({ isConfirmed: false, retentionDays: 180, updatedBy: admin.userId });
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.retention_policy.updated"), eq(auditEvents.entityId, row.id)));
    expect(ev.reason).toBe("Reviewed by the fictional DPO");
    await expectCode(confirmRetentionPolicy(admin, { dataClass: "jobs_notifications", target: "notifications", note: "ok" }, PW), "forbidden");
    // The owner edits another class and may not confirm their own edit.
    await saveRetentionPolicy(owner, { dataClass: "jobs_notifications", target: "background_jobs", period: { unit: "days", value: 90 }, basis: "record_date", minimumMonths: null, action: "delete", effectiveFrom: "2026-10-01", reason: "owner edit" }, PW);
    await expectCode(confirmRetentionPolicy(owner, { dataClass: "jobs_notifications", target: "background_jobs", note: "self" }, PW), "separation_of_duties");
    const [denied] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.authorization.denied"), eq(auditEvents.reason, "confirmer_is_editor")));
    expect(denied).toBeTruthy();
    const ok = await confirmRetentionPolicy(owner, { dataClass: "jobs_notifications", target: "notifications", note: "Fictional DPO memo 2026-10" }, PW);
    expect(ok).toMatchObject({ isConfirmed: true, confirmedBy: owner.userId });
    await expectCode(confirmRetentionPolicy(owner, { dataClass: "jobs_notifications", target: "notifications", note: "again" }, PW), "conflict");
    // A shipped default is stored and confirmed in one step.
    const idem = await confirmRetentionPolicy(owner, { dataClass: "idempotency", target: "idempotency_keys", note: "IT confirmed 7 days" }, PW);
    expect(idem).toMatchObject({ retentionDays: 7, isConfirmed: true });
  });
});

describe("legal holds", () => {
  it("authz.cross_site.legal_hold and role escalation: a site-scoped QA cannot hold another site's lot; operators cannot place holds", async () => {
    const rvsLot = await lotAt(kit.rvs.id);
    await expectCode(placeLegalHold(qaNfd, { holdKind: "litigation", entityType: "inventory_lot", reference: rvsLot.lotNumber, reason: "Customer claim (fictional)" }), "not_found");
    await expectCode(placeLegalHold(wh, { holdKind: "litigation", entityType: "inventory_lot", reference: rvsLot.lotNumber, reason: "Customer claim (fictional)" }), "forbidden");
    await expectCode(placeLegalHold(qaNfd, { holdKind: "litigation", entityType: "inventory_lot", reference: "NO-SUCH-LOT", reason: "Customer claim (fictional)" }), "not_found");
  });

  it("legal_hold.release_not_placer: place, refuse a duplicate, refuse release by the placer, release by another person", async () => {
    const lot = await lotAt(kit.nfd.id);
    const h = await placeLegalHold(qaNfd, { holdKind: "complaint", entityType: "inventory_lot", reference: lot.lotNumber, reason: "Keep for a regulator query (fictional)" });
    expect(h).toMatchObject({ entityId: lot.id, entityLabel: lot.lotNumber, placedBy: qaNfd.userId });
    await expectCode(placeLegalHold(qaLead, { holdKind: "audit", entityType: "inventory_lot", reference: lot.lotNumber, reason: "Second hold same lot" }), "conflict");
    await expectCode(releaseLegalHold(qaNfd, { id: h.id, note: "my own hold" }), "separation_of_duties");
    await expectCode(releaseLegalHold(manager, { id: h.id, note: "not allowed" }), "forbidden");
    expect((await listLegalHolds(qaNfd)).map((x) => x.id)).toContain(h.id);
    const released = await releaseLegalHold(qaLead, { id: h.id, note: "Query closed (fictional)" });
    expect(released.releasedBy).toBe(qaLead.userId);
    await expectCode(releaseLegalHold(owner, { id: h.id, note: "again please" }), "conflict");
    const evs = await db.select({ a: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, h.id));
    expect(evs.map((e) => e.a).sort()).toEqual(["identity.authorization.denied", "platform.legal_hold.placed", "platform.legal_hold.released"]);
  });

  it("the held set expands a held batch to its output lot and includes open complaints", async () => {
    const [b] = await db.execute<{ batch_number: string; id: string; output_lot_id: string }>(sql`select batch_number, id, output_lot_id from batches where output_lot_id is not null and site_id = ${kit.nfd.id} limit 1`);
    const h = await placeLegalHold(qaLead, { holdKind: "recall", entityType: "batch", reference: b.batch_number, reason: "Recall evidence (fictional)" });
    const held = await resolveHeldSet(db, kit.orgId);
    expect(held.ids).toContain(b.id);
    expect(held.ids).toContain(b.output_lot_id);
    await releaseLegalHold(owner, { id: h.id, note: "Recall closed (fictional)" });
  });
});

describe("retention sweep", () => {
  it("retention.unconfirmed_reports_only + retention.dry_run_deletes_nothing", async () => {
    const plain = await oldNotification(null);
    const run = await runRetentionSweep(admin, { mode: "dry_run", trigger: "manual", asOf: new Date("2026-10-25T00:00:00Z") });
    expect(run).toMatchObject({ mode: "dry_run", status: "succeeded", deletedRows: 0 });
    expect(target(run.report, "jobs_notifications/notifications")).toMatchObject({ outcome: "would_delete", deleted: 0 });
    expect(target(run.report, "jobs_notifications/background_jobs").outcome).toBe("report_only_unconfirmed");
    expect(target(run.report, "stock_ledger/*").outcome).toBe("archive_report");
    expect(target(run.report, "security/sessions").outcome).toBe("handled_elsewhere");
    expect(target(run.report, "financial/*").outcome).toBe("archive_report");
    expect(await db.select().from(notifications).where(eq(notifications.id, plain))).toHaveLength(1);
    await expectCode(runRetentionSweep(manager, { mode: "dry_run", trigger: "manual" }), "forbidden");
    await expectCode(runRetentionSweep(qaLead, { mode: "dry_run", trigger: "manual" }), "forbidden");
  });

  it("retention.legal_hold_blocks_purge + retention.implicit_hold_open_complaint: execution deletes only unheld, confirmed, delete-policy rows", async () => {
    const nfdLot = await lotAt(kit.nfd.id);
    const [lot2] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.nfd.id), sql`${inventoryLots.id} <> ${nfdLot.id}`)).limit(1);
    await placeLegalHold(qaNfd, { holdKind: "litigation", entityType: "inventory_lot", reference: nfdLot.lotNumber, reason: "Litigation hold (fictional)" });
    // An open complaint about lot2 holds it implicitly.
    const [cust] = await db.select().from(customers).limit(1);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, "sales@bryels-care.test"));
    await db.insert(complaints).values({ organizationId: kit.orgId, siteId: kit.nfd.id, complaintNumber: `CMP-T-${uuidv7().slice(-6)}`, status: "open", category: "quality", channel: "email", customerId: cust.id, lotId: lot2.id, description: "Fictional complaint", receivedAt: new Date(), receivedBy: u.id, statusChangedBy: u.id } as typeof complaints.$inferInsert);
    const plain = await oldNotification(null);
    const heldExplicit = await oldNotification(nfdLot.id);
    const heldImplicit = await oldNotification(lot2.id);
    const critical = await oldNotification(null, "critical", false);
    const recent = (await db.insert(notifications).values({ organizationId: kit.orgId, siteId: kit.nfd.id, recipientUserId: u.id, kind: "test", severity: "info", title: "Recent", body: "fictional" }).returning())[0].id;
    // Old idempotency key (confirmed policy) and an old succeeded job (unconfirmed policy).
    const [ik] = await db.insert(idempotencyKeys).values({ organizationId: kit.orgId, key: randomUUID(), command: "test", createdAt: OLD, completedAt: OLD } as typeof idempotencyKeys.$inferInsert).returning();
    const [job] = await db.insert(backgroundJobs).values({ organizationId: kit.orgId, jobKind: "inventory.reconcile", status: "succeeded", payload: {}, idempotencyKey: `t:${uuidv7()}`, correlationId: uuidv7(), createdAt: OLD, updatedAt: OLD, finishedAt: OLD } as typeof backgroundJobs.$inferInsert).returning();
    const movementsBefore = (await db.select({ n: count() }).from(stockMovements))[0].n;
    const auditBefore = (await db.select({ n: count() }).from(auditEvents))[0].n;

    await expectCode(executePurgeNow(qaLead, {}, PW), "forbidden");
    await expectCode(executePurgeNow(admin, {}, "wrong"), "reauth_required");
    const key = randomUUID();
    const run = await executePurgeNow(admin, { idempotencyKey: key }, PW);
    expect(run).toMatchObject({ mode: "execute", status: "succeeded" });
    const left = (await db.select({ id: notifications.id }).from(notifications).where(inArray(notifications.id, [plain, heldExplicit, heldImplicit, critical, recent]))).map((r) => r.id);
    expect(left.sort()).toEqual([heldExplicit, heldImplicit, critical, recent].sort());
    expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.id, ik.id))).toHaveLength(0);
    expect(await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id))).toHaveLength(1);
    const n = target(run.report, "jobs_notifications/notifications");
    expect(n.outcome).toBe("deleted");
    expect(n.held).toBeGreaterThanOrEqual(2);
    expect(target(run.report, "jobs_notifications/background_jobs").outcome).toBe("report_only_unconfirmed");
    expect((await db.select({ n: count() }).from(stockMovements))[0].n).toBe(movementsBefore);
    expect((await db.select({ n: count() }).from(auditEvents))[0].n).toBeGreaterThan(auditBefore);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.purge_run.completed"), eq(auditEvents.entityId, run.id)));
    expect((ev.after as { deletedRows: number }).deletedRows).toBe(run.deletedRows);
    // Replay with the same key returns the same run and deletes nothing more.
    expect((await executePurgeNow(admin, { idempotencyKey: key }, PW)).id).toBe(run.id);
    expect((await listPurgeRuns(auditor)).map((r) => r.id)).toContain(run.id);
    await expectCode(listPurgeRuns(manager), "forbidden");
  });

  it("retention.protected_classes_never_purged (sweep): a ledger policy forced to delete in the database is reported, never acted on", async () => {
    await db.insert(retentionPolicies).values({ organizationId: kit.orgId, dataClass: "stock_ledger", target: "*", retentionDays: 1, basis: "record_date", action: "delete", effectiveFrom: "2026-01-01", isConfirmed: true, confirmedBy: owner.userId, confirmedAt: new Date() });
    const before = (await db.select({ n: count() }).from(stockMovements))[0].n;
    const run = await runRetentionSweep(owner, { mode: "execute", trigger: "manual", asOf: new Date("2030-01-01T00:00:00Z") });
    expect(target(run.report, "stock_ledger/*")).toMatchObject({ outcome: "protected", deleted: 0 });
    expect((await db.select({ n: count() }).from(stockMovements))[0].n).toBe(before);
    await db.delete(retentionPolicies).where(eq(retentionPolicies.dataClass, "stock_ledger"));
  });

  it("platform.retention_sweep job: weekly key, report-only by default (setting platform.retention.sweep_mode)", async () => {
    const sys = await systemContext(kit.orgId, platformRetentionSweepJob);
    const plain = await oldNotification(null);
    const { job } = await enqueueJob(db, sys, platformRetentionSweepJob, { asOf: "2026-10-25T03:00:00.000Z" });
    expect(job.idempotencyKey).toBe("platform.retention_sweep:2026-W43");
    const out = await runJob(job.id);
    expect(out.status).toBe("succeeded");
    const [r] = await db.select().from(purgeRuns).where(eq(purgeRuns.idempotencyKey, job.idempotencyKey));
    expect(r).toMatchObject({ mode: "dry_run", trigger: "scheduled", deletedRows: 0 });
    expect(await db.select().from(notifications).where(eq(notifications.id, plain))).toHaveLength(1);
  });
});

describe("restore drills", () => {
  it("alerts.restore_drill_overdue (US-9-04 simulated route): without a passed drill the owner, not system_admin, is reminded in-app", async () => {
    process.env.BACKUP_STATUS_SOURCE = "table";
    try {
      const now = new Date();
      const f = await evaluateAlerts(kit.orgId, now);
      const drill = f.find((x) => x.code === "restore_drill_overdue");
      expect(drill).toMatchObject({ severity: "warning", roles: ["owner_director"] });
      await deliverAlerts(kit.orgId, now);
      const got = await db.select({ to: notifications.recipientUserId }).from(notifications).where(eq(notifications.kind, "alert.restore_drill_overdue"));
      expect(got.map((g) => g.to)).toContain(owner.userId);
      expect(got.map((g) => g.to)).not.toContain(admin.userId);
      await recordRestoreDrill(db, { organizationId: kit.orgId, backupRunId: null, performedAt: now, performedBy: admin.userId, targetEnvironment: "local", durationSeconds: 5, measuredRtoSeconds: 6, dumpAgeSeconds: 10, checksumVerified: true, decryptSucceeded: true, rowCountsMatch: true, migrationsCurrent: true, reconciliationRows: 0 });
      expect((await evaluateAlerts(kit.orgId, now)).map((x) => x.code)).not.toContain("restore_drill_overdue");
    } finally {
      delete process.env.BACKUP_STATUS_SOURCE;
    }
  });

  it("restore_drill.signoff_not_performer: the script records a drill; the owner signs off; the performer and system_admin cannot", async () => {
    const d = await recordRestoreDrill(db, {
      organizationId: kit.orgId,
      backupRunId: null,
      performedAt: new Date(),
      performedBy: admin.userId,
      targetEnvironment: "local",
      durationSeconds: 42,
      measuredRtoSeconds: 60,
      dumpAgeSeconds: 3600,
      checksumVerified: true,
      decryptSucceeded: true,
      rowCountsMatch: true,
      migrationsCurrent: true,
      reconciliationRows: 0,
    }, { rtoSeconds: 4 * 3600, rpoSeconds: 24 * 3600 });
    expect(d.result).toBe("passed");
    const failed = await recordRestoreDrill(db, { organizationId: kit.orgId, backupRunId: null, performedAt: new Date(), performedBy: admin.userId, targetEnvironment: "local", durationSeconds: 1, measuredRtoSeconds: 1, dumpAgeSeconds: null, checksumVerified: false, decryptSucceeded: true, rowCountsMatch: null, migrationsCurrent: null, reconciliationRows: null });
    expect(failed.result).toBe("failed");
    await expectCode(signOffRestoreDrill(admin, { id: d.id, note: "self" }, PW), "forbidden");
    const ownerAsPerformer = await recordRestoreDrill(db, { organizationId: kit.orgId, backupRunId: null, performedAt: new Date(), performedBy: owner.userId, targetEnvironment: "local", durationSeconds: 1, measuredRtoSeconds: 1, dumpAgeSeconds: 1, checksumVerified: true, decryptSucceeded: true, rowCountsMatch: true, migrationsCurrent: true, reconciliationRows: 0 });
    await expectCode(signOffRestoreDrill(owner, { id: ownerAsPerformer.id, note: "my own" }, PW), "separation_of_duties");
    const s = await signOffRestoreDrill(owner, { id: d.id, note: "Drill witnessed (fictional)" }, PW);
    expect(s.signedOffBy).toBe(owner.userId);
    await expectCode(signOffRestoreDrill(owner, { id: d.id, note: "twice" }, PW), "conflict");
    expect((await listRestoreDrills(auditor)).map((x) => x.id)).toContain(d.id);
    await expectCode(listRestoreDrills(manager), "forbidden");
    await expect(db.update(restoreDrills).set({ signedOffBy: admin.userId, signedOffAt: new Date() }).where(eq(restoreDrills.id, d.id))).rejects.toThrow();
  });
});

describe("worker health endpoint (US-9-04, runbook §12.5)", () => {
  it("health.worker_stale_is_503: 200 with a fresh heartbeat, 503 when stale or never seen; only an age is exposed", async () => {
    const { GET } = await import("@/app/api/health/worker/route");
    await db.delete(workerHeartbeats);
    expect((await GET()).status).toBe(503);
    await db.insert(workerHeartbeats).values({ workerId: `w-${uuidv7()}`, hostname: "fictional-host", lastHeartbeatAt: new Date(), startedAt: new Date() } as typeof workerHeartbeats.$inferInsert);
    const ok = await GET();
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["heartbeatAgeSeconds", "ok", "worker"]);
    await db.update(workerHeartbeats).set({ lastHeartbeatAt: new Date(Date.now() - 3_600_000) });
    expect((await GET()).status).toBe(503);
  });
});
