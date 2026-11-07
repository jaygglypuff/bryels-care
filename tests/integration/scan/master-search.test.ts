/**
 * Master search (owner request 2026-11-08): any record number in the app is found exactly (any capitals, with or
 * without dashes) and by its last digits, across every record type of RECORD_TYPES; names by words. Each type is
 * permission- and site-checked in the service: a type the caller may not view is never queried (no rows, no counts),
 * another site's records stay hidden, and another organisation never shows anything.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";
import { transferStock } from "@/modules/inventory/movements";
import { masterSearch, RECORD_TYPES, viewableTypes, type MasterHit } from "@/modules/scan";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { asUser, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let everything: AuthContext;
let owner: AuthContext;
let warehouse: AuthContext;
let finance: AuthContext;
let financeRvs: AuthContext;
let salesRvs: AuthContext;
let otherOrg: AuthContext;

async function withPerms(email: string, perms: readonly string[], sites: SiteRef[], org = kit.orgId) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, org, u.displayName, u.email, ["custom"], new Set(perms), sites, sites[0].id);
}

const numberHits = async (ctx: AuthContext, q: string): Promise<MasterHit[]> => (await masterSearch(ctx, q)).groups.find((g) => g.key === "numbers")?.hits ?? [];
const all = async (ctx: AuthContext, q: string): Promise<MasterHit[]> => (await masterSearch(ctx, q)).groups.flatMap((g) => g.hits);

type Sample = { key: string; id: string; number: string; href: string };
const samples: Sample[] = [];
const MISSING_IN_SEED = new Set(["import_job"]); // an import job needs an uploaded file; covered by the shared query shape

/**
 * The full demo seed, with its finance and fulfilment documents (bills, invoices, payments, picks, packs…), which
 * the seed leaves out under Vitest: run it without the VITEST flag.
 */
async function resetWithDemoDocuments() {
  const url = process.env.DATABASE_URL!;
  const q = postgres(url, { max: 1, onnotice: () => {} });
  await q.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;");
  await q.end();
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url, ALLOW_DEMO_SEED: "true" };
  delete env.VITEST;
  execSync("pnpm -s tsx src/db/migrate.ts && pnpm -s tsx src/db/seed.ts", { env, stdio: "pipe" });
}

beforeAll(async () => {
  await resetWithDemoDocuments();
  kit = await loadKit();
  everything = await withPerms("owner@bryels-care.test", PERMISSIONS, [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
  financeRvs = await asUser(kit, "finance@bryels-care.test", "finance", [kit.rvs]);
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  // Another organisation holding every permission and (wrongly) this organisation's site ids: the organisation filter
  // alone must keep everything out.
  otherOrg = await withPerms("owner@bryels-care.test", PERMISSIONS, [kit.nfd, kit.rvs], randomUUID());

  // Types the seed leaves empty get one fictional record each.
  const lot = await makeLot(warehouse, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "50");
  await transferStock(warehouse, { lotId: lot.id, fromLocationId: (await loc(kit.nfd.id, "A-01")).id, toLocationId: (await loc(kit.nfd.id, "A-02")).id, qty: "10", reason: "master search test", idempotencyKey: randomUUID() });
  const [me] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
  await db.execute(sql`insert into production_plans (id, organization_id, site_id, plan_number, period_start, period_end, created_by, updated_by, status_changed_by)
    values (gen_random_uuid(), ${kit.orgId}::uuid, ${kit.nfd.id}::uuid, 'PP-2611-007', '2026-11-01', '2026-11-30', ${me.id}::uuid, ${me.id}::uuid, ${me.id}::uuid)`);
  await db.execute(sql`insert into delivery_receipts (id, organization_id, site_id, shipment_id, dr_number, status, issued_at, issued_by, created_by)
    select gen_random_uuid(), s.organization_id, s.site_id, s.id, 'DR-26-00077', 'issued', now(), ${me.id}::uuid, ${me.id}::uuid from shipments s where s.site_id = ${kit.nfd.id}::uuid order by s.created_at limit 1`);

  for (const t of RECORD_TYPES) {
    const rows = (await db.execute(
      sql.raw(`select t.id::text as id, ${t.num} as number from ${t.from} where ${t.org ?? "t.organization_id"} = '${kit.orgId}' ${t.where ? `and ${t.where}` : ""} and ${t.num} is not null order by ${t.num} desc limit 1`),
    )) as unknown as { id: string; number: string }[];
    if (rows[0]) samples.push({ key: t.key, id: rows[0].id, number: rows[0].number, href: "" });
  }
}, 400_000);

describe("master search: every record type by number", () => {
  it("the seed (plus fixtures) has a record of every type", () => {
    const covered = new Set(samples.map((s) => s.key));
    const missing = RECORD_TYPES.map((t) => t.key).filter((k) => !covered.has(k));
    expect(missing.filter((k) => !MISSING_IN_SEED.has(k))).toEqual([]);
    expect(covered.size).toBeGreaterThanOrEqual(45);
  });

  it("each record is found by its exact number, first, marked exact, linking to its own page", async () => {
    for (const s of samples) {
      const hits = await numberHits(everything, s.number);
      const mine = hits.find((h) => h.type === s.key && h.href.includes(s.key === "sku" || s.key === "delivery_receipt" || s.key === "reservation" ? "/" : s.id));
      expect(mine, `${s.key} ${s.number}`).toBeTruthy();
      expect(mine!.exact, `${s.key} ${s.number} exact`).toBe(true);
      expect(hits[0].exact, `${s.key} ${s.number}: an exact match ranks first`).toBe(true);
      expect(mine!.number).toBe(s.number);
      expect(mine!.href).toMatch(/^\/[a-z]/);
      expect(mine!.name.length).toBeGreaterThan(0);
    }
  });

  it("capitals and dashes do not matter (bill-26-00001, BILL2600001)", async () => {
    for (const s of samples) {
      const lower = s.number.toLowerCase();
      const compact = s.number.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      // A code without any digit (WI-SOAP-MIX) is found with its dashes, in any capitals, or by its name.
      for (const q of /\d/.test(s.number) ? [lower, compact] : [lower]) {
        if (q.replace(/[^a-z0-9]/g, "").length < 2) continue;
        const hits = await numberHits(everything, q);
        expect(hits.some((h) => h.type === s.key && h.number === s.number && h.exact), `${s.key} ${s.number} as "${q}"`).toBe(true);
      }
    }
  });

  it("the last digits find the record (26-00001 → BILL-26-00001 and the other -26-00001 records)", async () => {
    let tried = 0;
    for (const s of samples) {
      const parts = s.number.split("-");
      if (parts.length < 2) continue;
      const tail = parts.slice(1).join("-"); // the number without its prefix: "26-00001"
      if (!/\d/.test(tail) || tail.replace(/[^A-Za-z0-9]/g, "").length < 3) continue;
      tried += 1;
      const hits = await numberHits(everything, tail);
      expect(hits.some((h) => h.type === s.key && h.number === s.number), `${s.key} ${s.number} by "${tail}"`).toBe(true);
    }
    expect(tried).toBeGreaterThanOrEqual(35);
    const bills = await numberHits(everything, "26-00001");
    expect(bills.map((h) => h.number)).toEqual(expect.arrayContaining(["BILL-26-00001", "PO-26-00001", "SO-26-00001"]));
  });

  it("an exact number gives exactHref and opens the bill; a prefix narrows the look-up to its type", async () => {
    const r = await masterSearch(everything, "BILL-26-00001");
    const bill = samples.find((s) => s.key === "supplier_bill")!;
    expect(r.exactHref).toMatch(/^\/finance\/bills\/[0-9a-f-]{36}$/);
    expect(r.groups.map((g) => g.key)).toEqual(["numbers"]);
    expect(r.groups[0].hits.every((h) => h.type === "supplier_bill")).toBe(true);
    expect(r.groups[0].hits[0]).toMatchObject({ number: "BILL-26-00001", exact: true, icon: "money" });
    expect(r.groups[0].hits[0].name).toMatch(/^Supplier bill · /); // name first
    expect(bill).toBeTruthy();
  });

  it("is fast enough to run as you type (all types, owner, under 300 ms on the seed)", async () => {
    await masterSearch(everything, "26-0000"); // warm up
    for (const q of ["26-00001", "BILL-26-00001", "coconut", "00001"]) {
      const t0 = performance.now();
      await masterSearch(everything, q);
      expect(performance.now() - t0, q).toBeLessThan(300);
    }
  });
});

describe("master search: words", () => {
  it("names find materials, customers, suppliers and lots, name first", async () => {
    const r = await masterSearch(owner, "coconut");
    const keys = r.groups.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["items", "stock"]));
    const item = r.groups.find((g) => g.key === "items")!.hits[0];
    expect(item.name.toLowerCase()).toContain("coconut");
    expect(item.number).toMatch(/^[A-Z]/);
    const c = await masterSearch(owner, "luntian");
    expect(c.groups.find((g) => g.key === "parties")?.hits.some((h) => h.type === "customer")).toBe(true);
    expect(c.groups.find((g) => g.key === "orders")?.hits.some((h) => h.type === "sales_order")).toBe(true);
  });

  it("words never list a type the person may not view", async () => {
    const supplier = ((await db.execute(sql`select p.name from supplier_bills b join suppliers p on p.id = b.supplier_id where b.bill_number = 'BILL-26-00001'`)) as unknown as { name: string }[])[0].name;
    const word = supplier.split(" ")[0];
    const r = await masterSearch(warehouse, word);
    expect(viewableTypes(warehouse).some((x) => ["supplier_bill", "invoice"].includes(x.type.key))).toBe(false);
    expect(r.groups.flatMap((g) => g.hits).some((h) => ["supplier_bill", "invoice"].includes(h.type))).toBe(false);
    expect((await masterSearch(finance, word)).groups.find((g) => g.key === "money")?.hits.some((h) => h.type === "supplier_bill")).toBe(true);
  });
});

describe("master search: permissions, sites and organisations", () => {
  it("a warehouse user searching BILL-26-00001 gets nothing from finance (the type is not even queried)", async () => {
    expect(await all(warehouse, "BILL-26-00001")).toEqual([]);
    expect(viewableTypes(warehouse).map((x) => x.type.key)).not.toEqual(expect.arrayContaining(["supplier_bill"]));
    expect((await all(warehouse, "26-00001")).some((h) => ["money"].includes(h.icon) && h.type !== "expense_claim")).toBe(false);
    // Finance at the bill's site finds it.
    expect((await numberHits(finance, "BILL-26-00001"))[0]).toMatchObject({ number: "BILL-26-00001", exact: true });
  });

  it("another site's records stay hidden (finance at RVS only, sales at RVS only)", async () => {
    expect(await numberHits(financeRvs, "BILL-26-00001")).toEqual([]);
    const nfdOrder = ((await db.execute(sql`select order_number from sales_orders where site_id = ${kit.nfd.id}::uuid order by order_number limit 1`)) as unknown as { order_number: string }[])[0].order_number;
    expect((await numberHits(salesRvs, nfdOrder)).some((h) => h.number === nfdOrder)).toBe(false);
    expect((await numberHits(owner, nfdOrder)).some((h) => h.number === nfdOrder)).toBe(true);
  });

  it("expense claims: with only 'create', a person finds their own claims and nobody else's", async () => {
    expect(ROLE_BUNDLES.warehouse_operator.permissions).toContain("finance.expense_claim.create");
    expect((await numberHits(warehouse, "EXP-26-00002")).map((h) => h.number)).toEqual(["EXP-26-00002"]); // their own
    expect(await numberHits(warehouse, "EXP-26-00001")).toEqual([]); // the operator's claim
    expect((await numberHits(finance, "EXP-26-00001")).map((h) => h.number)).toEqual(["EXP-26-00001"]);
  });

  it("another organisation never sees anything, even with every permission and the same site ids", async () => {
    for (const s of samples) expect(await all(otherOrg, s.number), s.number).toEqual([]);
    expect(await all(otherOrg, "coconut")).toEqual([]);
    expect(await all(otherOrg, "26-00001")).toEqual([]);
  });

  it("a person with no view permission at all gets no records", async () => {
    const none = await withPerms("floor.nfd@bryels-care.test", [], [kit.nfd]);
    expect(viewableTypes(none)).toEqual([]);
    expect(await all(none, "BILL-26-00001")).toEqual([]);
    expect(await all(none, "coconut")).toEqual([]);
  });
});
