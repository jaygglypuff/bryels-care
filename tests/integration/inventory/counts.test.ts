/** US-2-17 count plan/release/freeze, US-2-18 capture, recount, variance approval, posting. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { AuthContext } from "@/lib/auth/context";
import { stockCountEntries, stockCountLines, stockCounts, stockMovements } from "@/db/schema";
import { approveCount, cancelCount, createCount, getCount, postCount, recordCount, recordRecount, rejectCountLines, releaseCount, submitCount } from "@/modules/inventory/counts";
import { scanMove } from "@/modules/inventory/moves";
import { transferStock } from "@/modules/inventory/movements";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, key, loadWorld, loc, makeLot, onHand, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

/** A fresh count over PKG-01 (or another location) with two lots and both NFD operators as counters. */
async function plannedCount(code = "PKG-01") {
  const l = await loc(w.nfd.id, code);
  const lotA = await makeLot(w.owner, { siteId: w.nfd.id, locCode: code, materialCode: "PKG-0101", qty: "1000" });
  const lotB = await makeLot(w.owner, { siteId: w.nfd.id, locCode: code, materialCode: "PKG-0102", qty: "200" });
  const c = await createCount(w.manager, { countKind: "cycle", isBlind: true, locationIds: [l.id], counterUserIds: [w.wh.userId, w.wh2.userId] });
  return { l, lotA, lotB, c };
}

describe("count plan, release and freeze (US-2-17)", () => {
  it("statemachine: planned → in_progress snapshots expected quantities and freezes the location (concurrency.count_freeze_blocks_posting)", async () => {
    const { l, lotA, c } = await plannedCount("PKG-01");
    const r = await releaseCount(w.manager, c.id);
    expect(r.lines).toBeGreaterThanOrEqual(2);
    const lines = await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    expect(lines.find((x) => x.lotId === lotA.id)?.expectedQtyBase).toBe("1000.000000");
    const e = await expectDomain(scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lotA.id, fromLocationId: l.id, qty: "1" }, toLocationId: (await loc(w.nfd.id, "A-01")).id }), "conflict");
    expect(e.message).toContain("V-FREEZE");
    await expectDomain(transferStock(w.wh, { lotId: lotA.id, fromLocationId: l.id, toLocationId: (await loc(w.nfd.id, "A-01")).id, qty: "1", reason: "test", idempotencyKey: key() }), "conflict");
    await expectDomain(releaseCount(w.manager, c.id), "state");
    // Cancel needs a reason and unfreezes.
    await expectDomain(cancelCount(w.manager, c.id, ""), "validation");
    await expectDomain(cancelCount(w.wh, c.id, "no rights"), "forbidden");
    await cancelCount(w.manager, c.id, "Wrong scope chosen");
    const ok = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lotA.id, fromLocationId: l.id, qty: "1" }, toLocationId: (await loc(w.nfd.id, "A-01")).id });
    expect(ok.alreadyMoved).toBe(false);
    expect(await auditCount("inventory.stock_count.released", c.id)).toBe(1);
    expect(await auditCount("inventory.stock_count.cancelled", c.id)).toBe(1);
  });

  it("blind: counters do not see expected quantities while counting; a non-counter approver does", async () => {
    const { c } = await plannedCount("B-01");
    await releaseCount(w.manager, c.id);
    const asCounter = await getCount(w.wh, c.id);
    expect(asCounter.lines.every((l) => l.expected === null)).toBe(true);
    const asManager = await getCount(w.manager, c.id);
    expect(asManager.lines.some((l) => l.expected !== null)).toBe(true);
    await cancelCount(w.manager, c.id, "test done");
  });

  it("authz.cross_site: a Site B user cannot see or release a Site A count", async () => {
    const { c } = await plannedCount("A-02");
    await expectDomain(getCount(w.whRvs, c.id), "not_found");
    await expectDomain(releaseCount(w.whRvs, c.id), "not_found");
    await expectDomain(createCount(w.auditor, { countKind: "cycle", isBlind: true, locationIds: [(await loc(w.nfd.id, "A-02")).id], counterUserIds: [] }), "forbidden");
    await cancelCount(w.manager, c.id, "test done");
  });
});

describe("count capture, recount, approval and posting (US-2-18)", () => {
  it("count.original_retained, sod.count.recounter_not_counter, approver not a counter, count.adjustment_links_count", async () => {
    const { l, lotA, lotB, c } = await plannedCount("FG-01");
    await releaseCount(w.manager, c.id);
    const lines = await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    // Count every expected line: lotA short by 100 (10 % → recount), lotB exact, others exact.
    for (const line of lines) {
      const qty = line.lotId === lotA.id ? "900" : String(Number(line.expectedQtyBase));
      await recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: line.lotId, qty, idempotencyKey: key() });
    }
    // An unlabelled find is recorded as such.
    await recordCount(w.wh, { countId: c.id, locationId: l.id, unlabelledDescription: "White pail, no label, about 5 kg", qty: "1", idempotencyKey: key() });
    // Users outside the counter list cannot count.
    await expectDomain(recordCount(w.whBoth, { countId: c.id, locationId: l.id, lotId: lotB.id, qty: "200", idempotencyKey: key() }), "forbidden");
    const sub = await submitCount(w.wh, c.id);
    expect(sub.status).toBe("recount");
    const lineA = (await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id))).find((x) => x.lotId === lotA.id)!;
    expect(lineA.lineStatus).toBe("recount_required");
    // Same counter recount → 409 SoD.
    await expectDomain(recordRecount(w.wh, { lineId: lineA.id, qty: "900" }), "separation_of_duties");
    const rr = await recordRecount(w.wh2, { lineId: lineA.id, qty: "950" });
    expect(rr.status).toBe("counted");
    const entries = await db.select().from(stockCountEntries).where(eq(stockCountEntries.stockCountLineId, lineA.id));
    expect(entries.map((e) => [e.entryKind, String(Number(e.qtyBase)), e.countedBy]).sort()).toEqual(
      [
        ["count", "900", w.wh.userId],
        ["recount", "950", w.wh2.userId],
      ].sort(),
    );
    // A counter cannot approve.
    const m = w.manager;
    const wh2AsManager = new AuthContext(w.wh2.userId, m.organizationId, "Counter as manager", "x@test", ["site_manager"], m.permissions, m.allowedSites, m.currentSiteId);
    await expectDomain(approveCount(wh2AsManager, c.id, { lines: {} }), "separation_of_duties");
    // Reason code required on the variant line.
    await expectDomain(approveCount(w.manager, c.id, { lines: {} }), "validation");
    const step1 = await approveCount(w.manager, c.id, { lines: { [lineA.id]: { reasonCode: "unrecorded_issue", note: "Sample pulled without posting" } } });
    // 5 % variance > 2 % second-step threshold → owner_director second step.
    expect(step1.status).toBe("pending_approval");
    await expectDomain(postCount(w.manager, c.id, key()), "state");
    await expectDomain(approveCount(w.manager, c.id, { lines: {} }), "forbidden");
    const step2 = await approveCount(w.owner, c.id, { lines: {} });
    expect(step2.status).toBe("approved");
    // Above the threshold the final approver may not post.
    await expectDomain(postCount(w.owner, c.id, key()), "separation_of_duties");
    const k = key();
    const posted = await postCount(w.manager, c.id, k);
    expect(posted.movements).toBe(1);
    const again = await postCount(w.manager, c.id, k);
    expect(again.replayed).toBe(true);
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, c.id));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("adjustment");
    expect(mv[0].sourceDocumentType).toBe("stock_count");
    expect(mv[0].reason).toBe("unrecorded_issue");
    expect(await onHand(lotA.id, l.id)).toBe("950");
    const [after] = await db.select().from(stockCounts).where(eq(stockCounts.id, c.id));
    expect(after.status).toBe("posted");
    expect(await auditCount("inventory.stock_count.variance_approved", c.id)).toBe(2);
    expect(await auditCount("inventory.stock_count.posted", c.id)).toBe(1);
    // Unfrozen after posting.
    const ok = await scanMove(w.wh, { idempotencyKey: key(), source: { kind: "lot", lotId: lotB.id, fromLocationId: l.id, qty: "1" }, toLocationId: (await loc(w.nfd.id, "A-01")).id });
    expect(ok.alreadyMoved).toBe(false);
  });

  it("small variance within the recount threshold needs one approval; rejecting sends lines back to recount", async () => {
    const { l, lotA, c } = await plannedCount("HLD-01");
    await releaseCount(w.manager, c.id);
    const lines = await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    for (const line of lines) {
      const qty = line.lotId === lotA.id ? "990" : String(Number(line.expectedQtyBase));
      await recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: line.lotId, qty, idempotencyKey: key() });
    }
    expect((await submitCount(w.wh, c.id)).status).toBe("counted");
    const lineA = (await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id))).find((x) => x.lotId === lotA.id)!;
    await rejectCountLines(w.manager, c.id, { lineIds: [lineA.id], note: "Recount the wrappers" });
    await recordRecount(w.wh2, { lineId: lineA.id, qty: "995" });
    const r = await approveCount(w.manager, c.id, { lines: { [lineA.id]: { reasonCode: "data_entry" } } });
    expect(r.status).toBe("approved");
    // Below the threshold the approver may post (A-PM-10).
    await postCount(w.manager, c.id, key());
    expect(await onHand(lotA.id, l.id)).toBe("995");
  });

  it("submitting with uncounted expected lines is refused", async () => {
    const { c } = await plannedCount("REJ");
    await releaseCount(w.manager, c.id);
    await expectDomain(submitCount(w.wh, c.id), "validation");
    await cancelCount(w.manager, c.id, "test done");
  });
});
