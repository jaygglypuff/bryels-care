import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batches, dispositions, inventoryBalances, inventoryLots, locations, organizations, sites, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { decideBatch } from "@/modules/quality/dispositions";
import { traceGenealogy, type TraceNode } from "@/modules/quality/genealogy";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let qa: AuthContext;
let qaRvsOnly: AuthContext;
let warehouse: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
function flatten(nodes: TraceNode[]): TraceNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  qa = await ctxFor("qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  qaRvsOnly = await ctxFor("qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [rvs]);
  warehouse = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
});

describe("batch reject", () => {
  it("rejects the batch and moves its output lot to the rejected location", async () => {
    const [b] = await db.select().from(batches).where(eq(batches.batchNumber, "B-26-0003"));
    await expect(decideBatch(qa, { batchId: b.id, decision: "reject", reason: "no" })).rejects.toMatchObject({ code: "validation" });
    await decideBatch(qa, { batchId: b.id, decision: "reject", reason: "Cracked bars across the batch" });
    const [after] = await db.select().from(batches).where(eq(batches.id, b.id));
    expect(after.status).toBe("rejected");
    const [l] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    expect(l.qualityStatus).toBe("rejected");
    const [rej] = await db.select().from(locations).where(and(eq(locations.siteId, nfd.id), eq(locations.kind, "rejected")));
    const [bal] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, l.id), eq(inventoryBalances.locationId, rej.id)));
    expect(bal.qtyBase).toBe("121.000000");
    const d = await db.select().from(dispositions).where(eq(dispositions.subjectId, b.id));
    expect(d[0]).toMatchObject({ subjectType: "batch", decision: "reject", fromStatus: "awaiting_qc", toStatus: "rejected" });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.id), eq(auditEvents.action, "quality.disposition.rejected")));
    expect(ev).toHaveLength(1);
  });
});

describe("genealogy", () => {
  it("traces a material lot forward to the customers who received it", async () => {
    const t = await traceGenealogy(qa, { lotNumber: "L-2610-00001" });
    expect(t.root?.kind).toBe("lot");
    const fwd = flatten(t.forward);
    expect(fwd.filter((n) => n.kind === "batch").map((n) => n.number)).toEqual(expect.arrayContaining(["B-26-0001", "B-26-0002", "B-26-0003"]));
    expect(fwd.filter((n) => n.kind === "lot").map((n) => n.number)).toEqual(expect.arrayContaining(["L-2610-00015", "L-2610-00016", "L-2610-00017"]));
    expect(t.affectedCustomers.map((c) => c.customerName)).toContain("Luntian Wellness Stores");
    const row = t.affectedCustomers.find((c) => c.drNumber === "DR-26-00001")!;
    expect(row.lotNumber).toBe("L-2610-00015");
    expect(row.qty).toBe("48.000000");
  });

  it("traces a finished lot back to its material lots with supplier lots", async () => {
    const t = await traceGenealogy(qa, { lotNumber: "L-2610-00015" });
    const back = flatten(t.reverse);
    expect(back.find((n) => n.kind === "batch")?.number).toBe("B-26-0001");
    const mats = back.filter((n) => n.kind === "lot");
    expect(mats.map((n) => n.number)).toEqual(expect.arrayContaining(["L-2610-00001", "L-2610-00002", "L-2610-00004", "L-2610-00005", "L-2610-00007"]));
    expect(mats.find((n) => n.number === "L-2610-00001")?.supplierLot).toBe("LOS-24871");
    expect(t.affectedCustomers).toHaveLength(1);
  });

  it("traces by batch number", async () => {
    const t = await traceGenealogy(qa, { batchNumber: "B-26-0001" });
    expect(t.root?.kind).toBe("batch");
    expect(flatten(t.reverse).filter((n) => n.kind === "lot")).toHaveLength(5);
    expect(t.affectedCustomers.map((c) => c.drNumber)).toEqual(["DR-26-00001"]);
  });

  it("returns nothing for lots outside the user's sites and refuses users without the permission", async () => {
    const t = await traceGenealogy(qaRvsOnly, { lotNumber: "L-2610-00001" });
    expect(t.root).toBeNull();
    await expect(traceGenealogy(warehouse, { lotNumber: "L-2610-00001" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
