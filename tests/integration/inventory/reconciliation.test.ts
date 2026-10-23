/**
 * US-2-04 nightly reconciliation and projection rebuild (docs/data-model.md §5.6, runbook §9):
 * ledger.projection.matches_ledger over 500 random postings across two sites, injected mismatch →
 * critical notifications and a reconciliation_runs row with the report, nothing corrected; the
 * rebuild job recomputes the projection and is audited; authorization negatives.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, inventoryBalances, notifications, reconciliationRuns, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement, type MovementType } from "@/modules/inventory/ledger";
import { inventoryReconcileJob } from "@/modules/inventory/jobs";
import { findLedgerDifferences, requestBalanceRebuild, requestReconciliation } from "@/modules/inventory/reconciliation";
import { reverseMovement } from "@/modules/inventory/reversal";
import { enqueueJob, runJob, systemContext } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot, onHand } from "../../support/kit";

let kit: Kit;
let whNfd: AuthContext;
let whRvs: AuthContext;
let manager: AuthContext;
let owner: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  whNfd = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
});

let runSeq = 0;
/** On-demand runs are keyed per minute; each call here uses its own (fictional) minute so it really runs. */
async function reconcileNow() {
  const ctx = await systemContext(kit.orgId, inventoryReconcileJob);
  const asOf = new Date(Date.UTC(2026, 0, 1, 0, runSeq++)).toISOString();
  const { job } = await enqueueJob(db, ctx, inventoryReconcileJob, { siteId: null, asOf, trigger: "manual" });
  const out = await runJob(job.id);
  expect(out.status).toBe("succeeded");
  return (out as { result: { runId: string; differencesCount: number; status: string } }).result;
}

describe("ledger.projection.matches_ledger", () => {
  it("500 random postings across two sites (receipt, transfer, consumption, output, shipment, reversal) reconcile to zero differences", async () => {
    const nfdLocs = await Promise.all(["A-01", "A-02", "B-01", "PRD-01"].map((c) => loc(kit.nfd.id, c)));
    const rvsLocs = await Promise.all(["FG-01", "SHP", "QUA-01"].map((c) => loc(kit.rvs.id, c)));
    const sites = [
      { ctx: whNfd, siteId: kit.nfd.id, locs: nfdLocs, lots: [] as string[] },
      { ctx: whRvs, siteId: kit.rvs.id, locs: rvsLocs, lots: [] as string[] },
    ];
    for (const s of sites) for (let i = 0; i < 4; i++) s.lots.push((await makeLot(s.ctx, s.siteId, s.locs[0].id, "5000")).id);
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const types: MovementType[] = ["receipt", "transfer", "consumption", "output", "shipment", "transfer", "transfer"];
    const transfers: string[] = [];
    let posted = 0;
    for (let i = 0; i < 500; i++) {
      const s = sites[rnd(2)];
      const lotId = s.lots[rnd(s.lots.length)];
      const from = s.locs[rnd(s.locs.length)];
      let to = s.locs[rnd(s.locs.length)];
      if (to.id === from.id) to = s.locs[(s.locs.indexOf(from) + 1) % s.locs.length];
      const t = types[rnd(types.length)];
      const qty = String(1 + rnd(50));
      try {
        if (i % 25 === 24 && transfers.length) {
          await reverseMovement(manager, { movementId: transfers.pop()!, reason: "random reversal", confirmation: "REVERSE", idempotencyKey: randomUUID() });
        } else {
          const sides = t === "transfer" ? { fromLocationId: from.id, toLocationId: to.id } : t === "receipt" || t === "output" ? { toLocationId: to.id } : { fromLocationId: from.id };
          const { movement } = await db.transaction((tx) => postMovement(tx, s.ctx, { movementType: t, lotId, qtyBase: qty, ...sides, sourceDocumentType: "test" }));
          if (t === "transfer" && s.siteId === kit.nfd.id) transfers.push(movement.id);
        }
        posted++;
      } catch (e) {
        expect((e as { code?: string }).code).toBe("insufficient_stock");
      }
    }
    expect(posted).toBeGreaterThan(350);
    expect(await findLedgerDifferences(db, { organizationId: kit.orgId })).toEqual([]);
    const r = await reconcileNow();
    expect(r.status).toBe("clean");
    expect(r.differencesCount).toBe(0);
  });
});

describe("drift is reported, never auto-fixed", () => {
  it("an injected mismatch → critical notifications to system_admin and the site's site_manager, a run row with the report, nothing corrected; the rebuild fixes it and is audited", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(whNfd, kit.nfd.id, a01.id, "250");
    // Simulate a projection fault (a bug or a manual SQL edit): the balance no longer equals the ledger.
    await db.update(inventoryBalances).set({ qtyBase: "245" }).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, a01.id)));

    const r = await reconcileNow();
    expect(r.status).toBe("differences");
    expect(r.differencesCount).toBe(1);
    const [run] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, r.runId));
    expect(run.report).toEqual([expect.objectContaining({ lotId: lot.id, locationId: a01.id, ledgerQty: "250", projectedQty: "245" })]);
    expect(await onHand(lot.id, a01.id)).toBe("245"); // nothing corrected

    const recipients = await db
      .select({ email: users.email, severity: notifications.severity })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.recipientUserId))
      .where(eq(notifications.entityId, r.runId));
    const emails = recipients.map((x) => x.email).sort();
    expect(emails).toContain("admin@bryels-care.test");
    expect(emails).toContain("manager.nfd@bryels-care.test");
    expect(emails).not.toContain("warehouse.nfd@bryels-care.test");
    expect(recipients.every((x) => x.severity === "critical")).toBe(true);

    // Rebuild on demand (inventory.balance.admin), keyed by the run.
    await expectCode(requestBalanceRebuild(whNfd, { siteId: kit.nfd.id, reconciliationRunId: r.runId, reason: "fix" }), "forbidden");
    const { job } = await requestBalanceRebuild(manager, { siteId: kit.nfd.id, reconciliationRunId: r.runId, reason: "Confirmed projection fault" });
    expect(job.payload).toMatchObject({ lotIds: [lot.id] });
    const out = await runJob(job.id);
    expect(out.status).toBe("succeeded");
    expect(await onHand(lot.id, a01.id)).toBe("250");
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.action, "inventory.inventory_balance.rebuilt"));
    expect(ev.actorLabel).toBe("system:inventory.rebuild_balances");
    expect(ev.onBehalfOf).toBe(manager.userId);
    expect(ev.reason).toBe("Confirmed projection fault");
    expect((await reconcileNow()).status).toBe("clean");
  });

  it("a rebuild with nothing to fix changes nothing (idempotent by construction)", async () => {
    const { job } = await requestBalanceRebuild(manager, { siteId: kit.nfd.id, reason: "routine check" });
    const out = await runJob(job.id);
    expect((out as { result: { keysRebuilt: number } }).result.keysRebuilt).toBe(0);
  });

  it("authz.cross_site.body: a rebuild or reconciliation request for another site is not_found", async () => {
    await expectCode(requestBalanceRebuild(manager, { siteId: kit.rvs.id, reason: "other site" }), "not_found");
    await expectCode(requestReconciliation(manager, { siteId: kit.rvs.id }), "not_found");
  });

  it("the owner can request a reconciliation; the duplicate within the same minute is the same job", async () => {
    const a = await requestReconciliation(owner, { siteId: kit.nfd.id });
    const b = await requestReconciliation(owner, { siteId: kit.nfd.id });
    expect(b.job.id).toBe(a.job.id);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(reconciliationRuns);
    expect(count.n).toBeGreaterThan(0);
  });
});
