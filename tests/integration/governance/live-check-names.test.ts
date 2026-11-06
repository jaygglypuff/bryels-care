/**
 * Live check of the small demo, 2026-11-06, finding 1: hand-offs name the next people (ADR-109 nextActors).
 * - A lot waiting for QA names the QA people who decide, for every viewer; a QA person who may decide reads "So can …".
 * - A sent purchase order names who receives it and when ("receives it when it arrives on 11 Nov").
 * - A refusal names people who can DO the work (QA for a QA check), not people who may only look.
 * Cross-site negatives: people assigned only to the other site are never named, and cannot open the lot.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { materials, purchaseOrders, roles, suppliers, userSiteAssignments, users } from "@/db/schema";
import { doingPermission } from "@/app/(app)/forbidden-words";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextActorsSentence } from "@/lib/next-actors-words";
import { PERMISSIONS } from "@/lib/permissions";
import { whoCanDo } from "@/modules/identity";
import { createPurchaseOrder, decidePurchaseOrder, procurementNextActors, sendPurchaseOrder, submitPurchaseOrder } from "@/modules/procurement";
import { getLotDisposition } from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
const uid = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;
const ctx = async (email: string, site?: string): Promise<AuthContext> => (await buildContextForUser(await uid(email), site ?? kit.nfd.id))!;
const names = (n: { people: { name: string }[] } | null | undefined) => (n?.people ?? []).map((p) => p.name);
const RVS_QA = "qa.rvs-only@bryels-care.test";

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  // A QA person at the other site only (cross-site negative).
  await db.insert(users).values({ organizationId: kit.orgId, email: RVS_QA, displayName: "Rina Santos (fictional)", passwordHash: "!" });
  const [qa] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, "qa_qc")));
  await db.insert(userSiteAssignments).values({ userId: await uid(RVS_QA), roleId: qa.id, siteId: kit.rvs.id });
}, 180_000);

describe("a lot waiting for QA", () => {
  it("names the QA people who decide for every viewer, never another site's QA, and the QA viewer reads who else can", async () => {
    const manager = await ctx("manager.nfd@bryels-care.test");
    const lot = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "100", { status: "quarantine" });

    const owner = await ctx("owner@bryels-care.test");
    const asOwner = await getLotDisposition(owner, lot.id);
    expect(names(asOwner.deciders)).toEqual(expect.arrayContaining(["Nina Quiambao", "Teresa Ocampo"]));
    expect(names(asOwner.deciders)).not.toContain("Rina Santos (fictional)");
    expect(asOwner.deciders?.people.every((p) => p.role === "QA")).toBe(true);

    const warehouse = await ctx("warehouse.nfd@bryels-care.test");
    const asWarehouse = await getLotDisposition(warehouse, lot.id).catch((e) => e);
    if (!(asWarehouse instanceof Error)) {
      expect(asWarehouse.deciders?.viewer.can).toBe(false);
      expect(nextActorsSentence(asWarehouse.deciders!)).toMatch(/^Next: (Nina|Teresa) \(QA\) or (Nina|Teresa) \(QA\) checks this lot and says OK or not OK/);
    }

    const nina = await ctx("qa.nfd@bryels-care.test");
    const asNina = await getLotDisposition(nina, lot.id);
    expect(asNina.deciders?.viewer.can).toBe(true);
    expect(names(asNina.deciders)).toContain("Teresa Ocampo");
    expect(names(asNina.deciders)).not.toContain("Nina Quiambao");
    expect(nextActorsSentence(asNina.deciders!)).toContain("So can Teresa (QA)");
  });

  it("another site's QA person cannot open the lot", async () => {
    const manager = await ctx("manager.nfd@bryels-care.test");
    const lot = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "50", { status: "quarantine" });
    const rvsQa = await ctx(RVS_QA, kit.rvs.id);
    const e = await getLotDisposition(rvsQa, lot.id).catch((x) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe("not_found");
  });

  it("a lot already OK names nobody as QA decider", async () => {
    const manager = await ctx("manager.nfd@bryels-care.test");
    const lot = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "10");
    expect((await getLotDisposition(await ctx("owner@bryels-care.test"), lot.id)).deciders).toBeNull();
  });
});

describe("a sent purchase order", () => {
  it("names who receives it and when; never the other site's warehouse", async () => {
    const buyer = await ctx("procurement@bryels-care.test");
    const [s] = await db.select().from(suppliers).where(sql`${suppliers.name} like 'Laguna Oleo Supply%'`);
    const [m] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    const po = await createPurchaseOrder(buyer, { supplierId: s.id, lines: [{ materialId: m.id, qty: "400", uom: "kg" }] });
    await submitPurchaseOrder(buyer, { purchaseOrderId: po.purchaseOrderId });
    await decidePurchaseOrder(await ctx("manager.nfd@bryels-care.test"), { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    if ((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId)))[0].status === "submitted")
      await decidePurchaseOrder(await ctx("owner@bryels-care.test"), { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    await sendPurchaseOrder(buyer, { purchaseOrderId: po.purchaseOrderId, email: false, idempotencyKey: `t-${Date.now()}` });
    await db.update(purchaseOrders).set({ expectedDate: "2026-11-11", promisedDate: null }).where(eq(purchaseOrders.id, po.purchaseOrderId));

    const next = await procurementNextActors(buyer, "purchase_order", po.purchaseOrderId);
    expect(next?.kind).toBe("delivery_coming");
    expect(names(next)).toContain("Lito Pascual");
    expect(names(next)).not.toContain("Carlo Bautista");
    expect(nextActorsSentence(next!)).toMatch(/^Next: Lito \(warehouse\).* receives it when it arrives on 11 Nov — they will see it on Receive a delivery\.$/);

    // The warehouse person reads "You can …" and who else can.
    const asLito = await procurementNextActors(await ctx("warehouse.nfd@bryels-care.test"), "purchase_order", po.purchaseOrderId);
    expect(asLito?.viewer.can).toBe(true);
    expect(names(asLito)).not.toContain("Lito Pascual");
  });
});

describe("refusals", () => {
  it("a sales person refused a QA check is pointed to the QA people, not to people who may only look", async () => {
    const sales = await ctx("sales@bryels-care.test");
    const doers = await whoCanDo(sales, doingPermission("quality.disposition.view", PERMISSIONS), kit.nfd.id);
    const lookers = await whoCanDo(sales, "quality.disposition.view", kit.nfd.id);
    expect(doers.people.map((p) => p.name)).toEqual(expect.arrayContaining(["Nina Quiambao", "Teresa Ocampo"]));
    expect(doers.people.map((p) => p.name)).not.toContain("Rina Santos (fictional)");
    // Viewers include people who cannot decide (the reason for the fix).
    expect(lookers.people.length).toBeGreaterThan(doers.people.length);
  });
});
