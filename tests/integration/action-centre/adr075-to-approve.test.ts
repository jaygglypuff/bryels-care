/**
 * ADR-075 "To approve": one list of the approvals waiting for the signed-in user, with who asked
 * and when; visibility is the approval permission at the item's site (role and cross-site
 * negatives); with the owner override (ADR-073) the owner sees everything.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materials, users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { listMyApprovals, myApprovalCount, refreshActionItems } from "@/modules/action-centre";
import { createPurchaseRequest, submitPurchaseRequest } from "@/modules/procurement";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, type Kit, loadKit } from "../../support/kit";
import { setOrgSetting } from "../production/w2a-fixtures";

let kit: Kit;
let requestId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  const [m] = await db.select().from(materials).where(eq(materials.code, "PKG-0101"));
  const pr = await createPurchaseRequest(wh, { lines: [{ materialId: m.id, qty: "200", uom: "pcs" }], idempotencyKey: "adr075-approvals-pr" });
  await submitPurchaseRequest(wh, { requestId: pr.requestId });
  requestId = pr.requestId;
  await refreshActionItems(kit.orgId);
}, 180_000);

describe("ADR-075 To approve", () => {
  it("lists the request for the site manager with who asked and when", async () => {
    const manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    const rows = await listMyApprovals(manager);
    const row = rows.find((r) => r.entityId === requestId);
    expect(row).toBeTruthy();
    expect(row!.kind).toBe("approval.purchase_request");
    const [wh] = await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test"));
    expect(row!.requestedBy).toMatchObject({ id: wh.id, name: wh.displayName });
    expect(row!.requestedBy.at).toBeInstanceOf(Date);
    expect(row!.ownRequest).toBe(false);
    expect(row!.link).toBe(`/procurement/requests/${requestId}`);
    expect(await myApprovalCount(manager)).toBeGreaterThanOrEqual(1);
  });

  it("is not shown to someone without the approve permission, nor at another site", async () => {
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    expect((await listMyApprovals(wh)).some((r) => r.entityId === requestId)).toBe(false);
    const managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
    expect((await listMyApprovals(managerRvs)).some((r) => r.entityId === requestId)).toBe(false);
  });

  it("with the owner override on, the owner sees every approval", async () => {
    await setOrgSetting(kit.orgId, "governance.owner_override", true);
    const [o] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
    const owner = (await buildContextForUser(o.id))!;
    expect(owner.ownerOverride).toBe(true);
    const rows = await listMyApprovals(owner);
    expect(rows.some((r) => r.entityId === requestId)).toBe(true);
    // Every open approval item of the organization is in the owner's list.
    const manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
    const theirs = await listMyApprovals(manager);
    for (const r of theirs) expect(rows.some((x) => x.id === r.id)).toBe(true);
  });
});
