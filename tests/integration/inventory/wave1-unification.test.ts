/**
 * Wave 1 integration: one settings store, one approval-decision ledger, scheduled reservation
 * expiry (ADR-028, ADR-029; docs/testing.md §4.2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, roles, settings, stockCountLines, stockReservations, userSiteAssignments } from "@/db/schema";
import { approveCount, createCount, recordCount, recordRecount, rejectCountLines, releaseCount, submitCount } from "@/modules/inventory/counts";
import { inventoryReservationExpiryJob } from "@/modules/inventory/jobs";
import { getInventorySetting } from "@/modules/inventory/policy";
import { createReservation } from "@/modules/inventory/reservations";
import { appJobRegistry } from "@/modules/platform/job-handlers";
import { enqueueJob, runJob, systemContext } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { auditCount, key, loadWorld, loc, makeLot, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("one settings store (platform `settings`)", () => {
  it("inventory policy keys keep their defaults and read site rows over organization rows", async () => {
    expect(await getInventorySetting(db, w.orgId, w.nfd.id, "inventory.count.recount_threshold_pct")).toBe(2);
    await db.insert(settings).values({ organizationId: w.orgId, scope: "organization", key: "inventory.count.recount_threshold_pct", value: 5 });
    await db.insert(settings).values({ organizationId: w.orgId, scope: "site", siteId: w.nfd.id, key: "inventory.count.recount_threshold_pct", value: 3 });
    // A stored value that does not validate falls back to the default, never widens anything.
    await db.insert(settings).values({ organizationId: w.orgId, scope: "organization", key: "inventory.reservation.ttl_hours", value: "forever" });
    try {
      expect(await getInventorySetting(db, w.orgId, w.nfd.id, "inventory.count.recount_threshold_pct")).toBe(3);
      expect(await getInventorySetting(db, w.orgId, w.rvs.id, "inventory.count.recount_threshold_pct")).toBe(5);
      expect(await getInventorySetting(db, w.orgId, w.nfd.id, "inventory.reservation.ttl_hours")).toBe(72);
    } finally {
      await db.delete(settings).where(eq(settings.organizationId, w.orgId));
    }
  });
});

describe("one approval-decision ledger (approval_decisions)", () => {
  it("a count sent back at the second step can be approved again by the same people in the next cycle", async () => {
    // Test setup: give operator.nfd the warehouse_operator role at NFD so a third person can recount.
    const [role] = await db.select().from(roles).where(and(eq(roles.organizationId, w.orgId), eq(roles.code, "warehouse_operator")));
    await db.insert(userSiteAssignments).values({ userId: w.whBoth.userId, roleId: role.id, siteId: w.nfd.id });
    const l = await loc(w.nfd.id, "PKG-01");
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "PKG-01", materialCode: "PKG-0101", qty: "1000" });
    const c = await createCount(w.manager, { countKind: "cycle", isBlind: true, locationIds: [l.id], counterUserIds: [w.wh.userId, w.wh2.userId, w.whBoth.userId] });
    await releaseCount(w.manager, c.id);
    for (const line of await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id))) {
      await recordCount(w.wh, { countId: c.id, locationId: l.id, lotId: line.lotId, qty: line.lotId === lot.id ? "900" : String(Number(line.expectedQtyBase)), idempotencyKey: key() });
    }
    await submitCount(w.wh, c.id);
    const lineA = (await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id))).find((x) => x.lotId === lot.id)!;
    await recordRecount(w.wh2, { lineId: lineA.id, qty: "950" });
    const reason = { lines: { [lineA.id]: { reasonCode: "unrecorded_issue" as const } } };
    expect((await approveCount(w.manager, c.id, reason)).status).toBe("pending_approval");
    await rejectCountLines(w.owner, c.id, { lineIds: [lineA.id], note: "Count the cartons once more" });
    await recordRecount(w.whBoth, { lineId: lineA.id, qty: "950" });
    expect((await approveCount(w.manager, c.id, reason)).status).toBe("pending_approval");
    expect((await approveCount(w.owner, c.id, { lines: {} })).status).toBe("approved");
    const rows = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "stock_count"), eq(approvalDecisions.recordId, c.id)));
    expect(rows.map((r) => [r.cycle, r.step, r.decision]).sort()).toEqual(
      [
        [1, 1, "approved"],
        [1, 2, "rejected"],
        [2, 1, "approved"],
        [2, 2, "approved"],
      ].sort(),
    );
    // Append-only (W1D trigger) for inventory decisions too.
    await expect(db.delete(approvalDecisions).where(eq(approvalDecisions.recordId, c.id))).rejects.toThrow();
  });
});

describe("inventory.reservation_expiry job (US-2-20)", () => {
  it("is scheduled, expires reservations past their TTL as the system actor with one audit each, and is idempotent", async () => {
    expect(appJobRegistry().get("inventory.reservation_expiry")).toBe(inventoryReservationExpiryJob);
    const a01 = await loc(w.nfd.id, "A-01");
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0061", qty: "100" });
    const r = await createReservation(w.manager, { lotId: lot.id, locationId: a01.id, qty: "10", demandType: "manual", demandReference: "Trial", idempotencyKey: key() });
    const keep = await createReservation(w.manager, { lotId: lot.id, locationId: a01.id, qty: "10", demandType: "manual", demandReference: "Keep", idempotencyKey: key() });
    await db.update(stockReservations).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(stockReservations.id, r.id));
    const sys = await systemContext(w.orgId, inventoryReservationExpiryJob);
    const { job } = await enqueueJob(db, sys, inventoryReservationExpiryJob, inventoryReservationExpiryJob.schedule!.payload(new Date()));
    expect(await runJob(job.id)).toMatchObject({ status: "succeeded", result: { expired: 1, reservations: [r.reservationNumber] } });
    const [after] = await db.select().from(stockReservations).where(eq(stockReservations.id, r.id));
    expect(after).toMatchObject({ status: "expired", releasedReason: "ttl_elapsed" });
    const [kept] = await db.select().from(stockReservations).where(eq(stockReservations.id, keep.id));
    expect(kept.status).toBe("active");
    expect(await auditCount("inventory.stock_reservation.expired", r.id)).toBe(1);
    const { job: again } = await enqueueJob(db, sys, inventoryReservationExpiryJob, { asOf: new Date(Date.now() + 120_000).toISOString() });
    expect(await runJob(again.id)).toMatchObject({ status: "succeeded", result: { expired: 0 } });
  });
});
