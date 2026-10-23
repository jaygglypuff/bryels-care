/**
 * US-2-03 background jobs (docs/architecture.md §8): jobs.dead_letter, jobs.payload_validated,
 * jobs.context_rebuilt, audit.job_actor, retry/cancel controls with audit, idempotent retry,
 * registry rules and authorization negatives. Tests call the runner directly (no pg-boss), as the
 * registry rules prescribe (docs/testing.md §2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, backgroundJobs, notifications, roles, stockMovements, userSiteAssignments, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import { createJobRegistry, defineJob } from "@/modules/platform/job-definition";
import { JOB_DEFINITIONS } from "@/modules/platform/job-handlers";
import { cancelJob, enqueueJob, getJob, listJobs, retryJob, runJob } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot, onHand } from "../../support/kit";

const failingJob = defineJob<{ n: number }>({
  code: "platform.test_failing",
  title: "Always fails",
  description: "test",
  payload: z.object({ n: z.number().int() }).strict(),
  keyTuple: (p) => [p.n],
  run: async () => {
    throw new Error("simulated outage");
  },
});

let postAttempts = 0;
const postingJob = defineJob<{ lotId: string; locationId: string; qty: string }>({
  code: "platform.test_posting",
  title: "Posts then fails once",
  description: "test",
  payload: z.object({ lotId: z.uuid(), locationId: z.uuid(), qty: z.string() }).strict(),
  keyTuple: (p) => [p.lotId, p.qty],
  run: async (run, p) => {
    await db.transaction((tx) => postMovement(tx, run.ctx, { movementType: "consumption", lotId: p.lotId, fromLocationId: p.locationId, qtyBase: p.qty, idempotencyKey: `${run.idempotencyKey}:post` }));
    postAttempts += 1;
    if (postAttempts === 1) throw new Error("crash after the posting committed");
    return { posted: true };
  },
});

const whoAmIJob = defineJob<{ tag: string }>({
  code: "platform.test_whoami",
  title: "Reports its context",
  description: "test",
  payload: z.object({ tag: z.string().min(1) }).strict(),
  keyTuple: (p) => [p.tag],
  run: async (run) => {
    await audit(db, run.ctx, { action: "platform.test_job.ran", entityType: "background_job", entityId: run.job.id, siteId: null });
    return { userId: run.ctx.userId, actor: run.ctx.actorLabel, canPostMoves: run.ctx.can("inventory.movement.post"), sites: run.ctx.allowedSiteIds.length };
  },
});

const registry = createJobRegistry([...JOB_DEFINITIONS, failingJob, postingJob, whoAmIJob]);

let kit: Kit;
let admin: AuthContext;
let manager: AuthContext;
let wh: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
});

describe("jobs.dead_letter", () => {
  it("a job that fails 5 times is dead-lettered, raises a critical notification to system_admin and shows on the Jobs card", async () => {
    const { job } = await enqueueJob(db, manager, failingJob, { n: 1 }, { registry, siteId: kit.nfd.id });
    expect(job.maxAttempts).toBe(5);
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await runJob(job.id, { registry }));
    expect(outcomes.slice(0, 4).map((o) => o.status)).toEqual(["retry", "retry", "retry", "retry"]);
    expect(outcomes[4]).toMatchObject({ status: "failed", deadLettered: true });
    const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(5);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.errorMessage).toContain("simulated outage");
    const [adminUser] = await db.select().from(users).where(eq(users.email, "admin@bryels-care.test"));
    const n = await db.select().from(notifications).where(and(eq(notifications.entityId, job.id), eq(notifications.recipientUserId, adminUser.id)));
    expect(n).toHaveLength(1);
    expect(n[0].severity).toBe("critical");
    const card = await listJobs(admin, { status: "failed" });
    const item = card.find((j) => j.id === job.id)!;
    expect(item.attempts).toBe(5);
    expect(item.correlationId).toBeTruthy();
    expect(item.payloadSummary).toEqual({ n: 1 });
    // A sixth delivery does nothing.
    expect(await runJob(job.id, { registry })).toMatchObject({ status: "skipped" });
  });

  it("payload summaries never show secret-like keys", async () => {
    const secretJob = defineJob<{ token: string; note: string }>({
      code: "platform.test_secret",
      title: "secret",
      description: "test",
      payload: z.object({ token: z.string(), note: z.string() }).strict(),
      keyTuple: (p) => [p.note],
      run: async () => ({}),
    });
    const reg = createJobRegistry([...JOB_DEFINITIONS, secretJob]);
    const { job } = await enqueueJob(db, admin, secretJob, { token: "abc123", note: "hello" }, { registry: reg });
    const item = (await listJobs(admin)).find((j) => j.id === job.id)!;
    expect(item.payloadSummary).toEqual({ token: "•••", note: "hello" });
  });
});

describe("jobs.payload_validated", () => {
  it("an invalid payload is refused at enqueue", async () => {
    await expectCode(enqueueJob(db, admin, failingJob, { n: "x" } as never, { registry }), "validation");
    await expectCode(enqueueJob(db, admin, whoAmIJob, { tag: "a", extra: 1 } as never, { registry }), "validation");
  });

  it("a payload changed after enqueue is validated again before execution and the job fails without running", async () => {
    const { job } = await enqueueJob(db, admin, whoAmIJob, { tag: "tamper" }, { registry });
    await db.update(backgroundJobs).set({ payload: { tag: "" } }).where(eq(backgroundJobs.id, job.id));
    const out = await runJob(job.id, { registry });
    expect(out).toMatchObject({ status: "failed" });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, job.id), eq(auditEvents.action, "platform.test_job.ran")))).toHaveLength(0);
  });

  it("enqueuing a code that is not registered fails", async () => {
    await expectCode(enqueueJob(db, admin, failingJob, { n: 2 }), "validation");
  });
});

describe("jobs.context_rebuilt and audit.job_actor", () => {
  it("runs as system:<code> on behalf of the requester with the requester's current access", async () => {
    const { job } = await enqueueJob(db, wh, whoAmIJob, { tag: "ctx-1" }, { registry, siteId: kit.nfd.id });
    const out = await runJob(job.id, { registry });
    expect(out.status).toBe("succeeded");
    const result = (out as { result: { userId: string; actor: string; canPostMoves: boolean } }).result;
    expect(result.userId).toBe(wh.userId);
    expect(result.actor).toBe("system:platform.test_whoami");
    expect(result.canPostMoves).toBe(true);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, job.id), eq(auditEvents.action, "platform.test_job.ran")));
    expect(ev.actorId).toBeNull();
    expect(ev.actorLabel).toBe("system:platform.test_whoami");
    expect(ev.onBehalfOf).toBe(wh.userId);
    expect(ev.correlationId).toBe(job.correlationId);
  });

  it("a requester who lost access since enqueue: the job fails and does not run", async () => {
    const { job } = await enqueueJob(db, wh, whoAmIJob, { tag: "ctx-2" }, { registry, siteId: kit.nfd.id });
    await db.update(users).set({ status: "deactivated" }).where(eq(users.id, wh.userId));
    try {
      const out = await runJob(job.id, { registry });
      expect(out).toMatchObject({ status: "failed" });
    } finally {
      await db.update(users).set({ status: "active" }).where(eq(users.id, wh.userId));
    }
  });

  it("permissions are read at run time, not copied from the enqueue time", async () => {
    // The warehouse user has a single site assignment; move it to a role without inventory.movement.post.
    const [whRole] = await db.select().from(roles).where(eq(roles.code, "warehouse_operator"));
    const [salesRole] = await db.select().from(roles).where(eq(roles.code, "sales_cs"));
    const { job } = await enqueueJob(db, wh, whoAmIJob, { tag: "ctx-3" }, { registry, siteId: kit.nfd.id });
    await db.update(userSiteAssignments).set({ roleId: salesRole.id }).where(and(eq(userSiteAssignments.userId, wh.userId), eq(userSiteAssignments.roleId, whRole.id)));
    try {
      const out = await runJob(job.id, { registry });
      expect((out as { result: { canPostMoves: boolean } }).result.canPostMoves).toBe(false);
    } finally {
      await db.update(userSiteAssignments).set({ roleId: whRole.id }).where(and(eq(userSiteAssignments.userId, wh.userId), eq(userSiteAssignments.roleId, salesRole.id)));
    }
  });
});

describe("retry and cancel (platform.job.admin)", () => {
  it("retried jobs never duplicate a posting (idempotency key per job); retry is audited", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
    const { job } = await enqueueJob(db, wh, postingJob, { lotId: lot.id, locationId: a01.id, qty: "7" }, { registry, siteId: kit.nfd.id });
    expect((await runJob(job.id, { registry })).status).toBe("retry");
    // An operator decides to cancel and later retry it by hand.
    await cancelJob(admin, job.id, "pause");
    const retried = await retryJob(admin, job.id, "outage over");
    expect(retried.status).toBe("queued");
    expect((await runJob(job.id, { registry })).status).toBe("succeeded");
    expect(await onHand(lot.id, a01.id)).toBe("93");
    const posted = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "consumption")));
    expect(posted).toHaveLength(1);
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.entityId, job.id));
    expect(ev.map((e) => e.action).sort()).toEqual(["platform.background_job.cancelled", "platform.background_job.retried"]);
    expect(ev.find((e) => e.action === "platform.background_job.retried")!.reason).toBe("outage over");
  });

  it("only failed or cancelled jobs can be retried; running/succeeded jobs cannot be cancelled", async () => {
    const { job } = await enqueueJob(db, admin, whoAmIJob, { tag: "state-1" }, { registry });
    await expectCode(retryJob(admin, job.id), "state");
    await runJob(job.id, { registry });
    await expectCode(cancelJob(admin, job.id), "state");
  });

  it("authz.role_escalation.missing_permission: a site manager (platform.job.view only) cannot retry or cancel", async () => {
    const { job } = await enqueueJob(db, manager, failingJob, { n: 99 }, { registry, siteId: kit.nfd.id });
    await expectCode(cancelJob(manager, job.id), "forbidden");
    await expectCode(retryJob(wh, job.id), "forbidden");
    await expectCode(listJobs(wh), "forbidden");
  });

  it("authz.cross_site.url: a job of another site is not visible and not actionable", async () => {
    const managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
    const adminRvs = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.rvs]);
    const { job } = await enqueueJob(db, manager, whoAmIJob, { tag: "site-nfd" }, { registry, siteId: kit.nfd.id });
    expect((await listJobs(managerRvs)).some((j) => j.id === job.id)).toBe(false);
    await expectCode(getJob(managerRvs, job.id), "not_found");
    await expectCode(cancelJob(adminRvs, job.id), "not_found");
  });

  it("a duplicate enqueue with the same key returns the existing row", async () => {
    const a = await enqueueJob(db, admin, whoAmIJob, { tag: "dup" }, { registry });
    const b = await enqueueJob(db, admin, whoAmIJob, { tag: "dup" }, { registry });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(a.job.idempotencyKey).toBe("platform.test_whoami:dup");
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, "platform.test_whoami:dup"));
    expect(n.n).toBe(1);
  });
});
