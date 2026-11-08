import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots, materials, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { expiryRequired, receiveAndPost } from "@/modules/inventory/receiving";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";

/**
 * Round 5 (C-office B3, A-RCV-EXP-01): packaging (wrappers, bottles, boxes) is received without an expiry date
 * unless the setting `inventory.receiving.packaging_expiry_required` is on; ingredients always need one.
 */
let kit: Kit;
let wh: AuthContext;
const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

async function mat(code: string) {
  const [m] = await db.select().from(materials).where(and(eq(materials.organizationId, kit.orgId), eq(materials.code, code)));
  return m;
}
async function line(code: string, expiresOn: string | null, extra: Record<string, unknown> = {}) {
  const m = await mat(code);
  const where = await loc(kit.nfd.id, m.requiresIncomingInspection ? "QUA-01" : "PKG-01");
  return { materialId: m.id, qty: "100", uom: m.baseUom, supplierLotNumber: `R5-${code}`, expiresOn, locationId: where.id, storageConditionsConfirmed: true, ...extra };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
}, 180_000);

describe("expiry date at receiving", () => {
  it("the rule: required except for packaging, unless the setting asks for it", () => {
    expect(expiryRequired("raw_material", false)).toBe(true);
    expect(expiryRequired("intermediate", false)).toBe(true);
    expect(expiryRequired("packaging", false)).toBe(false);
    expect(expiryRequired("packaging", true)).toBe(true);
    expect(expiryRequired(null, false)).toBe(true);
  });

  it("packaging without an expiry is received (no invented date); the lot has no expiry", async () => {
    const r = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Fictional Print & Pack", supplierDocumentNumber: `R5-PKG-${randomUUID().slice(0, 6)}`, unplannedReasonCode: "no_purchase_order", lines: [await line("PKG-0101", null)] });
    const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
    expect(l.expiresOn).toBeNull();
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
    expect(lot.expiresOn).toBeNull();
  });

  it("an ingredient without an expiry is refused in plain words", async () => {
    const e = await expectCode(receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Fictional Oils", supplierDocumentNumber: "R5-ING", unplannedReasonCode: "no_purchase_order", lines: [await line("MAT-0012", null)] }), "validation");
    expect((e as Error).message).toMatch(/enter the expiry date printed on/);
  });

  it("with the setting on, packaging needs an expiry too", async () => {
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "inventory.receiving.packaging_expiry_required", value: true });
    try {
      await expectCode(receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Fictional Print & Pack", supplierDocumentNumber: "R5-PKG-ON", unplannedReasonCode: "no_purchase_order", lines: [await line("PKG-0101", null)] }), "validation");
      const ok = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Fictional Print & Pack", supplierDocumentNumber: "R5-PKG-ON2", unplannedReasonCode: "no_purchase_order", lines: [await line("PKG-0101", exp)] });
      expect(ok.receiptId).toBeTruthy();
    } finally {
      await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "inventory.receiving.packaging_expiry_required")));
    }
  });
});
