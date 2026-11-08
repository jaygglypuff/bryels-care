/**
 * Round 5 search (ADR-129; A report B14, B report "Dino" found nothing, C report #15 "4", "SO 4", "order 4"):
 * people by name, short record numbers ending with the typed number, record types that are noise in a partial search,
 * and the order of "Records by number" (a batch before a QA test). Every look-up stays inside the caller's permission,
 * sites and organisation: a site manager never finds another site's people or records.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { roles, userSiteAssignments, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { masterSearch, type MasterHit } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { asUser, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let managerNfd: AuthContext;
let operator: AuthContext;

const all = async (ctx: AuthContext, q: string): Promise<MasterHit[]> => (await masterSearch(ctx, q)).groups.flatMap((g) => g.hits);
const people = async (ctx: AuthContext, q: string) => (await masterSearch(ctx, q)).groups.find((g) => g.key === "people")?.hits ?? [];
const numbers = async (ctx: AuthContext, q: string) => (await masterSearch(ctx, q)).groups.find((g) => g.key === "numbers")?.hits ?? [];

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  managerNfd = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  // A person who works only at the other site (cross-site negative).
  const [u] = await db.insert(users).values({ organizationId: kit.orgId, email: "rico.rvs@bryels-care.test", displayName: "Rico Zamora (fictional)", passwordHash: "!" }).returning();
  const [op] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, "production_operator")));
  await db.insert(userSiteAssignments).values({ userId: u.id, roleId: op.id, siteId: kit.rvs.id });
}, 180_000);

describe("people by name", () => {
  it("the owner finds Dino by his first name, with a link to his page", async () => {
    const hits = await people(owner, "Dino");
    expect(hits.map((h) => h.name)).toContain("Dino Reyes");
    expect(hits.find((h) => h.name === "Dino Reyes")!.href).toMatch(/^\/admin\/users\/[0-9a-f-]{36}$/);
  });

  it("a site manager finds the people of his site, never a person who works only at another site", async () => {
    expect((await people(managerNfd, "Rhea")).map((h) => h.name)).toContain("Rhea Mendoza");
    expect((await people(managerNfd, "Rico")).map((h) => h.name)).not.toContain("Rico Zamora (fictional)");
    expect((await people(owner, "Rico")).map((h) => h.name)).toContain("Rico Zamora (fictional)");
  });

  it("people without the permission to view people find nobody", async () => {
    expect(await people(operator, "Dino")).toEqual([]);
  });
});

describe("short numbers", () => {
  it("'4', 'SO 4' and 'order 4' find records whose number ends with 4", async () => {
    const four = await numbers(owner, "4");
    expect(four.length).toBeGreaterThan(0);
    for (const h of four) expect(h.number, h.number).toMatch(/(^|[^0-9])0*4$/);
    const so = await numbers(owner, "SO 4");
    for (const h of so) expect(h.type).toBe("sales_order");
    const order = await numbers(owner, "order 4");
    for (const h of order) expect(["sales_order", "purchase_order", "work_order"]).toContain(h.type);
  });

  it("'0003' lists a batch before a quality test, and never the noise types", async () => {
    const hits = await numbers(owner, "0003");
    const types = hits.map((h) => h.type);
    for (const noise of ["reservation", "movement", "document"]) expect(types).not.toContain(noise);
    const b = types.indexOf("batch");
    const ins = types.indexOf("inspection");
    if (b >= 0 && ins >= 0) expect(b).toBeLessThan(ins);
    for (const h of hits) expect(h.exact).toBe(false); // a short number is never "this number": Enter does not open it
  });

  it("a short number stays inside the caller's sites", async () => {
    const mine = await all(managerNfd, "1");
    const everyone = await all(owner, "1");
    expect(everyone.length).toBeGreaterThanOrEqual(mine.length);
    // Nothing a site manager finds comes from the other site (site records carry no site code for one-site people).
    const rvsOnly = everyone.filter((h) => h.detail.includes(kit.rvs.code));
    for (const h of rvsOnly) expect(mine.map((m) => m.href)).not.toContain(h.href);
  });
});
