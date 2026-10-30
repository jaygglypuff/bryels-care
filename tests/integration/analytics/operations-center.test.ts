/**
 * Operations Center (ADR-081, docs/WORKFLOW_ARCHITECTURE.md §2): the end-to-end pipeline counts come
 * from real records in the caller's sites, each stage needs its own module view permission, and the
 * active batch list never shows another site's batches (cross-site and role negatives).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, goodsReceipts, purchaseOrders, salesOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getOperationsCenter, PIPELINE_STAGE_KEYS } from "@/modules/analytics";
import { lotKpis } from "@/modules/inventory/lots";
import { resetTestDatabase } from "../../support/db";
import { asUser, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let ownerNfdOnly: AuthContext;
let operator: AuthContext;
let salesCs: AuthContext;

const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerNfdOnly = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  salesCs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
}, 240_000);

describe("Operations Center pipeline", () => {
  it("shows every stage to the owner, in pipeline order, with links", async () => {
    const oc = await getOperationsCenter(ownerNfdOnly);
    expect(oc.stages.map((s) => s.key)).toEqual([...PIPELINE_STAGE_KEYS]);
    for (const s of oc.stages) {
      expect(s.href.startsWith("/"), s.key).toBe(true);
      expect(s.count, s.key).toBeGreaterThanOrEqual(0);
      expect(s.attention, s.key).toBeLessThanOrEqual(s.count + s.attention);
    }
  });

  it("counts equal the records at the site (no illustrative numbers)", async () => {
    const site = kit.nfd.id;
    const oc = await getOperationsCenter(ownerNfdOnly);
    const stage = (k: string) => oc.stages.find((s) => s.key === k)!;
    const n = sql<number>`count(*)::int`;
    expect(stage("expected").count).toBe(
      await count(db.select({ n }).from(purchaseOrders).where(and(eq(purchaseOrders.siteId, site), inArray(purchaseOrders.status, ["approved", "sent", "partially_received"])))),
    );
    expect(stage("receiving").count).toBe(await count(db.select({ n }).from(goodsReceipts).where(and(eq(goodsReceipts.siteId, site), eq(goodsReceipts.status, "draft")))));
    expect(stage("production").count).toBe(
      await count(db.select({ n }).from(batches).where(and(eq(batches.siteId, site), inArray(batches.status, ["planned", "materials_staged", "in_process"])))),
    );
    expect(stage("qc").count).toBe(await count(db.select({ n }).from(batches).where(and(eq(batches.siteId, site), inArray(batches.status, ["awaiting_qc", "quarantined"])))));
    expect(stage("dispatch").count).toBe(
      await count(db.select({ n }).from(salesOrders).where(and(eq(salesOrders.siteId, site), inArray(salesOrders.status, ["confirmed", "allocated", "picking", "packed", "partially_shipped"])))),
    );
    // parts add up to the stage count
    for (const s of oc.stages) expect(s.parts.reduce((a, p) => a + p.n, 0), s.key).toBe(s.count);
  });

  it("a new quarantined material lot shows under Awaiting inspection, a released one under Raw materials available", async () => {
    const before = await getOperationsCenter(ownerNfdOnly);
    const at = (oc: typeof before, k: string) => oc.stages.find((s) => s.key === k)!.count;
    const shelf = await loc(kit.nfd.id, "NFD-RM-A1").catch(async () => (await db.query.locations.findFirst({ where: (l, { and, eq }) => and(eq(l.siteId, kit.nfd.id), eq(l.kind, "storage")) }))!);
    await makeLot(ownerNfdOnly, kit.nfd.id, shelf.id, "1000", { status: "quarantine" });
    await makeLot(ownerNfdOnly, kit.nfd.id, shelf.id, "1000", { status: "released" });
    const after = await getOperationsCenter(ownerNfdOnly);
    expect(at(after, "inspection")).toBe(at(before, "inspection") + 1);
    expect(at(after, "raw_available")).toBe(at(before, "raw_available") + 1);
  });

  it("never counts or lists another site's records (cross-site negative)", async () => {
    const both = await getOperationsCenter(owner, { all: true });
    const nfd = await getOperationsCenter(ownerNfdOnly, { all: true });
    expect(nfd.scope.siteIds).toEqual([kit.nfd.id]);
    expect(nfd.batches.every((b) => b.siteCode === "NFD")).toBe(true);
    const rvsBatches = await count(db.select({ n: sql<number>`count(*)::int` }).from(batches).where(and(eq(batches.siteId, kit.rvs.id), inArray(batches.status, ["planned", "materials_staged", "in_process", "awaiting_qc", "quarantined"]))));
    expect(both.batches.length).toBe(Math.min(nfd.batches.length + rvsBatches, 50));
  });

  it("stages follow module permissions (role negatives)", async () => {
    const ops = await getOperationsCenter(operator);
    expect(ops.stages.map((s) => s.key)).not.toContain("expected"); // operators do not see purchase orders
    expect(ops.stages.map((s) => s.key)).not.toContain("dispatch");
    const sales = await getOperationsCenter(salesCs);
    expect(sales.stages.map((s) => s.key)).toContain("dispatch");
    expect(sales.stages.map((s) => s.key)).not.toContain("receiving");
    expect(sales.batches.length === 0 || salesCs.can("production.batch.view") || salesCs.can("production.work_order.view")).toBe(true);
  });

  it("stock tab warning cards split by kind: materials + products = all stock; materials agree with the pipeline", async () => {
    const [all, mat, prod] = await Promise.all([lotKpis(ownerNfdOnly), lotKpis(ownerNfdOnly, { kind: "material" }), lotKpis(ownerNfdOnly, { kind: "product" })]);
    for (const k of ["quarantined", "onHold", "expiring", "expired"] as const) expect(mat[k] + prod[k], k).toBe(all[k]);
    const oc = await getOperationsCenter(ownerNfdOnly);
    const inspection = oc.stages.find((s) => s.key === "inspection")!;
    expect(inspection.count).toBe(mat.quarantined);
    expect(inspection.attention).toBe(mat.onHold);
  });
});
