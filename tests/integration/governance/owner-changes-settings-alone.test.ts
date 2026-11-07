/**
 * Owner 2026-11-07: "If you are the owner, why would you let someone approve it?" (ADR-117, ADR-088 §2) and "give me
 * an option I can edit in the settings" (ADR-126). The organization-wide owner changes a restricted or owner-only
 * setting alone (with their password) while `approvals.top_roles_self_approve` is on: it applies at once, the request
 * reads "own request" and `governance.self_approval.used` is audited. Before this, an owner-only setting changed by the
 * owner became a request that only the owner could approve and that the submitter may never approve, so a one-owner
 * company could never change it. Everyone else still needs a second person.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, settingChangeRequests, settings, users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { changeSetting } from "@/modules/governance";
import { resetTestDatabase } from "../../support/db";
import { expectCode, loadKit, type Kit } from "../../support/kit";

const TYPED = "scan.typed_code_counts_as_check"; // owner-only
const SEARCH = "scan.search_open_to_everyone"; // restricted, a second person approves
const SELF = "approvals.top_roles_self_approve";

let kit: Kit;
const ctx = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await buildContextForUser(u.id, kit.nfd.id))!;
};
async function clear(key: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, key), isNull(settings.siteId)));
  await db.delete(settingChangeRequests).where(and(eq(settingChangeRequests.organizationId, kit.orgId), eq(settingChangeRequests.key, key)));
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
}, 240_000);

afterEach(async () => {
  for (const k of [TYPED, SEARCH, SELF]) await clear(k);
});

describe("the owner changes a setting alone", () => {
  it("an owner-only setting applies at once, marked as own request and audited", async () => {
    const owner = await ctx("owner@bryels-care.test");
    const r = await changeSetting(owner, { key: TYPED, siteId: null, value: false, reason: "Scans only for checks (test)" }, "demo1234");
    expect(r.status).toBe("applied");
    expect(await getSetting(db, kit.orgId, TYPED)).toBe(false);
    const [req] = await db.select().from(settingChangeRequests).where(eq(settingChangeRequests.id, r.requestId));
    expect(req).toMatchObject({ status: "applied", requiresApproval: false, submittedBy: owner.userId, approvedBy: null });
    expect(req.approvalNote).toMatch(/own request/i);
    const evs = await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, kit.orgId), eq(auditEvents.entityNumber, TYPED)));
    expect(evs.map((e) => e.action)).toEqual(expect.arrayContaining(["platform.setting.changed", "governance.self_approval.used"]));
  });

  it("a setting that needs a second person also applies at once for the owner", async () => {
    const owner = await ctx("owner@bryels-care.test");
    const r = await changeSetting(owner, { key: SEARCH, siteId: null, value: false, reason: "Stock people only (test)" }, "demo1234");
    expect(r.status).toBe("applied");
    expect(await getSetting(db, kit.orgId, SEARCH)).toBe(false);
  });

  it("an administrator who is not the owner still sends a request for someone else to OK", async () => {
    const admin = await ctx("admin@bryels-care.test");
    const r = await changeSetting(admin, { key: SEARCH, siteId: null, value: false, reason: "Admin asks (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, SEARCH)).toBe(true);
  });

  it("a site manager still cannot change settings", async () => {
    await expectCode(changeSetting(await ctx("manager.nfd@bryels-care.test"), { key: SEARCH, siteId: null, value: false, reason: "Manager tries (test)" }, "demo1234"), "forbidden");
  });

  it("with top roles approving their own requests switched off, the owner's change waits like everyone else's", async () => {
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: SELF, value: false });
    const owner = await ctx("owner@bryels-care.test");
    const r = await changeSetting(owner, { key: SEARCH, siteId: null, value: false, reason: "Owner with self-approval off (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, SEARCH)).toBe(true);
  });
});
