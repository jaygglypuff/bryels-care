/**
 * Round 5 office fixes, purchasing (docs/ux-audit/round5/C-office.md problems 5, 8, 9, 11; B-owner-manager.md problems 3,
 * 7, 8; bugs B1, B3, B16). ADR-131.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { purchaseOrders } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { createPurchaseOrder, decidePurchaseOrder, recordSupplierConfirmation, sendPurchaseOrder, submitPurchaseOrder } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { loadKit, type Kit } from "../../support/kit";
import { setOrgSetting } from "../production/w2a-fixtures";
import { materialByCode, supplierByName, w4aUsers, type W4aUsers } from "./w4a-fixtures";

let kit: Kit;
let u: W4aUsers;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  u = await w4aUsers(kit);
});

describe("B1: sending an order the owner made and approved alone", () => {
  it("sends, records the email outcome and does not fail after the order was sent; later changes by others work", async () => {
    await setOrgSetting(kit.orgId, "governance.owner_override", true); // the small demo's owner (ADR-073)
    const owner = (await buildContextForUser(u.owner.userId))!;
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(owner, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId });
    const d = await decidePurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    expect(d.final).toBe(true);
    const r = await sendPurchaseOrder(owner, { purchaseOrderId: po.purchaseOrderId, email: true });
    expect(r.documentNumber).toBeTruthy();
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.purchaseOrderId));
    expect(row.status).toBe("sent");
    expect(row.sendResult).not.toBe("pending");
    // Another person's later change of the same order (the supplier answered) is not refused by the same-person rule.
    await recordSupplierConfirmation(u.proc, { purchaseOrderId: po.purchaseOrderId, supplierReference: "SO-LAG-1" });
    await setOrgSetting(kit.orgId, "governance.owner_override", false);
  });

  it("the same-person rule still refuses a write that makes the approver the creator (no flag)", async () => {
    const s = await supplierByName("Laguna Oleo Supply");
    const m = await materialByCode("MAT-0012");
    const po = await createPurchaseOrder(u.proc, { supplierId: s.id, lines: [{ materialId: m.id, qty: "10", uom: "kg" }] });
    await submitPurchaseOrder(u.proc, { purchaseOrderId: po.purchaseOrderId });
    await decidePurchaseOrder(u.manager, { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    const e = await db.update(purchaseOrders).set({ approvedBy: u.proc.userId }).where(eq(purchaseOrders.id, po.purchaseOrderId)).catch((x) => x);
    expect(String(e?.cause?.message ?? e?.message)).toMatch(/ck_purchase_orders_sod/);
  });

  it("migration 0041 ends with the canonical src/db/sql/adr131.sql", () => {
    const root = path.resolve(__dirname, "../../..");
    const migration = readFileSync(path.join(root, "src/db/migrations/0041_adr131_custom_sql.sql"), "utf8").trim();
    const canonical = readFileSync(path.join(root, "src/db/sql/adr131.sql"), "utf8").trim();
    expect(migration.endsWith(canonical)).toBe(true);
  });
});
