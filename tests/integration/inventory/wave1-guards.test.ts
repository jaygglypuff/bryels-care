/**
 * Wave 1 integration: cross-stream guards (docs/testing.md §4.2).
 * - V-FREEZE is enforced inside postMovement for every movement type (count postings of the
 *   freezing count itself excepted), and by put-away;
 * - location holds (US-2-10 AC3) are enforced by scan-to-move, the lot move page and inter-site transfers;
 * - a movement that moved or changed a box cannot be reversed by a bare ledger reversal.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { stockMovements, users } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { createBox } from "@/modules/inventory/containers";
import { cancelCount, createCount, releaseCount } from "@/modules/inventory/counts";
import { placeHold } from "@/modules/inventory/holds";
import { postMovement } from "@/modules/inventory/ledger";
import { scanMove } from "@/modules/inventory/moves";
import { transferStock } from "@/modules/inventory/movements";
import { putAwayLot } from "@/modules/inventory/receiving-putaway";
import { reverseMovement } from "@/modules/inventory/reversal";
import { resetTestDatabase } from "../../support/db";
import { expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;
let qa: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  const [u] = await db.select().from(users).where(eq(users.email, "qa.nfd@bryels-care.test"));
  qa = new AuthContext(u.id, w.orgId, u.displayName, u.email, ["qa_qc"], new Set(ROLE_BUNDLES.qa_qc.permissions), [w.nfd], w.nfd.id);
});

async function frozen(code: string) {
  const l = await loc(w.nfd.id, code);
  const c = await createCount(w.manager, { countKind: "cycle", isBlind: true, locationIds: [l.id], counterUserIds: [w.wh2.userId] });
  await releaseCount(w.manager, c.id);
  return { l, c };
}

describe("V-FREEZE inside postMovement (US-2-17)", () => {
  it("refuses a receipt, an adjustment and a transfer touching a frozen location, for any caller; unfreezes on cancel", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0061", qty: "100" });
    const { l, c } = await frozen("A-02");
    const a01 = await loc(w.nfd.id, "A-01");
    const post = (input: Parameters<typeof postMovement>[2]) => db.transaction((tx) => postMovement(tx, w.owner, input));
    const e1 = await expectDomain(post({ movementType: "receipt", lotId: lot.id, toLocationId: l.id, qtyBase: "1", sourceDocumentType: "test_fixture" }), "conflict");
    expect(e1.details?.rule).toBe("V-FREEZE");
    await expectDomain(post({ movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: l.id, qtyBase: "1" }), "conflict");
    await expectDomain(post({ movementType: "adjustment", lotId: lot.id, toLocationId: l.id, qtyBase: "1", reason: "found" }), "conflict");
    // Another count's id does not exempt the posting.
    await expectDomain(post({ movementType: "receipt", lotId: lot.id, toLocationId: l.id, qtyBase: "1", freezeExemptCountId: randomUUID() }), "conflict");
    // The freezing count's own posting is exempt.
    const { movement } = await post({ movementType: "adjustment", lotId: lot.id, toLocationId: l.id, qtyBase: "1", reason: "count", freezeExemptCountId: c.id });
    expect(movement.toLocationId).toBe(l.id);
    await cancelCount(w.manager, c.id, "test done");
    await post({ movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: l.id, qtyBase: "1" });
    expect(await onHand(lot.id, l.id)).toBe("2");
  });

  it("put-away refuses a frozen destination with the V-FREEZE message", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "RCV", materialCode: "MAT-0061", qty: "50", status: "quarantine" });
    const { c } = await frozen("QUA-01");
    const e = await expectDomain(putAwayLot(w.wh, { lotRef: `BC:LOT:${lot.lotNumber}`, locationRef: "BC:LOC:QUA-01", idempotencyKey: randomUUID() }), "conflict");
    expect(e.message).toContain("V-FREEZE");
    await cancelCount(w.manager, c.id, "test done");
    const ok = await putAwayLot(w.wh, { lotRef: `BC:LOT:${lot.lotNumber}`, locationRef: "BC:LOC:QUA-01", idempotencyKey: randomUUID() });
    expect(ok.replayed).toBe(false);
  });
});

describe("location holds on moves (US-2-10 AC3)", () => {
  it("scan-to-move and the lot move page refuse a destination under an open QA hold", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0061", qty: "100" });
    const a01 = await loc(w.nfd.id, "A-01");
    const b01 = await loc(w.nfd.id, "B-01");
    const hold = await placeHold(qa, { scope: "location", locationId: b01.id, reasonCode: "investigation", reason: "Leak found above rack B-01", idempotencyKey: randomUUID() });
    const e = await expectDomain(scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lot.id, fromLocationId: a01.id, qty: "5" }, toLocationId: b01.id }), "blocked_lot");
    expect(e.details?.holdNumber).toBe(hold.holdNumber);
    await expectDomain(transferStock(w.wh, { lotId: lot.id, fromLocationId: a01.id, toLocationId: b01.id, qty: "5", reason: "test", idempotencyKey: key() }), "blocked_lot");
    expect(await onHand(lot.id, a01.id)).toBe("100");
  });
});

describe("box-carrying movements and the supervisor reversal", () => {
  it("a box move is corrected by moving the box back, not by a bare ledger reversal", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "FG-01", productSku: "ACS-135", qty: "48" });
    const fg = await loc(w.nfd.id, "FG-01");
    const box = await createBox(w.wh, { lotId: lot.id, locationId: fg.id, qty: "24", idempotencyKey: key() });
    const r = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "box", containerId: box.id }, toLocationId: (await loc(w.nfd.id, "SHP")).id });
    const e = await expectDomain(reverseMovement(w.owner, { movementId: r.lines[0].movementId, reason: "Wrong dock", confirmation: "REVERSE", idempotencyKey: randomUUID() }), "state");
    expect(e.details?.rule).toBe("box_movement");
    const rev = await db.select().from(stockMovements).where(eq(stockMovements.reversalOfId, r.lines[0].movementId));
    expect(rev).toHaveLength(0);
  });
});
