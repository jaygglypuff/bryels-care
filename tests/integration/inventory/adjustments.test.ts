/** US-2-19 stock adjustments as approvable documents (inventory.adjustment_post_requires_approval, authz.sod.approve_own). */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots, materials, stockAdjustmentLines, stockMovements } from "@/db/schema";
import { approveAdjustment, cancelAdjustment, createAdjustment, getAdjustment, postAdjustment, rejectAdjustment, submitAdjustment } from "@/modules/inventory/adjustments";
import { createCount, releaseCount, cancelCount } from "@/modules/inventory/counts";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("stock adjustments (US-2-19)", () => {
  it("draft → submit → approve (not by the submitter) → post: one adjustment movement per line with the header reason", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "1000" });
    const b01 = await loc(w.nfd.id, "B-01");
    const a = await createAdjustment(w.wh, {
      reasonCode: "damaged",
      reasonNote: "Drum dented, contents leaked",
      lines: [
        { lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "120", unitCost: "0.10" },
        { lotId: lot.id, locationId: b01.id, direction: "increase", qty: "20", unitCost: "0.10" },
      ],
      idempotencyKey: key(),
    });
    expect(a.adjustmentNumber).toMatch(/^ADJ-\d{2}-\d{5}$/);
    // An unapproved adjustment can never post.
    await expectDomain(postAdjustment(w.manager, a.id, key()), "state");
    const sub = await submitAdjustment(w.wh, a.id);
    expect(sub.requiresSecondApproval).toBe(false);
    await expectDomain(postAdjustment(w.manager, a.id, key()), "state");
    // The submitter cannot approve (and lacks the permission anyway).
    await expectDomain(approveAdjustment(w.wh, a.id), "forbidden");
    const self = await createAdjustment(w.manager, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: b01.id, direction: "increase", qty: "1" }], idempotencyKey: key() });
    await submitAdjustment(w.manager, self.id);
    await expectDomain(approveAdjustment(w.manager, self.id), "separation_of_duties");
    await cancelAdjustment(w.manager, self.id, "test only");

    const ap = await approveAdjustment(w.manager, a.id, "Checked the drum");
    expect(ap.status).toBe("approved");
    const k = key();
    const p = await postAdjustment(w.manager, a.id, k);
    expect(p.movements).toHaveLength(2);
    expect((await postAdjustment(w.manager, a.id, k)).replayed).toBe(true);
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, a.id));
    expect(mv.every((m) => m.movementType === "adjustment" && m.sourceDocumentType === "stock_adjustment" && m.reason?.startsWith("damaged"))).toBe(true);
    expect(await onHand(lot.id, b01.id)).toBe("900");
    for (const ev of ["inventory.stock_adjustment.submitted", "inventory.stock_adjustment.approved", "inventory.stock_adjustment.posted"]) expect(await auditCount(ev, a.id)).toBe(1);
    await expectDomain(postAdjustment(w.manager, a.id, key()), "state");
  });

  it("authz.threshold.rule_evaluation: above the value threshold an owner_director second step by another person is required", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0062", qty: "10000" });
    const b01 = await loc(w.nfd.id, "B-01");
    const a = await createAdjustment(w.wh, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "5000", unitCost: "5.00" }], idempotencyKey: key() });
    const sub = await submitAdjustment(w.wh, a.id);
    expect(sub.requiresSecondApproval).toBe(true);
    const s1 = await approveAdjustment(w.manager, a.id);
    expect(s1.awaitingSecondStep).toBe(true);
    await expectDomain(postAdjustment(w.manager, a.id, key()), "state");
    await expectDomain(approveAdjustment(w.manager, a.id), "forbidden");
    const s2 = await approveAdjustment(w.owner, a.id);
    expect(s2.status).toBe("approved");
    await expectDomain(postAdjustment(w.owner, a.id, key()), "separation_of_duties");
    await postAdjustment(w.manager, a.id, key());
    expect(await onHand(lot.id, b01.id)).toBe("5000");
  });

  it("rejects with a reason; found stock creates a new lot on QA hold; frozen locations refuse posting", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-02", materialCode: "MAT-0013", qty: "100" });
    const a02 = await loc(w.nfd.id, "A-02");
    const r = await createAdjustment(w.wh, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: a02.id, direction: "increase", qty: "5" }], idempotencyKey: key() });
    await submitAdjustment(w.wh, r.id);
    await expectDomain(rejectAdjustment(w.manager, r.id, ""), "validation");
    await rejectAdjustment(w.manager, r.id, "Not found on recheck");
    expect((await getAdjustment(w.manager, r.id)).status).toBe("rejected");

    // Found unlabelled stock needs inventory.lot.create (site manager), the lot is created at posting on hold.
    const [mat] = await db.select().from(materials).where(eq(materials.code, "MAT-0061"));
    await expectDomain(createAdjustment(w.wh, { reasonCode: "found_unlabelled", lines: [{ locationId: a02.id, direction: "increase", qty: "300", newLot: { materialId: mat.id } }], idempotencyKey: key() }), "forbidden");
    const f = await createAdjustment(w.manager, { reasonCode: "found_unlabelled", reasonNote: "Pail behind rack", lines: [{ locationId: a02.id, direction: "increase", qty: "300", newLot: { materialId: mat.id } }], idempotencyKey: key() });
    await submitAdjustment(w.manager, f.id);
    const owner = w.owner;
    await approveAdjustment(owner, f.id);

    // Freeze A-02 with a released count: posting is refused (V-FREEZE).
    const c = await createCount(w.manager, { countKind: "spot", isBlind: true, locationIds: [a02.id], counterUserIds: [] });
    await releaseCount(w.manager, c.id);
    await expectDomain(postAdjustment(w.manager, f.id, key()), "conflict");
    await cancelCount(w.manager, c.id, "test done");
    await postAdjustment(w.manager, f.id, key());
    const [line] = await db.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.stockAdjustmentId, f.id));
    const [newLot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, line.lotId!));
    expect(newLot.qualityStatus).toBe("on_hold");
    expect(await onHand(newLot.id, a02.id)).toBe("300");
  });

  it("authz.cross_site: another site's adjustment is not found; the auditor cannot draft", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0012", qty: "10" });
    const a = await createAdjustment(w.wh, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: (await loc(w.nfd.id, "A-01")).id, direction: "decrease", qty: "1" }], idempotencyKey: key() });
    await expectDomain(getAdjustment(w.whRvs, a.id), "not_found");
    await expectDomain(submitAdjustment(w.whRvs, a.id), "not_found");
    await expectDomain(createAdjustment(w.auditor, { reasonCode: "lost", lines: [], idempotencyKey: key() }), "forbidden");
    // A lot of another site cannot be put on this site's adjustment.
    const rvsLot = await makeLot(w.owner, { siteId: w.rvs.id, locCode: "FG-01", productSku: "ACS-135", qty: "5" });
    await expectDomain(createAdjustment(w.wh, { reasonCode: "lost", lines: [{ lotId: rvsLot.id, locationId: (await loc(w.nfd.id, "A-01")).id, direction: "decrease", qty: "1" }], idempotencyKey: key() }), "validation");
  });
});
