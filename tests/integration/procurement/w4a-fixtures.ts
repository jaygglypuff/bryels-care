import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materials, purchaseOrders, supplierMaterials, suppliers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createPurchaseOrder, decidePurchaseOrder, sendPurchaseOrder, submitPurchaseOrder } from "@/modules/procurement";
import { asUser, type Kit } from "../../support/kit";

/** W4A fixtures: the seeded (fictional) users in the roles of docs/permissions-matrix.md §3.4. */
export async function w4aUsers(kit: Kit) {
  return {
    proc: await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]),
    // A second procurement person (for SoD between two procurement users); the auditor's account in the procurement role.
    proc2: await asUser(kit, "auditor@bryels-care.test", "procurement", [kit.nfd, kit.rvs]),
    qa: await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]),
    qa2: await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]),
    manager: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]),
    owner: await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]),
    warehouse: await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]),
    warehouseRvs: await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]),
    planner: await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]),
    admin: await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]),
    finance: await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd, kit.rvs]),
  };
}

export const supplierByName = async (name: string) => (await db.select().from(suppliers).where(eq(suppliers.name, name)))[0];
export const materialByCode = async (code: string) => (await db.select().from(materials).where(eq(materials.code, code)))[0];
export async function pair(supplierName: string, code: string) {
  const s = await supplierByName(supplierName);
  const m = await materialByCode(code);
  return (await db.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, s.id), eq(supplierMaterials.materialId, m.id))))[0];
}

/** Creates a PO through the services and drives it to `sent` (approver = the NFD site manager; owner for step 2). */
export async function sentPo(u: Awaited<ReturnType<typeof w4aUsers>>, lines: { code: string; qty: string; uom?: string }[], supplierName = "Laguna Oleo Supply") {
  const s = await supplierByName(supplierName);
  const mats = await Promise.all(lines.map((l) => materialByCode(l.code)));
  const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: lines.map((l, i) => ({ materialId: mats[i].id, qty: l.qty, uom: l.uom ?? "kg" })) });
  await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
  const r = await decidePurchaseOrder(u.manager, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
  if (!r.final) await decidePurchaseOrder(u.owner, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
  await sendPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId, email: false });
  const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
  return row;
}

export type W4aUsers = Awaited<ReturnType<typeof w4aUsers>>;
export type Ctx = AuthContext;
