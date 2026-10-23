import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import { inventoryBalances, inventoryLots, reconciliationRuns } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { JobRunContext } from "@/modules/platform/job-definition";
import { enqueueJob } from "@/modules/platform/jobs";
import { notifyRoles } from "@/modules/platform/notifications";
import { inventoryRebuildBalancesJob, inventoryReconcileJob } from "./jobs";
import { lockLots } from "./ledger";

export type LedgerDifference = {
  siteId: string;
  lotId: string;
  locationId: string;
  lotNumber: string | null;
  locationCode: string | null;
  ledgerQty: string;
  projectedQty: string;
};

const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/**
 * Ledger vs projection (docs/data-model.md §5.6, adapted to the current balance key
 * lot × location; containers arrive with US-2-15). Returns one row per key whose projection
 * differs from the sum of the ledger. Read-only: never corrects anything.
 */
export async function findLedgerDifferences(q: DbOrTx, f: { organizationId: string; siteIds?: string[]; lotIds?: string[] }): Promise<LedgerDifference[]> {
  if (f.siteIds && f.siteIds.length === 0) return [];
  if (f.lotIds && f.lotIds.length === 0) return [];
  const mFilter = sql.join(
    [
      sql`m.organization_id = ${f.organizationId}`,
      f.siteIds ? sql`m.site_id in (${uuidList(f.siteIds)})` : sql`true`,
      f.lotIds ? sql`m.lot_id in (${uuidList(f.lotIds)})` : sql`true`,
    ],
    sql` and `,
  );
  const bFilter = sql.join(
    [
      sql`l.organization_id = ${f.organizationId}`,
      f.siteIds ? sql`b.site_id in (${uuidList(f.siteIds)})` : sql`true`,
      f.lotIds ? sql`b.lot_id in (${uuidList(f.lotIds)})` : sql`true`,
    ],
    sql` and `,
  );
  const rows = await q.execute<{ site_id: string; lot_id: string; location_id: string; lot_number: string | null; location_code: string | null; ledger_qty: string; projected_qty: string }>(sql`
    with ledger as (
      select site_id, lot_id, location_id, sum(delta) as qty from (
        select m.site_id, m.lot_id, m.to_location_id as location_id, m.qty_base as delta
          from stock_movements m where m.to_location_id is not null and ${mFilter}
        union all
        select m.site_id, m.lot_id, m.from_location_id, -m.qty_base
          from stock_movements m where m.from_location_id is not null and ${mFilter}
      ) x group by 1, 2, 3
    ), projection as (
      select b.site_id, b.lot_id, b.location_id, sum(b.qty_base) as qty
        from inventory_balances b join inventory_lots l on l.id = b.lot_id
       where ${bFilter}
       group by 1, 2, 3
    ), diff as (
      select coalesce(l.site_id, p.site_id) as site_id, coalesce(l.lot_id, p.lot_id) as lot_id,
             coalesce(l.location_id, p.location_id) as location_id,
             coalesce(l.qty, 0) as ledger_qty, coalesce(p.qty, 0) as projected_qty
        from ledger l
        full outer join projection p on p.site_id = l.site_id and p.lot_id = l.lot_id and p.location_id = l.location_id
       where coalesce(l.qty, 0) <> coalesce(p.qty, 0)
    )
    select d.site_id, d.lot_id, d.location_id, lot.lot_number, loc.code as location_code,
           d.ledger_qty::text as ledger_qty, d.projected_qty::text as projected_qty
      from diff d
      left join inventory_lots lot on lot.id = d.lot_id
      left join locations loc on loc.id = d.location_id
     order by lot.lot_number, loc.code`);
  return rows.map((r) => ({
    siteId: r.site_id,
    lotId: r.lot_id,
    locationId: r.location_id,
    lotNumber: r.lot_number,
    locationCode: r.location_code,
    ledgerQty: new Decimal(r.ledger_qty).toString(),
    projectedQty: new Decimal(r.projected_qty).toString(),
  }));
}

const manilaDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export type ReconcilePayload = { siteId: string | null; asOf: string; trigger: "schedule" | "manual" };

/**
 * Body of the `inventory.reconcile` job: compares ledger and projection for the site (or every
 * site), records a reconciliation_runs row with the report and, when there are differences,
 * raises a critical notification to system_admin and the affected sites' site_manager. Nothing
 * is corrected; a person decides on a rebuild (runbook §9).
 */
export async function runReconciliation(run: Pick<JobRunContext, "ctx" | "job" | "asOf">, payload: ReconcilePayload) {
  const { ctx } = run;
  ctx.require("inventory.balance.view");
  if (payload.siteId) ctx.requireSite(payload.siteId);
  const siteIds = payload.siteId ? [payload.siteId] : ctx.allowedSiteIds;
  const diffs = await findLedgerDifferences(db, { organizationId: ctx.organizationId, siteIds });
  return db.transaction(async (tx) => {
    const [runRow] = await tx
      .insert(reconciliationRuns)
      .values({
        organizationId: ctx.organizationId,
        siteId: payload.siteId,
        kind: "inventory_balances",
        status: diffs.length ? "differences" : "clean",
        asOf: new Date(payload.asOf),
        differencesCount: diffs.length,
        report: diffs,
        backgroundJobId: run.job.id,
        triggeredBy: run.job.requestedBy,
      })
      .returning();
    let notified: string[] = [];
    if (diffs.length) {
      const affected = [...new Set(diffs.map((d) => d.siteId))];
      const n = {
        organizationId: ctx.organizationId,
        kind: "reconciliation_difference",
        severity: "critical" as const,
        title: `Stock ledger and balances differ (${diffs.length} ${diffs.length === 1 ? "key" : "keys"})`,
        body: `The ${payload.trigger === "schedule" ? "nightly" : "on-demand"} reconciliation found ${diffs.length} lot/location balance(s) that do not equal the ledger. Nothing was changed. Review the report and decide on a rebuild (runbook §9).`,
        entityType: "reconciliation_run",
        entityId: runRow.id,
        link: `/admin/diagnostics?run=${runRow.id}#reconciliation`,
        dedupeKey: `reconciliation:${runRow.id}`,
      };
      notified = await notifyRoles(tx, { roleCodes: ["system_admin"] }, n);
      for (const s of affected) notified.push(...(await notifyRoles(tx, { roleCodes: ["site_manager"], siteId: s }, { ...n, siteId: s })));
      notified = [...new Set(notified)];
      await tx.update(reconciliationRuns).set({ notifiedUserIds: notified }).where(eq(reconciliationRuns.id, runRow.id));
    }
    return { runId: runRow.id, status: runRow.status, differencesCount: diffs.length, notifiedCount: notified.length };
  });
}

export type RebuildPayload = { siteId: string; reconciliationRunId: string | null; lotIds: string[] | null; reason: string };

export function rebuildKeysHash(p: Pick<RebuildPayload, "lotIds">) {
  return createHash("sha256")
    .update(JSON.stringify([...(p.lotIds ?? ["*"])].sort()))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Body of `inventory.rebuild_balances`: recomputes the projection rows of the site (optionally a
 * lot set) from the ledger under the posting lock order (lots → balances), writes a `rebuild`
 * reconciliation run with before/after per changed key, and audits
 * `inventory.inventory_balance.rebuilt`. Never touches the ledger. Running it twice changes
 * nothing the second time (idempotent by construction).
 */
export async function rebuildBalances(run: Pick<JobRunContext, "ctx" | "job">, payload: RebuildPayload) {
  const { ctx } = run;
  ctx.require("inventory.balance.admin");
  ctx.requireSite(payload.siteId);
  return db.transaction(async (tx) => {
    const lotConds = [eq(inventoryLots.siteId, payload.siteId), eq(inventoryLots.organizationId, ctx.organizationId)];
    if (payload.lotIds) lotConds.push(inArray(inventoryLots.id, payload.lotIds.length ? payload.lotIds : ["00000000-0000-0000-0000-000000000000"]));
    const scoped = await tx.select({ id: inventoryLots.id }).from(inventoryLots).where(and(...lotConds));
    const lotIds = scoped.map((l) => l.id);
    await lockLots(tx, lotIds);
    const changes: { lotId: string; locationId: string; lotNumber: string | null; locationCode: string | null; before: string; after: string }[] = [];
    if (lotIds.length) {
      await tx.select({ id: inventoryBalances.id }).from(inventoryBalances).where(inArray(inventoryBalances.lotId, lotIds)).orderBy(asc(inventoryBalances.id)).for("update");
      const diffs = await findLedgerDifferences(tx, { organizationId: ctx.organizationId, lotIds });
      for (const d of diffs) {
        const target = new Decimal(d.ledgerQty);
        if (target.isNegative()) {
          throw new DomainError("conflict", `The ledger of lot ${d.lotNumber} at ${d.locationCode} sums to ${d.ledgerQty}; the ledger itself needs investigation before any rebuild.`);
        }
        if (d.siteId !== payload.siteId) {
          // A projection row carrying the wrong site for its lot: zero it (the ledger row with the lot's site is fixed below).
          await tx.update(inventoryBalances).set({ qtyBase: "0", updatedAt: new Date() }).where(and(eq(inventoryBalances.lotId, d.lotId), eq(inventoryBalances.locationId, d.locationId)));
        } else {
          await tx
            .insert(inventoryBalances)
            .values({ siteId: d.siteId, lotId: d.lotId, locationId: d.locationId, qtyBase: target.toString() })
            .onConflictDoUpdate({ target: [inventoryBalances.lotId, inventoryBalances.locationId], set: { qtyBase: target.toString(), siteId: d.siteId, updatedAt: new Date() } });
        }
        changes.push({ lotId: d.lotId, locationId: d.locationId, lotNumber: d.lotNumber, locationCode: d.locationCode, before: d.projectedQty, after: d.ledgerQty });
      }
    }
    const [runRow] = await tx
      .insert(reconciliationRuns)
      .values({
        organizationId: ctx.organizationId,
        siteId: payload.siteId,
        kind: "rebuild",
        status: "rebuilt",
        asOf: new Date(),
        differencesCount: changes.length,
        report: changes,
        backgroundJobId: run.job.id,
        sourceRunId: payload.reconciliationRunId,
        triggeredBy: run.job.requestedBy,
      })
      .returning();
    await audit(tx, ctx, {
      action: "inventory.inventory_balance.rebuilt",
      entityType: "reconciliation_run",
      entityId: runRow.id,
      siteId: payload.siteId,
      reason: payload.reason,
      before: { keys: changes.map((c) => ({ lotNumber: c.lotNumber, locationCode: c.locationCode, qty: c.before })) },
      after: { keysRebuilt: changes.length, lotsChecked: lotIds.length, keys: changes.map((c) => ({ lotNumber: c.lotNumber, locationCode: c.locationCode, qty: c.after })) },
    });
    return { runId: runRow.id, keysRebuilt: changes.length, lotsChecked: lotIds.length };
  });
}

// ---- user commands ---------------------------------------------------------------------------

/** inventory.balance.admin: run the reconciliation now for one site (the nightly run covers every site). */
export async function requestReconciliation(ctx: AuthContext, input: { siteId: string }) {
  ctx.require("inventory.balance.admin");
  ctx.requireSite(input.siteId);
  const asOf = new Date();
  asOf.setSeconds(0, 0);
  return enqueueJob(db, ctx, inventoryReconcileJob, { siteId: input.siteId, asOf: asOf.toISOString(), trigger: "manual" }, { siteId: input.siteId });
}

/**
 * inventory.balance.admin: enqueue a keyed projection rebuild after a reconciliation difference
 * was confirmed to be a projection fault. With a run id and no lot list, the lots of that run's
 * differences at this site are rebuilt.
 */
export async function requestBalanceRebuild(ctx: AuthContext, input: { siteId: string; reconciliationRunId?: string | null; lotIds?: string[] | null; reason: string }) {
  ctx.require("inventory.balance.admin");
  ctx.requireSite(input.siteId);
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new DomainError("validation", "Say why the balances are being rebuilt (at least 3 characters).", { field: "reason" });
  let lotIds = input.lotIds?.length ? [...new Set(input.lotIds)].sort() : null;
  if (input.reconciliationRunId) {
    const r = await getReconciliationRun(ctx, input.reconciliationRunId);
    if (r.kind !== "inventory_balances") throw new DomainError("validation", "Choose a reconciliation run, not a rebuild.");
    if (!lotIds) {
      const fromRun = (r.report as LedgerDifference[]).filter((d) => d.siteId === input.siteId).map((d) => d.lotId);
      if (fromRun.length === 0) throw new DomainError("state", "That reconciliation run has no differences at this site.");
      lotIds = [...new Set(fromRun)].sort();
    }
  }
  return enqueueJob(db, ctx, inventoryRebuildBalancesJob, { siteId: input.siteId, reconciliationRunId: input.reconciliationRunId ?? null, lotIds, reason }, { siteId: input.siteId });
}

/** Reconciliation diagnostics card: latest runs visible to the viewer (organization-wide runs included). */
export async function listReconciliationRuns(ctx: AuthContext, limit = 20) {
  if (!ctx.can("platform.job.view") && !ctx.can("inventory.balance.admin")) ctx.require("platform.job.view");
  return db
    .select({
      id: reconciliationRuns.id,
      siteId: reconciliationRuns.siteId,
      kind: reconciliationRuns.kind,
      status: reconciliationRuns.status,
      asOf: reconciliationRuns.asOf,
      differencesCount: reconciliationRuns.differencesCount,
      sourceRunId: reconciliationRuns.sourceRunId,
      createdAt: reconciliationRuns.createdAt,
    })
    .from(reconciliationRuns)
    .where(and(eq(reconciliationRuns.organizationId, ctx.organizationId), or(isNull(reconciliationRuns.siteId), inArray(reconciliationRuns.siteId, ctx.allowedSiteIds))))
    .orderBy(desc(reconciliationRuns.createdAt))
    .limit(limit);
}

/** One run with its report. Differences at sites outside the viewer's scope are removed from the report. */
export async function getReconciliationRun(ctx: AuthContext, id: string) {
  if (!ctx.can("platform.job.view") && !ctx.can("inventory.balance.admin")) ctx.require("platform.job.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Reconciliation run not found.");
  const [r] = await db.select().from(reconciliationRuns).where(and(eq(reconciliationRuns.id, id), eq(reconciliationRuns.organizationId, ctx.organizationId))).limit(1);
  if (!r || (r.siteId && !ctx.allowedSiteIds.includes(r.siteId))) throw new DomainError("not_found", "Reconciliation run not found.");
  const report = (r.report as { siteId?: string }[]).filter((d) => !d.siteId || ctx.allowedSiteIds.includes(d.siteId) || r.kind === "rebuild");
  return { ...r, report };
}
