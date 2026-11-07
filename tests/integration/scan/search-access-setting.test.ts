/**
 * ADR-126 setting `scan.search_open_to_everyone` (A-SCAN-15). On (default): every signed-in person may use the master
 * search and the Scan or search screen; each record type is still checked on the server. Off: both need
 * `inventory.lot.view` again (as before ADR-121): `masterSearch` and the search action refuse, the page shows Forbidden,
 * the top-bar launcher is hidden (`screenPreferences().canSearch`). Changing it needs a second person's approval.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { settings, users } from "@/db/schema";
import { buildContextForUser, type AuthContext } from "@/lib/auth/context";
import { getSetting, settingDefinition } from "@/lib/settings";
import { approveSettingChange, changeSetting, screenPreferences } from "@/modules/governance";
import { masterSearch, requireSearchAccess, SEARCH_NEEDS_STOCK_ACCESS, searchAllowed } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";

const KEY = "scan.search_open_to_everyone";
let kit: Kit;
let finance: AuthContext;
let warehouse: AuthContext;

const ctxOf = async (email: string) => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await buildContextForUser(u.id, kit.nfd.id))!;
};

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
}, 180_000);

afterEach(async () => {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY)));
});

describe("scan.search_open_to_everyone", () => {
  it("on (default): a person without stock access (finance) may search", async () => {
    expect(settingDefinition(KEY)).toMatchObject({ default: true, restricted: true, requiresApproval: true, group: "Scan and search" });
    expect(finance.can("inventory.lot.view")).toBe(false);
    expect(await searchAllowed(finance)).toBe(true);
    expect((await screenPreferences(finance)).canSearch).toBe(true);
    await expect(masterSearch(finance, "SITE")).resolves.toBeDefined();
  });

  it("off: finance is refused on the server (masterSearch, the page check) and the launcher is hidden; stock people still search", async () => {
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: KEY, value: false });
    expect(await searchAllowed(finance)).toBe(false);
    const e = await expectCode(masterSearch(finance, "INV-26"), "forbidden");
    expect(e.message).toBe(SEARCH_NEEDS_STOCK_ACCESS);
    await expectCode(requireSearchAccess(finance), "forbidden");
    expect((await screenPreferences(finance)).canSearch).toBe(false);
    // A person who may see stock is not affected.
    expect(await searchAllowed(warehouse)).toBe(true);
    expect((await screenPreferences(warehouse)).canSearch).toBe(true);
    await expect(masterSearch(warehouse, "A-01")).resolves.toBeDefined();
  });

  it("role escalation: finance and QA cannot change it; the change waits for a second person", async () => {
    await expectCode(changeSetting(await ctxOf("finance@bryels-care.test"), { key: KEY, siteId: null, value: false, reason: "Finance tries (test)" }, "demo1234"), "forbidden");
    await expectCode(changeSetting(await ctxOf("qa.nfd@bryels-care.test"), { key: KEY, siteId: null, value: false, reason: "QA tries (test)" }, "demo1234"), "forbidden");
    const admin = await ctxOf("admin@bryels-care.test");
    const r = await changeSetting(admin, { key: KEY, siteId: null, value: false, reason: "Stock people only (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    await expectCode(approveSettingChange(admin, r.requestId, { password: "demo1234" }), "separation_of_duties");
    await approveSettingChange(await ctxOf("owner@bryels-care.test"), r.requestId, { password: "demo1234" });
    expect(await getSetting(db, kit.orgId, KEY)).toBe(false);
  });
});
