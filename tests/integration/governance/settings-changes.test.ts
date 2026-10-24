/**
 * US-1-14 AC1 (S1-03) and US-1-19 AC3: setting change requests with separation of duties,
 * direct changes with `platform.setting.changed`, re-authentication, version history
 * (settings.versioned), stale-request conflict, cross-site and role-escalation negatives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, settingChangeRequests, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { approveSettingChange, cancelSettingChange, changeSetting, listSettingChangeRequests, listSettingsForAdmin, rejectSettingChange } from "@/modules/governance";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let admin: AuthContext;
let admin2: AuthContext;
let manager: AuthContext;
let auditor: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  admin2 = await asUser(kit, "admin2@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
});

describe("S1-03 setting change requests", () => {
  it("authz.sod.approve_own: the submitter cannot approve (409 + identity.authorization.denied); a site manager has no grant (403)", async () => {
    const r = await changeSetting(admin, { key: "inventory.count.recount_threshold_pct", siteId: null, value: 3, reason: "Tighter recounts (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, "inventory.count.recount_threshold_pct")).toBe(2);
    await expectCode(approveSettingChange(admin, r.requestId, { password: "demo1234" }), "separation_of_duties");
    const [denied] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.authorization.denied"), eq(auditEvents.entityId, r.requestId)));
    expect(denied?.actorId).toBe(admin.userId);
    await expectCode(approveSettingChange(manager, r.requestId, { password: "demo1234" }), "forbidden");
    await expectCode(changeSetting(manager, { key: "platform.export.max_rows", siteId: null, value: 10, reason: "no grant" }, "demo1234"), "forbidden");
    await expectCode(changeSetting(auditor, { key: "platform.export.max_rows", siteId: null, value: 10, reason: "no grant" }, "demo1234"), "forbidden");

    // authz.sod.other_approver_ok: a second system_admin approves → applied in one transaction.
    const ok = await approveSettingChange(admin2, r.requestId, { password: "demo1234", note: "Agreed" });
    expect(ok.status).toBe("applied");
    expect(await getSetting(db, kit.orgId, "inventory.count.recount_threshold_pct")).toBe(3);
    const [row] = await db.select().from(settingChangeRequests).where(eq(settingChangeRequests.id, r.requestId));
    expect(row).toMatchObject({ status: "applied", approvedBy: admin2.userId });
    const [dec] = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "setting_change_request"), eq(approvalDecisions.recordId, r.requestId)));
    expect(dec.decidedBy).toBe(admin2.userId);
    const actions = (await db.select({ a: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, r.requestId))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(["platform.setting_change_request.submitted", "platform.setting_change_request.approved", "platform.setting.changed", "platform.approval_rule.evaluated"]));
    expect(ok.auditEventId).toBeTruthy();
  });

  it("the owner can approve; a stale request (setting changed meanwhile) is a conflict", async () => {
    const a = await changeSetting(admin, { key: "inventory.count.auto_approve_variance_pct", siteId: null, value: 1, reason: "Small variances auto (test)" }, "demo1234");
    // A database CHECK is the backstop for SoD.
    await expect(db.update(settingChangeRequests).set({ approvedBy: admin.userId }).where(eq(settingChangeRequests.id, a.requestId))).rejects.toThrow();
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "inventory.count.auto_approve_variance_pct", value: 0.5 });
    await expectCode(approveSettingChange(owner, a.requestId, { password: "demo1234" }), "conflict");
    await rejectSettingChange(owner, a.requestId, "Stale, resubmit");
    await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "inventory.count.auto_approve_variance_pct")));
    const b = await changeSetting(admin, { key: "inventory.count.auto_approve_variance_pct", siteId: null, value: 1, reason: "Resubmitted (test)" }, "demo1234");
    await expectCode(changeSetting(admin2, { key: "inventory.count.auto_approve_variance_pct", siteId: null, value: 1.5, reason: "Second pending (test)" }, "demo1234"), "conflict");
    expect((await approveSettingChange(owner, b.requestId, { password: "demo1234" })).status).toBe("applied");
    expect(await getSetting(db, kit.orgId, "inventory.count.auto_approve_variance_pct")).toBe(1);
  });

  it("only the submitter cancels; rejecting your own request is refused", async () => {
    const r = await changeSetting(admin, { key: "approvals.sod.quote", siteId: null, value: false, reason: "Small team (test)" }, "demo1234");
    await expectCode(rejectSettingChange(admin, r.requestId, "own"), "separation_of_duties");
    await expectCode(cancelSettingChange(admin2, r.requestId), "forbidden");
    await cancelSettingChange(admin, r.requestId);
    await expectCode(approveSettingChange(admin2, r.requestId, { password: "demo1234" }), "state");
  });
});

describe("direct changes, re-authentication, history", () => {
  it("a key without requires_approval is written at once with platform.setting.changed before/after", async () => {
    await expectCode(changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: 1000, reason: "Smaller exports (test)" }, null), "reauth_required");
    await expectCode(changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: 1000, reason: "Smaller exports (test)" }, "nope"), "reauth_required");
    await expectCode(changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: "lots", reason: "Bad value (test)" }, "demo1234"), "validation");
    const r = await changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: 1000, reason: "Smaller exports (test)" }, "demo1234");
    expect(r.status).toBe("applied");
    expect(await getSetting(db, kit.orgId, "platform.export.max_rows")).toBe(1000);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.setting.changed"), eq(auditEvents.entityNumber, "platform.export.max_rows"))).orderBy(desc(auditEvents.occurredAt)).limit(1);
    expect(ev.before).toEqual({ value: null });
    expect(ev.after).toEqual({ value: 1000 });
    await expectCode(changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: 1000, reason: "Same again (test)" }, "demo1234"), "validation");
    // Back to the default by removing the stored row.
    await changeSetting(admin, { key: "platform.export.max_rows", siteId: null, value: null, reason: "Back to default (test)" }, "demo1234");
    expect(await getSetting(db, kit.orgId, "platform.export.max_rows")).toBe(50_000);
  });

  it("settings.versioned: every applied change keeps proposer, approver and reason", async () => {
    const hist = await listSettingChangeRequests(admin, { key: "platform.export.max_rows" });
    expect(hist.map((h) => h.status)).toEqual(["applied", "applied"]);
    expect(hist[1]).toMatchObject({ newValue: 1000, reason: "Smaller exports (test)", submittedBy: admin.userId });
  });

  it("site-scope values: only keys with site scope, only at the user's sites (authz.cross_site)", async () => {
    await expectCode(changeSetting(admin, { key: "platform.export.max_rows", siteId: kit.nfd.id, value: 5, reason: "Site value (test)" }, "demo1234"), "validation");
    const adminNfdOnly = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd]);
    await expectCode(changeSetting(adminNfdOnly, { key: "inventory.reservation.ttl_hours", siteId: kit.rvs.id, value: 24, reason: "Other site (test)" }, "demo1234"), "not_found");
    await changeSetting(adminNfdOnly, { key: "inventory.reservation.ttl_hours", siteId: kit.nfd.id, value: 24, reason: "NFD shorter holds (test)" }, "demo1234");
    expect(await getSetting(db, kit.orgId, "inventory.reservation.ttl_hours", kit.nfd.id)).toBe(24);
    expect(await getSetting(db, kit.orgId, "inventory.reservation.ttl_hours", kit.rvs.id)).toBe(72);
    const list = await listSettingsForAdmin(adminNfdOnly);
    expect(list.rows.find((r) => r.key === "inventory.reservation.ttl_hours")?.siteValues).toEqual([{ siteId: kit.nfd.id, siteCode: "NFD", value: 24 }]);
  });

  it("platform.settings_admin_restricted: the owner reads and approves but does not administer settings", async () => {
    expect(owner.can("platform.settings.approve")).toBe(true);
    expect(owner.can("platform.settings.admin")).toBe(false);
    expect(manager.can("platform.settings.view")).toBe(false);
    await expectCode(listSettingsForAdmin(manager), "forbidden");
  });
});
