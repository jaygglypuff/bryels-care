/**
 * Master search rate limit (ADR-121 known issue, ADR-125): the search action uses the scan look-up limiter
 * (`limitScanLookup`, setting `platform.rate_limits.scan_lookups_per_minute`, shared store across replicas). Over the
 * limit the records are not queried and the person gets a plain message; matching screens (menu, no database) still
 * show. An empty box never counts. The limit is per person.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitBuckets, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { masterSearchAction } from "@/app/(app)/search-actions";
import { resetTestDatabase } from "../../support/db";
import { setTestCookies } from "../../support/next-headers";
import { asUser, loadKit, type Kit } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let mgr: AuthContext;

async function signedInAs(ctx: AuthContext) {
  const { token } = await createSessionRecord({ userId: ctx.userId });
  setTestCookies({ bc_session: token });
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "platform.rate_limits")));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "platform.rate_limits", value: { api_per_minute: 600, scan_lookups_per_minute: 10, login_ip_per_minute: 20, login_ip_per_hour: 200 } });
  await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.scope, "scan_lookup"));
}, 180_000);

describe("master search rate limit", () => {
  it("allows the configured searches per minute, then answers in plain words without querying records", async () => {
    await signedInAs(wh);
    for (let i = 0; i < 3; i++) expect((await masterSearchAction("")).error).toBeUndefined(); // empty box: common screens, never counted
    const ok = [];
    for (let i = 0; i < 10; i++) ok.push(await masterSearchAction("coconut"));
    expect(ok.every((r) => !r.error)).toBe(true);
    expect(ok[0].groups.length).toBeGreaterThan(0);
    const limited = await masterSearchAction("coconut");
    expect(limited.error).toBe("Too many searches in a minute. Wait a moment, then search again.");
    expect(limited.groups).toEqual([]);
    expect(limited.exactHref).toBeNull();
    // Screens come from the menu (no database), so they still help: "count" finds the counting screen.
    expect((await masterSearchAction("count")).screens.length).toBeGreaterThan(0);
  });

  it("is per person: another user still searches", async () => {
    await signedInAs(mgr);
    const r = await masterSearchAction("coconut");
    expect(r.error).toBeUndefined();
    expect(r.groups.length).toBeGreaterThan(0);
  });
});
