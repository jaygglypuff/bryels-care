/**
 * US-2-02 reversal and replacement (docs/testing.md §4.2): ledger.reversal.links_original,
 * ledger.reversal.twice_rejected, ledger.reversal.replacement_correlated, ledger.reversal.revalidated,
 * plus authorization negatives (role escalation, cross-site) and idempotent replay.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import { transferStock } from "@/modules/inventory/movements";
import { getMovementDetail, reverseMovement } from "@/modules/inventory/reversal";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot, onHand } from "../../support/kit";

let kit: Kit;
let manager: AuthContext;
let wh: AuthContext;
let managerRvs: AuthContext;

async function postedTransfer(qty = "40") {
  const a01 = await loc(kit.nfd.id, "A-01");
  const a02 = await loc(kit.nfd.id, "A-02");
  const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
  const t = await transferStock(wh, { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty, reason: "put-away", idempotencyKey: randomUUID() });
  return { lot, a01, a02, movementId: t.movementId };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
});

describe("ledger.reversal", () => {
  it("links_original: a linked reversal row returns balances to pre-posting; the original is byte-identical; audited", async () => {
    const { lot, a01, a02, movementId } = await postedTransfer();
    const [before] = await db.select().from(stockMovements).where(eq(stockMovements.id, movementId));
    const r = await reverseMovement(manager, { movementId, reason: "Scanned the wrong rack", confirmation: "REVERSE", idempotencyKey: randomUUID() });
    const [after] = await db.select().from(stockMovements).where(eq(stockMovements.id, movementId));
    expect(after).toEqual(before);
    const [rev] = await db.select().from(stockMovements).where(eq(stockMovements.id, r.reversalId));
    expect(rev.movementType).toBe("reversal");
    expect(rev.reversalOfId).toBe(movementId);
    expect(rev.fromLocationId).toBe(a02.id);
    expect(rev.toLocationId).toBe(a01.id);
    expect(rev.reason).toBe("Scanned the wrong rack");
    expect(rev.postedBy).toBe(manager.userId);
    expect(await onHand(lot.id, a01.id)).toBe("100");
    expect(await onHand(lot.id, a02.id)).toBe("0");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, movementId), eq(auditEvents.action, "inventory.stock_movement.reversed")));
    expect(ev).toHaveLength(1);
    expect(ev[0].reason).toBe("Scanned the wrong rack");
    expect(ev[0].correlationId).toBe(r.correlationId);
  });

  it("twice_rejected: a second reversal of the same movement is 409, and the partial unique index holds under direct SQL", async () => {
    const { movementId } = await postedTransfer();
    const first = await reverseMovement(manager, { movementId, reason: "wrong rack", confirmation: "REVERSE", idempotencyKey: randomUUID() });
    await expectCode(reverseMovement(manager, { movementId, reason: "again", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "conflict");
    const [rev] = await db.select().from(stockMovements).where(eq(stockMovements.id, first.reversalId));
    await expect(db.insert(stockMovements).values({ ...rev, id: undefined as never, idempotencyKey: null })).rejects.toThrow();
  });

  it("a reversal is never reversed itself", async () => {
    const { movementId } = await postedTransfer();
    const r = await reverseMovement(manager, { movementId, reason: "wrong rack", confirmation: "REVERSE", idempotencyKey: randomUUID() });
    await expectCode(reverseMovement(manager, { movementId: r.reversalId, reason: "undo the undo", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "state");
  });

  it("replacement_correlated: reversal + replacement share one correlation id and list together", async () => {
    const { lot, a01, a02, movementId } = await postedTransfer("40");
    const b01 = await loc(kit.nfd.id, "B-01");
    const r = await reverseMovement(manager, {
      movementId,
      reason: "Went to B-01, not A-02",
      confirmation: "reverse",
      idempotencyKey: randomUUID(),
      replacement: { fromLocationId: a01.id, toLocationId: b01.id, qty: "40" },
    });
    expect(r.replacementId).toBeTruthy();
    const rows = await db.select().from(stockMovements).where(eq(stockMovements.correlationId, r.correlationId));
    expect(rows.map((x) => x.movementType).sort()).toEqual(["reversal", "transfer"]);
    expect(await onHand(lot.id, a02.id)).toBe("0");
    expect(await onHand(lot.id, b01.id)).toBe("40");
    const detail = await getMovementDetail(manager, movementId);
    expect(detail.reversedBy?.m.id).toBe(r.reversalId);
    expect(detail.related.map((x) => x.m.id).sort()).toEqual([r.reversalId, r.replacementId].sort());
    expect(detail.canReverse).toBe(false);
  });

  it("revalidated: when the stock has since moved on, the reversal is 409 and nothing is written", async () => {
    const { lot, a02, movementId } = await postedTransfer("40");
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "consumption", lotId: lot.id, fromLocationId: a02.id, qtyBase: "30" }));
    await expectCode(reverseMovement(manager, { movementId, reason: "too late", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "insufficient_stock");
    expect(await db.select().from(stockMovements).where(eq(stockMovements.reversalOfId, movementId))).toHaveLength(0);
    expect(await onHand(lot.id, a02.id)).toBe("10");
  });

  it("is idempotent: the same key returns the stored result", async () => {
    const { movementId } = await postedTransfer();
    const key = randomUUID();
    const a = await reverseMovement(manager, { movementId, reason: "dup", confirmation: "REVERSE", idempotencyKey: key });
    const b = await reverseMovement(manager, { movementId, reason: "dup", confirmation: "REVERSE", idempotencyKey: key });
    expect(b.replayed).toBe(true);
    expect(b.reversalId).toBe(a.reversalId);
  });

  it("requires the typed confirmation and a reason", async () => {
    const { movementId } = await postedTransfer();
    await expectCode(reverseMovement(manager, { movementId, reason: "x", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "validation");
    await expectCode(reverseMovement(manager, { movementId, reason: "valid reason", confirmation: "yes", idempotencyKey: randomUUID() }), "validation");
  });

  it("receipts, consumption, output and shipments are corrected from their source document, not here", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "10");
    const [receipt] = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "receipt")));
    await expectCode(reverseMovement(manager, { movementId: receipt.id, reason: "wrong receipt", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "state");
  });
});

describe("authorization", () => {
  it("authz.role_escalation.missing_permission: a warehouse operator (no inventory.movement.void) is refused", async () => {
    const { movementId } = await postedTransfer();
    await expectCode(reverseMovement(wh, { movementId, reason: "I can't", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "forbidden");
  });

  it("authz.cross_site.body: a manager of another site gets not_found and nothing is written", async () => {
    const { movementId } = await postedTransfer();
    await expectCode(reverseMovement(managerRvs, { movementId, reason: "other site", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "not_found");
    await expectCode(getMovementDetail(managerRvs, movementId), "not_found");
    expect(await db.select().from(stockMovements).where(eq(stockMovements.reversalOfId, movementId))).toHaveLength(0);
  });
});
