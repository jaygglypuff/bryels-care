/** US-2-14 scan-to-move, US-2-28 undo, inter-site transfer (docs/testing.md §4.2, idempotency.*). */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { containers, inventoryLots, settings, stockMovements, transferRequests } from "@/db/schema";
import { createBox } from "@/modules/inventory/containers";
import { scanMove, undoMove, interSiteTransfer } from "@/modules/inventory/moves";
import { createReservation } from "@/modules/inventory/reservations";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;
const SESSION = "0193b8a0-0000-7000-8000-000000000001";
const OTHER_SESSION = "0193b8a0-0000-7000-8000-000000000002";

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("scan-to-move (US-2-14)", () => {
  it("moves a box: one transfer per lot carrying the box, box location updated, read-back message names box, contents, destination and number", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "96" });
    const fg = await loc(w.nfd.id, "FG-01");
    const shp = await loc(w.nfd.id, "SHP");
    const box = await createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "48", idempotencyKey: key() });
    const r = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "box", containerId: box.id }, toLocationId: shp.id, sessionId: SESSION });
    expect(r.alreadyMoved).toBe(false);
    expect(r.transferNumber).toMatch(/^TR-\d{2}-\d{6}$/);
    expect(r.message).toContain(box.containerNumber);
    expect(r.message).toContain("SHP");
    expect(r.message).toContain(lot.lotNumber);
    expect(r.undo?.command).toBe("inventory.move.undo");
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, r.transferId));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("transfer");
    expect((mv[0].meta as { containerId: string }).containerId).toBe(box.id);
    const [b] = await db.select().from(containers).where(eq(containers.id, box.id));
    expect(b.currentLocationId).toBe(shp.id);
    expect(await onHand(lot.id, shp.id)).toBe("48");
    expect(await onHand(lot.id, fg.id)).toBe("48");
    expect(await auditCount("inventory.stock_movement.posted", mv[0].id)).toBe(1);
  });

  it("idempotency.replay_returns_original and V-DUP: same key replays; same box and destination with a new key answers 'Already moved … by you' and posts nothing", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "24" });
    const fg = await loc(w.nfd.id, "FG-01");
    const shp = await loc(w.nfd.id, "SHP");
    const box = await createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "24", idempotencyKey: key() });
    const k = key();
    const [a, b] = await Promise.all([
      scanMove(w.wh, { idempotencyKey: k, source: { kind: "box", containerId: box.id }, toLocationId: shp.id }),
      scanMove(w.wh, { idempotencyKey: k, source: { kind: "box", containerId: box.id }, toLocationId: shp.id }),
    ]);
    expect(a.transferId).toBe(b.transferId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const again = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "box", containerId: box.id }, toLocationId: shp.id });
    expect(again.alreadyMoved).toBe(true);
    expect(again.message).toMatch(/Already moved to SHP at .* by you/);
    const trs = await db.select().from(transferRequests).where(eq(transferRequests.containerId, box.id));
    expect(trs).toHaveLength(1);
    expect(await onHand(lot.id, shp.id)).toBe("24");
    // idempotency.same_key_different_body_422
    const other = await loc(w.nfd.id, "A-01");
    await expectDomain(scanMove(w.wh, { idempotencyKey: k, source: { kind: "box", containerId: box.id }, toLocationId: other.id }), "validation");
  });

  it("V-LOC: a quarantined lot cannot go to a storage bin; suggestions are given", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "QUA-01", materialCode: "MAT-0012", qty: "1000", status: "quarantine" });
    const e = await expectDomain(
      scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: (await loc(w.nfd.id, "QUA-01")).id, qty: "100" }, toLocationId: (await loc(w.nfd.id, "A-01")).id }),
      "blocked_lot",
    );
    expect(e.message).toContain("HLD-01");
  });

  it("boxed stock is moved with its box, not as loose lot quantity", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0012", qty: "1000" });
    const a01 = await loc(w.nfd.id, "A-01");
    await createBox(w.wh, { lotId: lot.id, locationId: a01.id, qty: "800", idempotencyKey: key() });
    await expectDomain(scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: a01.id, qty: "300" }, toLocationId: (await loc(w.nfd.id, "A-02")).id }), "insufficient_stock");
    const ok = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: a01.id, qty: "200" }, toLocationId: (await loc(w.nfd.id, "A-02")).id });
    expect(ok.lines[0].qtyBase).toBe("200");
  });

  it("authz.cross_site: a Site B operator cannot move a Site A box (not found); an auditor cannot move (forbidden)", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "10" });
    const box = await createBox(w.wh, { lotId: lot.id, locationId: (await loc(w.nfd.id, "FG-01")).id, qty: "10", idempotencyKey: key() });
    await expectDomain(scanMove(w.whRvs, { idempotencyKey: key(), source: { kind: "box", containerId: box.id }, toLocationId: (await loc(w.rvs.id, "FG-01")).id }), "not_found");
    await expectDomain(scanMove(w.auditor, { idempotencyKey: key(), source: { kind: "box", containerId: box.id }, toLocationId: (await loc(w.nfd.id, "SHP")).id }), "forbidden");
  });
});

describe("undo of own move (US-2-28)", () => {
  async function freshMove(sessionId = SESSION) {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0061", qty: "500" });
    const a01 = await loc(w.nfd.id, "A-01");
    const a02 = await loc(w.nfd.id, "A-02");
    const r = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: a01.id, qty: "200" }, toLocationId: a02.id, sessionId });
    return { lot, a01, a02, r };
  }

  it("ledger.reversal.undo_window: same actor and session inside the window posts one linked reversal; a repeated tap returns the stored result", async () => {
    const { lot, a01, a02, r } = await freshMove();
    const [orig] = await db.select().from(stockMovements).where(eq(stockMovements.id, r.lines[0].movementId));
    const u1 = await undoMove(w.wh, { transferId: r.transferId, sessionId: SESSION });
    const u2 = await undoMove(w.wh, { transferId: r.transferId, sessionId: SESSION });
    expect(u2.replayed).toBe(true);
    expect(u2.reversalMovementIds).toEqual(u1.reversalMovementIds);
    const [rev] = await db.select().from(stockMovements).where(eq(stockMovements.id, u1.reversalMovementIds[0]));
    expect(rev.movementType).toBe("reversal");
    expect(rev.reason).toBe("undo_by_actor");
    expect(rev.idempotencyKey).toBe(`undo:${orig.id}`);
    expect(rev.reversalOfId).toBe(orig.id);
    expect(rev.correlationId).toBe(orig.correlationId);
    const [origAfter] = await db.select().from(stockMovements).where(eq(stockMovements.id, orig.id));
    expect(origAfter).toEqual(orig);
    expect(await onHand(lot.id, a01.id)).toBe("500");
    expect(await onHand(lot.id, a02.id)).toBe("0");
    expect(await auditCount("inventory.stock_movement.reversed", orig.id)).toBe(1);
  });

  it("refuses another user, another session and after the window elapsed (409, nothing written)", async () => {
    const { r } = await freshMove();
    await expectDomain(undoMove(w.wh2, { transferId: r.transferId, sessionId: SESSION }), "state");
    await expectDomain(undoMove(w.wh, { transferId: r.transferId, sessionId: OTHER_SESSION }), "state");
    await db.insert(settings).values({ organizationId: w.orgId, scope: "organization", key: "settings.ux.undo_window_seconds", value: 0 });
    try {
      const e = await expectDomain(undoMove(w.wh, { transferId: r.transferId, sessionId: SESSION }), "state");
      expect(e.details?.offerReversalRequest).toBe(true);
    } finally {
      await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "settings.ux.undo_window_seconds")));
    }
    const rev = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentId, r.transferId), eq(stockMovements.movementType, "reversal")));
    expect(rev).toHaveLength(0);
  });

  it("ledger.reversal.undo_refused_after_later_movement: a later movement or reservation on the lot blocks undo", async () => {
    const { lot, a02, r } = await freshMove();
    await scanMove(w.wh2, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: a02.id, qty: "50" }, toLocationId: (await loc(w.nfd.id, "B-01")).id });
    const e = await expectDomain(undoMove(w.wh, { transferId: r.transferId, sessionId: SESSION }), "state");
    expect(e.message).toContain("later stock movement");

    const m2 = await freshMove();
    await createReservation(w.manager, { lotId: m2.lot.id, locationId: m2.a02.id, qty: "10", demandType: "manual", demandReference: "Hold for QA retain", idempotencyKey: key() });
    const e2 = await expectDomain(undoMove(w.wh, { transferId: m2.r.transferId, sessionId: SESSION }), "state");
    expect(e2.message).toContain("reserved");
  });
});

describe("inter-site transfer (US-2-14 AC2)", () => {
  it("posts an issue at A and a receipt at B into a new lot with origin_lot_id, sharing one correlation id", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "60" });
    const r = await interSiteTransfer(w.whBoth, {
      idempotencyKey: key(),
      lotId: lot.id,
      fromLocationId: (await loc(w.nfd.id, "FG-01")).id,
      qty: "20",
      toSiteId: w.rvs.id,
      toLocationId: (await loc(w.rvs.id, "FG-01")).id,
      reason: "Stock for Riverside orders",
    });
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, r.transferId));
    expect(mv.map((m) => m.movementType).sort()).toEqual(["issue", "receipt"]);
    const corr = new Set(mv.map((m) => m.correlationId));
    expect(corr.size).toBe(1);
    const [dest] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, r.destinationLotId));
    expect(dest.originLotId).toBe(lot.id);
    expect(dest.siteId).toBe(w.rvs.id);
    expect(await onHand(dest.id, (await loc(w.rvs.id, "FG-01")).id)).toBe("20");
  });

  it("inventory.intersite_transfer_needs_both_sites: without rights at the destination site it is 403", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "10" });
    await expectDomain(
      interSiteTransfer(w.wh, { idempotencyKey: key(), lotId: lot.id, fromLocationId: (await loc(w.nfd.id, "FG-01")).id, qty: "5", toSiteId: w.rvs.id, toLocationId: (await loc(w.rvs.id, "FG-01")).id, reason: "x" }),
      "forbidden",
    );
    await expectDomain(
      interSiteTransfer(w.sales, { idempotencyKey: key(), lotId: lot.id, fromLocationId: (await loc(w.nfd.id, "FG-01")).id, qty: "5", toSiteId: w.rvs.id, toLocationId: (await loc(w.rvs.id, "FG-01")).id, reason: "x" }),
      "forbidden",
    );
  });
});
