import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, dispositions, goodsReceiptLines, inventoryLots, qualityHolds, suppliers, users } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { getHold, issueHeldStock, liftHold, listHolds, markHoldInvestigating, placeHold } from "@/modules/inventory/holds";
import { runExpiryCheck } from "@/modules/inventory/holds-expiry";
import { handler as expiryHandler, expiryCheckJob } from "@/modules/inventory/jobs/expiry-check";
import { transferStock } from "@/modules/inventory/movements";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { putAwayLot, putAwayOptions } from "@/modules/inventory/receiving-putaway";
import { decideLot } from "@/modules/quality/dispositions";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, expectDomain, future, loadSites, loc, mat, onHand } from "../../support/w1b";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let whRvs: AuthContext;
let qa: AuthContext;
let qa2: AuthContext;
let owner: AuthContext;
let lagunaId: string;

/** Receives one quarantined lot into the given location and returns it. */
async function receiveLot(locCode = "RCV", over: Record<string, unknown> = {}) {
  const r = await receiveAndPost(wh, {
    idempotencyKey: randomUUID(),
    supplierId: lagunaId,
    supplierDocumentNumber: "DR-PA",
    lines: [{ materialId: (await mat("MAT-0012")).id, qty: "1000", uom: "g", supplierLotNumber: "LOS-PA", expiresOn: future(300), locationId: (await loc(nfd.id, locCode)).id, ...over }],
  });
  const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
  const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, l.lotId!));
  return lot;
}
const status = async (lotId: string) => (await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId)))[0].qualityStatus;

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  // A second QA person (the seed has one QA user; the manager account stands in with the QA bundle).
  qa2 = await ctxFor(orgId, "manager.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd]);
  owner = await ctxFor(orgId, "owner@bryels-care.test", ROLE_BUNDLES.owner_director.permissions, [nfd, rvs]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
});

describe("put-away and status-location rules (US-2-09)", () => {
  it("stock.blocked.location_class: a quarantined lot cannot go to a released bin; allowed locations are suggested", async () => {
    const lot = await receiveLot();
    const opts = await putAwayOptions(wh, `BC:LOT:${lot.lotNumber}`);
    expect(opts.destinations.map((d) => d.code)).toEqual(expect.arrayContaining(["QUA-01", "HLD-01"]));
    expect(opts.destinations.some((d) => d.code === "A-01")).toBe(false);
    const e = await expectDomain(putAwayLot(wh, { lotRef: `BC:LOT:${lot.lotNumber}`, locationRef: "BC:LOC:A-01", idempotencyKey: randomUUID() }), "blocked_lot");
    expect(e.details?.rule).toBe("V-LOC");
    expect(e.details?.allowedLocations).toEqual(expect.arrayContaining(["QUA-01"]));

    const key = randomUUID();
    const r1 = await putAwayLot(wh, { lotRef: `BC:LOT:${lot.lotNumber}`, locationRef: "BC:LOC:QUA-01", idempotencyKey: key });
    const r2 = await putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: "QUA-01", idempotencyKey: key });
    expect(r2).toMatchObject({ replayed: true, movementId: r1.movementId });
    expect(await onHand(lot.id, (await loc(nfd.id, "QUA-01")).id)).toBe("1000.000000");
    expect(await onHand(lot.id, (await loc(nfd.id, "RCV")).id)).toBe("0.000000");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r1.movementId), eq(auditEvents.action, "inventory.stock_movement.posted")))).toHaveLength(1);
  });

  it("refuses cross-site lots and locations, and users without inventory.movement.post", async () => {
    const lot = await receiveLot();
    await expectDomain(putAwayLot(whRvs, { lotRef: lot.lotNumber, locationRef: "QUA-01", idempotencyKey: randomUUID() }), "not_found");
    await expectDomain(putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: (await loc(rvs.id, "QUA-01")).id, idempotencyKey: randomUUID() }), "not_found");
    await expectDomain(putAwayLot(qa, { lotRef: lot.lotNumber, locationRef: "QUA-01", idempotencyKey: randomUUID() }), "forbidden");
  });
});

describe("quality holds (US-2-10 AC3)", () => {
  it("lot hold: warehouse places, opener cannot lift, QA lifts with a closing disposition back to the previous status", async () => {
    const lot = await receiveLot("QUA-01");
    const h = await placeHold(wh, { scope: "lot", lotRef: lot.lotNumber, reasonCode: "damaged_packaging", reason: "Drum leaking at the seam", idempotencyKey: randomUUID() });
    expect(h.holdNumber).toMatch(/^QH-\d{2}-\d{4}$/);
    expect(await status(lot.id)).toBe("on_hold");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, h.holdId), eq(auditEvents.action, "quality.hold.placed")))).toHaveLength(1);
    await expectDomain(placeHold(wh, { scope: "lot", lotRef: lot.lotNumber, reasonCode: "other", reason: "Second hold", idempotencyKey: randomUUID() }), "conflict");

    // release_from_hold through the lot decision is refused while the formal hold is open.
    await expectDomain(decideLot(qa, { lotId: lot.id, decision: "release_from_hold", reason: "Looks fine now" }), "state");
    await expectDomain(liftHold(wh, { holdId: h.holdId, resolution: "released", reason: "Repacked" }), "forbidden");
    await expectDomain(liftHold(owner, { holdId: h.holdId, resolution: "released", reason: "Repacked" }), "forbidden");
    const qaOpened = await placeHold(qa, { scope: "lot", lotRef: (await receiveLot("QUA-01")).lotNumber, reasonCode: "investigation", reason: "Investigating colour", idempotencyKey: randomUUID() });
    await expectDomain(liftHold(qa, { holdId: qaOpened.holdId, resolution: "released", reason: "Colour normal" }), "separation_of_duties"); // quality.hold_lift_not_creator

    await markHoldInvestigating(wh, { holdId: h.holdId, note: "Supplier asked for photos" });
    const lifted = await liftHold(qa, { holdId: h.holdId, resolution: "released", reason: "Repacked into a sound drum; contents unaffected" });
    expect(lifted.lots[0]).toMatchObject({ to: "quarantine" }); // lifting is never a QA release
    expect(await status(lot.id)).toBe("quarantine");
    const [closed] = await db.select().from(qualityHolds).where(eq(qualityHolds.id, h.holdId));
    expect(closed).toMatchObject({ status: "closed", resolution: "released", closedBy: qa.userId });
    const ds = await db.select().from(dispositions).where(eq(dispositions.subjectId, lot.id));
    expect(ds.map((d) => d.decision).sort()).toEqual(["hold", "hold_lifted"]);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, h.holdId), eq(auditEvents.action, "quality.hold.lifted")))).toHaveLength(1);
    const detail = await getHold(qa, h.holdId);
    expect(detail.timeline.map((t) => t.to)).toEqual(["open", "investigating", "closed"]);
    await expectDomain(liftHold(qa, { holdId: h.holdId, resolution: "released", reason: "again please" }), "state");
  });

  it("hold.blocks_all_named_scope: a location hold blocks every lot in it and refuses put-away into it", async () => {
    const a = await receiveLot("HLD-01");
    const b = await receiveLot("HLD-01");
    const h = await placeHold(qa, { scope: "location", locationId: (await loc(nfd.id, "HLD-01")).id, reasonCode: "suspected_contamination", reason: "Water leak above the cage", idempotencyKey: randomUUID() });
    expect(h.lots).toBe(2);
    expect(await status(a.id)).toBe("on_hold");
    expect(await status(b.id)).toBe("on_hold");
    const c = await receiveLot("RCV");
    const e = await expectDomain(putAwayLot(wh, { lotRef: c.lotNumber, locationRef: "HLD-01", idempotencyKey: randomUUID() }), "blocked_lot");
    expect(e.message).toMatch(new RegExp(h.holdNumber));
    expect((await putAwayOptions(wh, c.lotNumber)).destinations.some((d) => d.code === "HLD-01")).toBe(false);
    expect((await listHolds(wh, { status: "active" })).some((x) => x.id === h.holdId)).toBe(true);
    await liftHold(qa2, { holdId: h.holdId, resolution: "rejected", reason: "Water damage confirmed; destroy" });
    expect(await status(a.id)).toBe("rejected");
    expect(await status(b.id)).toBe("rejected");
  });

  it("holds of another site are invisible", async () => {
    const lot = await receiveLot("QUA-01");
    const h = await placeHold(wh, { scope: "lot", lotRef: lot.lotNumber, reasonCode: "other", reason: "Cross-site check", idempotencyKey: randomUUID() });
    await expectDomain(getHold(whRvs, h.holdId), "not_found");
    await expectDomain(placeHold(whRvs, { scope: "lot", lotRef: lot.lotNumber, reasonCode: "other", reason: "not mine", idempotencyKey: randomUUID() }), "not_found");
    expect((await listHolds(whRvs)).some((x) => x.id === h.holdId)).toBe(false);
  });
});

describe("blocked stock (US-2-10 AC2, stock.blocked.matrix)", () => {
  it("normal flow refuses every blocked status; the held-stock exception unblocks quarantine and on_hold only", async () => {
    const storage = await loc(nfd.id, "A-01");
    const qua = await loc(nfd.id, "QUA-01");
    const lots: Record<string, typeof inventoryLots.$inferSelect> = {};
    for (const s of ["quarantine", "on_hold", "rejected", "expired", "recalled"]) {
      const lot = await receiveLot("QUA-01");
      if (s !== "quarantine") await db.update(inventoryLots).set({ qualityStatus: s }).where(eq(inventoryLots.id, lot.id));
      lots[s] = { ...lot, qualityStatus: s };
    }
    for (const [s, lot] of Object.entries(lots)) {
      // movement to a released-stock bin
      await expectDomain(transferStock(wh, { lotId: lot.id, fromLocationId: qua.id, toLocationId: storage.id, qty: "1", reason: "try", idempotencyKey: randomUUID() }), "blocked_lot");
      await expectDomain(putAwayLot(wh, { lotRef: lot.lotNumber, locationRef: "A-01", idempotencyKey: randomUUID() }), "blocked_lot");
      // issue, dispense, allocation and shipment all use assertLotUsable
      expect(() => assertLotUsable(lot)).toThrow(DomainError);
      // the exception path (inventory.held_stock_issue.approve + reason)
      await expectDomain(issueHeldStock(wh, { lotRef: lot.lotNumber, fromLocationId: qua.id, qty: "10", purpose: "sampling", reason: "QC sample", idempotencyKey: randomUUID() }), "forbidden");
      const p = issueHeldStock(qa, { lotRef: lot.lotNumber, fromLocationId: qua.id, qty: "10", purpose: "sampling", reason: "QC retain sample", idempotencyKey: randomUUID() });
      if (s === "quarantine" || s === "on_hold") {
        const r = await p;
        expect(await onHand(lot.id, qua.id)).toBe("990.000000");
        expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.movementId), eq(auditEvents.action, "inventory.stock_movement.held_stock_issued")))).toHaveLength(1);
      } else {
        await expectDomain(p, "blocked_lot");
      }
    }
    await expectDomain(issueHeldStock(qa, { lotRef: lots.quarantine.lotNumber, fromLocationId: qua.id, qty: "10", purpose: "sampling", reason: "", idempotencyKey: randomUUID() }), "validation");
  });

  it("quality.disposition_only_qa: the owner and warehouse cannot approve a disposition", async () => {
    const lot = await receiveLot("QUA-01");
    await expectDomain(decideLot(owner, { lotId: lot.id, decision: "release", reason: "Owner wants it" }), "forbidden");
    await expectDomain(decideLot(wh, { lotId: lot.id, decision: "release", reason: "Warehouse wants it" }), "forbidden");
    expect(ROLE_BUNDLES.owner_director.permissions).not.toContain("quality.disposition.approve");
    expect(ROLE_BUNDLES.owner_director.permissions).toContain("inventory.held_stock_issue.approve");
  });
});

describe("expiry job (expiry_job.sets_expired)", () => {
  it("expires lots past their date and holds released lots at retest, as the system actor; idempotent", async () => {
    const expiring = await receiveLot("QUA-01");
    await db.update(inventoryLots).set({ qualityStatus: "released", expiresOn: future(5) }).where(eq(inventoryLots.id, expiring.id));
    const retest = await receiveLot("QUA-01");
    await db.update(inventoryLots).set({ qualityStatus: "released", retestOn: future(3) }).where(eq(inventoryLots.id, retest.id));
    const asOf = future(6);
    const r = await runExpiryCheck({ organizationId: orgId, asOf });
    expect(r.expired.map((x) => x.lotNumber)).toContain(expiring.lotNumber);
    expect(r.retestHeld.map((x) => x.lotNumber)).toContain(retest.lotNumber);
    expect(await status(expiring.id)).toBe("expired");
    expect(await status(retest.id)).toBe("on_hold");
    const [d] = await db.select().from(dispositions).where(and(eq(dispositions.subjectId, expiring.id), eq(dispositions.decision, "expire")));
    const [actor] = await db.select().from(users).where(eq(users.id, d.decidedBy));
    expect(actor).toMatchObject({ status: "system", email: "system@bryels-care.invalid" });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, expiring.id), eq(auditEvents.action, "quality.disposition.expired")))).toHaveLength(1);
    const again = await runExpiryCheck({ organizationId: orgId, asOf });
    expect(again.expired.some((x) => x.lotNumber === expiring.lotNumber)).toBe(false);
    // A lot expiring on asOf is still usable that day.
    const sameDay = await receiveLot("QUA-01");
    await db.update(inventoryLots).set({ expiresOn: asOf }).where(eq(inventoryLots.id, sameDay.id));
    await runExpiryCheck({ organizationId: orgId, asOf });
    expect(await status(sameDay.id)).toBe("quarantine");
  });

  it("exports the job handler for the registry and validates its payload", async () => {
    expect(expiryCheckJob.code).toBe("inventory.expiry_check");
    await expect(expiryHandler({ asOf: "not-a-date" })).rejects.toThrow();
    await expect(expiryHandler({ organizationId: orgId, unknown: 1 })).rejects.toThrow();
    const out = await expiryHandler({ organizationId: orgId });
    expect(out[0].organizationId).toBe(orgId);
  });
});
