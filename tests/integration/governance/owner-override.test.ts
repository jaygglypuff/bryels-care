/**
 * ADR-073 owner override (setting `governance.owner_override`): off by default; when on, the
 * Owner/Director holds every permission and passes every same-person rule, each use audited as
 * `governance.owner_override.used`. The database same-person rules (deferred constraint triggers,
 * src/db/sql/adr073.sql) still refuse the same rows when the override was not used.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, formulaRevisions, materials, priceLists, products, settings, users, workOrders } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { toActionState } from "@/lib/errors";
import { createWorkOrder, planWorkOrder, releaseWorkOrder } from "@/modules/production";
import { whoCanDo } from "@/modules/identity";
import { createFormula, decideFormulaRevision, saveFormulaRevisionDraft, submitFormulaRevision } from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { customMigration } from "../../support/custom-sql";
import { day, loadWorld, productId, setOrgSetting, type World } from "../production/w2a-fixtures";

let w: World;
let ownerId: string;
let acs: string;

const ownerCtx = async () => (await buildContextForUser(ownerId))!;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  acs = await productId("ACS-135");
  const [u] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
  ownerId = u.id;
}, 120_000);

describe("ADR-073 owner override", () => {
  it("is off by default: the owner keeps the role's permissions and the same-person rule", async () => {
    const owner = await ownerCtx();
    expect(owner.ownerOverride).toBe(false);
    expect(owner.can("quality.disposition.approve")).toBe(false);
    expect(owner.sodBlocks(true, "x")).toBe(true);

    const wo = await createWorkOrder(owner, { productId: acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    await planWorkOrder(owner, wo.workOrderId);
    const refused = await releaseWorkOrder(owner, wo.workOrderId).catch((e) => e);
    expect(refused.code).toBe("separation_of_duties");
    // The refusal names the permission, so the screen can say who can release it.
    expect(toActionState(refused)?.needs?.permission).toBe("production.work_order.approve");
  });

  it("when on, the owner releases their own work order and the override is audited", async () => {
    await setOrgSetting(w.orgId, "governance.owner_override", true);
    const owner = await ownerCtx();
    expect(owner.ownerOverride).toBe(true);
    expect(owner.can("quality.disposition.approve")).toBe(true);

    const wo = await createWorkOrder(owner, { productId: acs, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    await planWorkOrder(owner, wo.workOrderId);
    await releaseWorkOrder(owner, wo.workOrderId);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.workOrderId));
    expect(row.status).toBe("released");
    const used = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "governance.owner_override.used"), eq(auditEvents.actorId, ownerId)));
    expect(used.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(used.map((u) => u.after))).toContain("another person with release permission");
  });

  it("when on, the owner creates, submits and approves both steps of a formula alone (database rule included)", async () => {
    const owner = await ownerCtx();
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    const [mat] = await db.select().from(materials).limit(1);
    const f = await createFormula(owner, { productId: ahl.id, code: "F-AHL-OWN", name: "Owner trial", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" });
    await saveFormulaRevisionDraft(owner, { revisionId: f.revisionId, referenceBatchSizeG: "1000", theoreticalYieldPct: "97", lines: [{ materialId: mat.id, quantityG: "1000", toleranceAbsG: "2" }] });
    await submitFormulaRevision(owner, f.revisionId);
    let r = await decideFormulaRevision(owner, { id: f.revisionId, decision: "approved", note: "Owner step 1" });
    if (r.status !== "approved") r = await decideFormulaRevision(owner, { id: f.revisionId, decision: "approved", note: "Owner step 2" });
    expect(r.status).toBe("approved");
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, f.revisionId));
    expect(rev.submittedBy).toBe(ownerId);
    expect(rev.approvedBy).toBe(ownerId);
  });

  it("does not apply to other roles, even with the switch on", async () => {
    const [mgr] = await db.select().from(users).where(eq(users.email, w.manager.email));
    const manager = (await buildContextForUser(mgr.id))!;
    expect(manager.ownerOverride).toBe(false);
    expect(manager.sodBlocks(true, "x")).toBe(true);
  });

  it("the database still refuses the same person in both columns when no override was used", async () => {
    const [pl] = await db.select().from(priceLists).limit(1);
    expect(pl).toBeTruthy();
    const err = await db
      .transaction(async (tx) => {
        await tx.update(priceLists).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(priceLists.id, pl.id));
      })
      .catch((e) => e);
    expect(String(err?.message ?? err)).toContain("price_lists_sod_ck");
    // With the transaction-local flag that audit() sets for an override, the same row is accepted (and rolled back here).
    const ok = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('bc.owner_override', 'on', true)`);
        await tx.update(priceLists).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(priceLists.id, pl.id));
        tx.rollback();
      })
      .catch((e) => e);
    expect(String(ok?.message ?? "")).not.toContain("price_lists_sod_ck");
  });

  it("who can do this: names the colleagues holding the permission at the site", async () => {
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "governance.owner_override")));
    const r = await whoCanDo(w.planner, "production.work_order.approve", w.planner.currentSiteId);
    expect(r.roles.length).toBeGreaterThan(0);
    expect(r.people.length).toBeGreaterThan(0);
    expect(r.people.some((p) => p.email === w.planner.email)).toBe(false);
    expect(await whoCanDo(w.planner, "not.a.permission", null)).toEqual({ roles: [], people: [] });
  });

  it("the custom migration matches src/db/sql/adr073.sql", () => {
    const { migration, canonical } = customMigration("adr073");
    expect(migration.trim()).toBe(canonical.trim());
  });
});
