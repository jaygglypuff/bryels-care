import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import {
  COUNT_FROZEN_STATUSES,
  COUNT_KINDS,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  rolePermissions,
  approvalDecisions,
  stockCountCounters,
  stockCountEntries,
  stockCountLines,
  stockCounts,
  stockCountScopes,
  userSiteAssignments,
  users,
  warehouses,
} from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { reasonCodeOptions } from "@/modules/masterdata";
import { postMovement } from "./ledger";
import { isUuid } from "./lots";
import { claimIdempotencyKey, stateMachine, storeIdempotentResult } from "./command-kit";
import { getInventorySetting } from "./policy";
import { type ApprovalVerdict, canDecideEvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, stepVerdict } from "@/modules/governance";

type CountLineRow = typeof stockCountLines.$inferSelect;

/**
 * Variance basis of the `stock_count_variance` approval rules (US-1-14): the largest variance %
 * of the variant lines; a line without a % (nothing expected) counts as above every bound.
 */
function countVarianceBasis(lines: CountLineRow[]) {
  let maxPct: Decimal | null = null;
  for (const l of lines) {
    if (l.isUnlabelled || new Decimal(l.varianceQtyBase ?? 0).isZero()) continue;
    if (l.variancePct === null) return { variance_pct: "unbounded" as const };
    const p = new Decimal(l.variancePct);
    if (!maxPct || p.gt(maxPct)) maxPct = p;
  }
  return maxPct ? { variance_pct: maxPct.toString() } : {};
}

type CountStatus = "planned" | "in_progress" | "counted" | "recount" | "pending_approval" | "approved" | "posted" | "cancelled";

/** Stock count state machine (W03; data-model §3.3 plus `approved` between approval and posting). */
export const countMachine = stateMachine<CountStatus>(
  "stock_count",
  {
    planned: ["in_progress", "cancelled"],
    in_progress: ["counted", "recount", "cancelled"],
    counted: ["recount", "pending_approval", "approved", "cancelled"],
    recount: ["counted", "cancelled"],
    pending_approval: ["approved", "recount", "cancelled"],
    approved: ["posted", "cancelled"],
    posted: [],
    cancelled: [],
  },
  { in_progress: "in progress (counting)", pending_approval: "waiting for the second approval" },
);

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

import { activeCountsForLocations, assertLocationsNotFrozen } from "./freeze";

export { assertLocationsNotFrozen, activeCountsForLocations };

async function lockCount(tx: Tx, ctx: AuthContext, countId: string) {
  if (!isUuid(countId)) throw new DomainError("not_found", "Stock count not found in your sites.");
  const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, countId)).for("update").limit(1);
  if (!c || c.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(c.siteId)) throw new DomainError("not_found", "Stock count not found in your sites.");
  ctx.requireSite(c.siteId);
  return c;
}

/** Users who counted (any entry) or are assigned as counters; none of them may approve (SoD). */
async function countersOf(tx: Tx | typeof db, countId: string): Promise<Set<string>> {
  const assigned = await tx.select({ id: stockCountCounters.userId }).from(stockCountCounters).where(eq(stockCountCounters.stockCountId, countId));
  const entered = await tx.select({ id: stockCountEntries.countedBy }).from(stockCountEntries).where(eq(stockCountEntries.stockCountId, countId));
  return new Set([...assigned, ...entered].map((r) => r.id));
}

/** Users at a site whose roles include inventory.stock_count.submit (candidates for counter). */
export async function eligibleCounters(ctx: AuthContext, siteId = ctx.currentSiteId) {
  ctx.require("inventory.stock_count.view");
  ctx.requireSite(siteId);
  const rows = await db
    .selectDistinct({ id: users.id, name: users.displayName, email: users.email })
    .from(userSiteAssignments)
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, ctx.organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, "inventory.stock_count.submit"),
        activeAssignment(), // W2E: ended or future assignments do not count
        or(eq(userSiteAssignments.siteId, siteId), eq(userSiteAssignments.isOrganizationWide, true)),
      ),
    )
    .orderBy(asc(users.displayName));
  return rows;
}

export type CreateCountInput = {
  countKind: string;
  isBlind: boolean;
  scheduledFor?: string | null;
  locationIds: string[];
  counterUserIds: string[];
  notes?: string | null;
};

/** W03-01: plan a count over locations of the current site with assigned counters (status planned). */
export async function createCount(ctx: AuthContext, input: CreateCountInput) {
  ctx.require("inventory.stock_count.create");
  ctx.requireSite(ctx.currentSiteId);
  if (!(COUNT_KINDS as readonly string[]).includes(input.countKind)) throw new DomainError("validation", "Choose cycle, full or spot count.");
  const locIds = [...new Set(input.locationIds)].filter(isUuid);
  if (locIds.length === 0) throw new DomainError("validation", "Choose at least one location to count.");
  if (input.scheduledFor && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) throw new DomainError("validation", "Enter the scheduled date as YYYY-MM-DD.");
  return db.transaction(async (tx) => {
    const locs = await tx.select().from(locations).where(and(inArray(locations.id, locIds), eq(locations.siteId, ctx.currentSiteId)));
    if (locs.length !== locIds.length) throw new DomainError("validation", "Every location must belong to the current site.");
    const counterIds = [...new Set(input.counterUserIds)].filter(isUuid);
    if (counterIds.length) {
      const eligible = new Set((await eligibleCounters(ctx)).map((u) => u.id));
      const bad = counterIds.filter((u) => !eligible.has(u));
      if (bad.length) throw new DomainError("validation", "Every counter must be a user at this site who may enter counts.");
    }
    const number = await nextNumber(tx, ctx.organizationId, "CNT");
    const warehouseIds = [...new Set(locs.map((l) => l.warehouseId))];
    const [c] = await tx
      .insert(stockCounts)
      .values({
        organizationId: ctx.organizationId,
        siteId: ctx.currentSiteId,
        countNumber: number,
        warehouseId: warehouseIds.length === 1 ? warehouseIds[0] : null,
        countKind: input.countKind,
        isBlind: input.isBlind,
        status: "planned",
        scheduledFor: input.scheduledFor || null,
        notes: input.notes?.trim() || null,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(stockCountScopes).values(locs.map((l) => ({ stockCountId: c.id, siteId: c.siteId, locationId: l.id })));
    if (counterIds.length) await tx.insert(stockCountCounters).values(counterIds.map((u) => ({ stockCountId: c.id, userId: u })));
    await audit(tx, ctx, {
      action: "inventory.stock_count.created",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: number,
      siteId: c.siteId,
      after: { countKind: c.countKind, isBlind: c.isBlind, locations: locs.map((l) => l.code), counters: counterIds.length },
    });
    return { id: c.id, countNumber: number };
  });
}

/**
 * W03-02: release a planned count. Locks the scoped locations, snapshots expected balances into
 * lines and freezes the locations (V-FREEZE) until the count is posted or cancelled.
 */
export async function releaseCount(ctx: AuthContext, countId: string) {
  ctx.require("inventory.stock_count.create");
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, countId);
    countMachine.assert(c.status, "in_progress", `Count ${c.countNumber}`);
    const scope = await tx.select({ locationId: stockCountScopes.locationId }).from(stockCountScopes).where(eq(stockCountScopes.stockCountId, c.id));
    const locIds = scope.map((s) => s.locationId).sort();
    await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, locIds)).orderBy(asc(locations.id)).for("update");
    const overlapping = (await activeCountsForLocations(tx, locIds)).filter((r) => r.countId !== c.id);
    if (overlapping.length) throw new DomainError("conflict", `Some locations are already frozen by count ${overlapping[0].countNumber}. Finish or cancel it first.`);
    const balances = await tx
      .select({ lotId: inventoryBalances.lotId, locationId: inventoryBalances.locationId, qty: inventoryBalances.qtyBase, baseUom: inventoryLots.baseUom })
      .from(inventoryBalances)
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
      .where(and(inArray(inventoryBalances.locationId, locIds), sql`${inventoryBalances.qtyBase} > 0`));
    if (balances.length) {
      await tx.insert(stockCountLines).values(
        balances.map((b) => ({
          organizationId: c.organizationId,
          siteId: c.siteId,
          stockCountId: c.id,
          locationId: b.locationId,
          lotId: b.lotId,
          baseUom: b.baseUom,
          expectedQtyBase: b.qty,
        })),
      );
    }
    await tx.update(stockCounts).set({ status: "in_progress", frozenAt: sql`now()`, releasedBy: ctx.userId, updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.released",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      before: { status: c.status },
      after: { status: "in_progress", lines: balances.length, frozenLocations: locIds.length },
    });
    return { lines: balances.length };
  });
}

/** W03-09: cancel a count before posting, with a reason; unfreezes its locations. */
export async function cancelCount(ctx: AuthContext, countId: string, reason: string) {
  ctx.require("inventory.stock_count.approve");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Give a reason for cancelling the count (at least 3 characters).");
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, countId);
    countMachine.assert(c.status, "cancelled", `Count ${c.countNumber}`);
    await tx
      .update(stockCounts)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: reason.trim(), updatedAt: new Date() })
      .where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.cancelled",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      reason: reason.trim(),
      before: { status: c.status },
      after: { status: "cancelled" },
    });
  });
}

export type RecordCountInput = {
  countId: string;
  locationId: string;
  lotId?: string | null;
  /** For an unlabelled find (no lot): what the counter sees. */
  unlabelledDescription?: string | null;
  qty: string;
  note?: string | null;
  idempotencyKey: string;
};

/**
 * W03-03: a counter records a quantity for a lot at a location (blind). Unknown lots become
 * "found" lines (expected 0); items with no label become unlabelled lines for the approver to
 * resolve. Entries are append-only: a correction is a new entry, the first one is kept.
 */
export async function recordCount(ctx: AuthContext, input: RecordCountInput) {
  ctx.require("inventory.stock_count.submit");
  if (!QTY_RE.test(input.qty ?? "")) throw new DomainError("validation", "Enter the counted quantity (0 or more, up to 6 decimals).");
  if (!input.lotId && !input.unlabelledDescription?.trim()) throw new DomainError("validation", "Scan the lot, or describe the unlabelled item.");
  const qty = new Decimal(input.qty);
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, input.countId);
    if (c.status !== "in_progress") throw new DomainError("state", `Count ${c.countNumber} is not open for counting (it is ${c.status.replace("_", " ")}).`);
    const assigned = await tx.select({ id: stockCountCounters.userId }).from(stockCountCounters).where(eq(stockCountCounters.stockCountId, c.id));
    if (assigned.length && !assigned.some((a) => a.id === ctx.userId)) throw new DomainError("forbidden", `You are not assigned as a counter on ${c.countNumber}.`);
    if (input.idempotencyKey) {
      const [prior] = await tx
        .select()
        .from(stockCountEntries)
        .where(and(eq(stockCountEntries.stockCountId, c.id), eq(stockCountEntries.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (prior) return { lineId: prior.stockCountLineId, entryId: prior.id, previous: null, replayed: true };
    }
    const [inScope] = await tx
      .select({ id: stockCountScopes.id })
      .from(stockCountScopes)
      .where(and(eq(stockCountScopes.stockCountId, c.id), eq(stockCountScopes.locationId, input.locationId)))
      .limit(1);
    if (!inScope) throw new DomainError("validation", "This location is not part of the count. Scan a location on the count sheet.");

    let line: typeof stockCountLines.$inferSelect | undefined;
    if (input.lotId) {
      if (!isUuid(input.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
      const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).limit(1);
      if (!lot || lot.siteId !== c.siteId) throw new DomainError("not_found", "Lot not found at this count's site.");
      if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
      [line] = await tx
        .select()
        .from(stockCountLines)
        .where(and(eq(stockCountLines.stockCountId, c.id), eq(stockCountLines.locationId, input.locationId), eq(stockCountLines.lotId, lot.id)))
        .limit(1);
      if (!line) {
        [line] = await tx
          .insert(stockCountLines)
          .values({ organizationId: c.organizationId, siteId: c.siteId, stockCountId: c.id, locationId: input.locationId, lotId: lot.id, baseUom: lot.baseUom, expectedQtyBase: "0", isUnexpected: true })
          .returning();
      }
    } else {
      [line] = await tx
        .insert(stockCountLines)
        .values({
          organizationId: c.organizationId,
          siteId: c.siteId,
          stockCountId: c.id,
          locationId: input.locationId,
          lotId: null,
          isUnlabelled: true,
          isUnexpected: true,
          description: input.unlabelledDescription!.trim().slice(0, 500),
          expectedQtyBase: "0",
        })
        .returning();
    }
    const [previous] = await tx
      .select({ qty: stockCountEntries.qtyBase, by: stockCountEntries.countedBy })
      .from(stockCountEntries)
      .where(and(eq(stockCountEntries.stockCountLineId, line.id), eq(stockCountEntries.entryKind, "count")))
      .orderBy(desc(stockCountEntries.countedAt))
      .limit(1);
    const [entry] = await tx
      .insert(stockCountEntries)
      .values({
        stockCountId: c.id,
        stockCountLineId: line.id,
        entryKind: "count",
        qtyBase: qty.toString(),
        countedBy: ctx.userId,
        note: input.note?.trim() || null,
        idempotencyKey: input.idempotencyKey || null,
      })
      .returning();
    await tx.update(stockCountLines).set({ lineStatus: "counted" }).where(eq(stockCountLines.id, line.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.line_counted",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      after: { lineId: line.id, qty: qty.toString(), unexpected: line.isUnexpected, unlabelled: line.isUnlabelled, correction: !!previous },
    });
    return { lineId: line.id, entryId: entry.id, previous: previous ? { qty: new Decimal(previous.qty).toString(), byMe: previous.by === ctx.userId } : null, replayed: false };
  });
}

function classify(expected: Decimal, final: Decimal) {
  const variance = final.minus(expected);
  const pct = expected.gt(0) ? variance.abs().div(expected).times(100) : variance.isZero() ? new Decimal(0) : null; // null = infinite
  return { variance, pct };
}

/**
 * W03-04/05: the counter submits the sheet. Every expected line must have a count (0 when nothing
 * was found). Lines above the recount threshold go to a blind recount by a different counter;
 * lines within the auto-approve threshold are approved automatically.
 */
export async function submitCount(ctx: AuthContext, countId: string) {
  ctx.require("inventory.stock_count.submit");
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, countId);
    if (c.status !== "in_progress") throw new DomainError("state", `Count ${c.countNumber} is ${c.status.replace("_", " ")}; only a count in progress can be submitted.`);
    const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    const entries = await tx.select().from(stockCountEntries).where(eq(stockCountEntries.stockCountId, c.id)).orderBy(asc(stockCountEntries.countedAt));
    const missing = lines.filter((l) => !entries.some((e) => e.stockCountLineId === l.id));
    if (missing.length) {
      const locs = await tx.select({ id: locations.id, code: locations.code }).from(locations).where(inArray(locations.id, [...new Set(missing.map((m) => m.locationId))]));
      throw new DomainError("validation", `${missing.length} expected line(s) are not counted yet (locations ${locs.map((l) => l.code).join(", ")}). Enter 0 for items that are not there.`, {
        missingLineIds: missing.map((m) => m.id),
      });
    }
    const recountPct = new Decimal(await getInventorySetting(tx, c.organizationId, c.siteId, "inventory.count.recount_threshold_pct"));
    const autoPct = new Decimal(await getInventorySetting(tx, c.organizationId, c.siteId, "inventory.count.auto_approve_variance_pct"));
    let recounts = 0;
    for (const l of lines) {
      const latest = entries.filter((e) => e.stockCountLineId === l.id && e.entryKind === "count").at(-1)!;
      const final = new Decimal(latest.qtyBase);
      if (l.isUnlabelled) {
        await tx.update(stockCountLines).set({ lineStatus: "final", finalQtyBase: final.toString() }).where(eq(stockCountLines.id, l.id));
        continue;
      }
      const { variance, pct } = classify(new Decimal(l.expectedQtyBase), final);
      const needsRecount = !variance.isZero() && (pct === null || pct.gt(recountPct));
      const auto = !variance.isZero() && !needsRecount && autoPct.gt(0) && pct !== null && pct.lte(autoPct);
      if (needsRecount) recounts++;
      await tx
        .update(stockCountLines)
        .set({
          lineStatus: needsRecount ? "recount_required" : "final",
          finalQtyBase: final.toString(),
          varianceQtyBase: variance.toString(),
          variancePct: pct?.toDecimalPlaces(4).toString() ?? null,
          autoApproved: auto,
        })
        .where(eq(stockCountLines.id, l.id));
    }
    const next: CountStatus = recounts ? "recount" : "counted";
    countMachine.assert(c.status, next, `Count ${c.countNumber}`);
    await tx.update(stockCounts).set({ status: next, submittedAt: new Date(), submittedBy: ctx.userId, updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.submitted",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      before: { status: c.status },
      after: { status: next, lines: lines.length, recounts },
    });
    return { status: next, recounts };
  });
}

/**
 * W03-06: blind recount of a line by a counter who has not counted it before (SoD,
 * `sod.count.recounter_not_counter`). Stored alongside the first count; the variance uses it.
 */
export async function recordRecount(ctx: AuthContext, input: { lineId: string; qty: string; note?: string | null; idempotencyKey?: string }) {
  ctx.require("inventory.stock_count.submit");
  if (!isUuid(input.lineId)) throw new DomainError("not_found", "Count line not found.");
  if (!QTY_RE.test(input.qty ?? "")) throw new DomainError("validation", "Enter the recounted quantity (0 or more, up to 6 decimals).");
  const qty = new Decimal(input.qty);
  return db.transaction(async (tx) => {
    const [l0] = await tx.select().from(stockCountLines).where(eq(stockCountLines.id, input.lineId)).limit(1);
    if (!l0) throw new DomainError("not_found", "Count line not found.");
    const c = await lockCount(tx, ctx, l0.stockCountId);
    const [line] = await tx.select().from(stockCountLines).where(eq(stockCountLines.id, l0.id)).for("update");
    if (input.idempotencyKey) {
      const [prior] = await tx
        .select()
        .from(stockCountEntries)
        .where(and(eq(stockCountEntries.stockCountId, c.id), eq(stockCountEntries.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (prior) return { status: c.status as CountStatus, replayed: true };
    }
    if (c.status !== "recount" || line.lineStatus !== "recount_required") throw new DomainError("state", `This line of ${c.countNumber} is not waiting for a recount.`);
    const previous = await tx.select({ by: stockCountEntries.countedBy }).from(stockCountEntries).where(eq(stockCountEntries.stockCountLineId, line.id));
    if (ctx.sodBlocks(previous.some((p) => p.by === ctx.userId), "SEPARATION_OF_DUTIES: a recount must be done by a different counter than the one who counted this line.")) {
      throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: a recount must be done by a different counter than the one who counted this line.", { ...ctx.refusalDetails(),
        rule: "sod.count.recounter_not_counter",
      });
    }
    if (line.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
    await tx.insert(stockCountEntries).values({
      stockCountId: c.id,
      stockCountLineId: line.id,
      entryKind: "recount",
      qtyBase: qty.toString(),
      countedBy: ctx.userId,
      note: input.note?.trim() || null,
      idempotencyKey: input.idempotencyKey || null,
    });
    const { variance, pct } = classify(new Decimal(line.expectedQtyBase), qty);
    await tx
      .update(stockCountLines)
      .set({ lineStatus: "final", finalQtyBase: qty.toString(), varianceQtyBase: variance.toString(), variancePct: pct?.toDecimalPlaces(4).toString() ?? null, autoApproved: false })
      .where(eq(stockCountLines.id, line.id));
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(stockCountLines)
      .where(and(eq(stockCountLines.stockCountId, c.id), eq(stockCountLines.lineStatus, "recount_required")));
    let status = c.status as CountStatus;
    if (open === 0) {
      countMachine.assert(c.status, "counted", `Count ${c.countNumber}`);
      status = "counted";
      await tx.update(stockCounts).set({ status, updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    }
    await audit(tx, ctx, {
      action: "inventory.stock_count.line_recounted",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      after: { lineId: line.id, qty: qty.toString(), variance: variance.toString(), countStatus: status },
    });
    return { status, replayed: false };
  });
}

export type ApproveCountInput = { lines: Record<string, { reasonCode: string; note?: string | null }>; note?: string | null };

/**
 * Approval round of a count (approval_decisions.cycle): 1, plus one for every rejection that sent
 * lines back to recount, so the same approver can decide again after a recount.
 */
async function countApprovalCycle(tx: Tx, countId: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalDecisions)
    .where(and(eq(approvalDecisions.recordType, "stock_count"), eq(approvalDecisions.recordId, countId), eq(approvalDecisions.decision, "rejected")));
  return 1 + Number(r?.n ?? 0);
}

/**
 * W03-07: variance approval. The approver may not be any counter (SoD). Step 1 needs a reason code
 * on every variant line not auto-approved; a line above the second-step threshold needs a second
 * approval by the configured role (default owner_director) from a different user.
 */
export async function approveCount(ctx: AuthContext, countId: string, input: ApproveCountInput) {
  ctx.require("inventory.stock_count.approve");
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, countId);
    if (c.status !== "counted" && c.status !== "pending_approval") throw new DomainError("state", `Count ${c.countNumber} is ${c.status.replace("_", " ")}; there is nothing to approve.`);
    const counters = await countersOf(tx, c.id);
    if (ctx.sodBlocksAt(counters.has(ctx.userId), "SEPARATION_OF_DUTIES: you counted or are assigned to this count, so you cannot approve its variances.", c.siteId)) {
      throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you counted or are assigned to this count, so you cannot approve its variances.", { ...ctx.refusalDetails(), rule: "sod.count.approver_not_counter" });
    }
    const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    if (c.status === "counted") {
      const fieldErrors: Record<string, string> = {};
      // Shared reason codes, category `count_variance` (US-1-24); a code that needs a note gets one.
      const options = await reasonCodeOptions(tx, ctx.organizationId, "count_variance");
      for (const l of lines) {
        if (l.isUnlabelled || l.autoApproved || new Decimal(l.varianceQtyBase ?? 0).isZero()) continue;
        const r = input.lines?.[l.id];
        const opt = r ? options.find((o) => o.code === r.reasonCode) : undefined;
        if (!r || !opt) fieldErrors[`reason_${l.id}`] = "Choose a reason code for this variance.";
        else if (opt.requiresNote && !r.note?.trim()) fieldErrors[`reason_${l.id}`] = `Add a note: "${opt.label}" needs an explanation.`;
      }
      if (Object.keys(fieldErrors).length) throw new DomainError("validation", "Every variance needs a reason code before approval.", { fieldErrors });
      for (const l of lines) {
        const r = input.lines?.[l.id];
        if (r && !l.isUnlabelled && !new Decimal(l.varianceQtyBase ?? 0).isZero()) {
          await tx.update(stockCountLines).set({ varianceReasonCode: r.reasonCode, varianceNote: r.note?.trim() || null }).where(eq(stockCountLines.id, l.id));
        }
      }
      const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: "stock_count_variance", siteId: c.siteId, recordId: c.id, recordNumber: c.countNumber, basis: countVarianceBasis(lines) });
      if (ev.steps.length > 2) throw new DomainError("setup_required", "The approval rules for count variances define more than two steps; counts support two. Ask the owner to adjust the rules.");
      const firstStep = ev.steps[0];
      if (firstStep && !canDecideEvaluatedStep(ctx, firstStep, c.updatedAt)) throw new DomainError("forbidden", `This approval needs the ${firstStep.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ")} role.`);
      const needsSecond = ev.steps.length > 1;
      await tx.insert(approvalDecisions).values({ organizationId: c.organizationId, siteId: c.siteId, recordType: "stock_count", recordId: c.id, cycle: await countApprovalCycle(tx, c.id), step: 1, decision: "approved", decidedBy: ctx.userId, note: input.note?.trim() || null });
      const next: CountStatus = needsSecond ? "pending_approval" : "approved";
      countMachine.assert(c.status, next, `Count ${c.countNumber}`);
      await tx
        .update(stockCounts)
        .set({
          status: next,
          requiresSecondApproval: needsSecond,
          approvalNote: input.note?.trim() || null,
          ...(needsSecond ? {} : { approvedBy: ctx.userId, approvedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(stockCounts.id, c.id));
      await audit(tx, ctx, {
        action: "inventory.stock_count.variance_approved",
        entityType: "stock_count",
        entityId: c.id,
        entityNumber: c.countNumber,
        siteId: c.siteId,
        reason: input.note?.trim() || null,
        before: { status: c.status },
        after: { status: next, step: 1, secondStepRequired: needsSecond },
      });
      return { status: next };
    }
    // Second step.
    const ev2 = await evaluateApprovalRules(tx, c.organizationId, { documentType: "stock_count_variance", siteId: c.siteId, basis: countVarianceBasis(lines) });
    const second = ev2.steps[1];
    if (second && !canDecideEvaluatedStep(ctx, second, c.updatedAt)) throw new DomainError("forbidden", `The second approval of this count needs the ${second.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ")} role.`);
    const [first] = await tx
      .select()
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.recordType, "stock_count"), eq(approvalDecisions.recordId, c.id), eq(approvalDecisions.cycle, await countApprovalCycle(tx, c.id)), eq(approvalDecisions.step, 1), eq(approvalDecisions.decision, "approved")))
      .orderBy(desc(approvalDecisions.decidedAt))
      .limit(1);
    ctx.assertSeparationAt(first?.decidedBy === ctx.userId, "SEPARATION_OF_DUTIES: the second approval must come from a different person than the first.", c.siteId);
    await tx.insert(approvalDecisions).values({ organizationId: c.organizationId, siteId: c.siteId, recordType: "stock_count", recordId: c.id, cycle: await countApprovalCycle(tx, c.id), step: 2, decision: "approved", decidedBy: ctx.userId, note: input.note?.trim() || null });
    countMachine.assert(c.status, "approved", `Count ${c.countNumber}`);
    await tx.update(stockCounts).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.variance_approved",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      reason: input.note?.trim() || null,
      before: { status: c.status },
      after: { status: "approved", step: 2 },
    });
    return { status: "approved" as CountStatus };
  });
}

/** W03-07: the approver rejects variant lines; they go back to a blind recount by a new counter. */
export async function rejectCountLines(ctx: AuthContext, countId: string, input: { lineIds: string[]; note: string }) {
  ctx.require("inventory.stock_count.approve");
  if (!input.note?.trim()) throw new DomainError("validation", "Say why the lines must be recounted.");
  return db.transaction(async (tx) => {
    const c = await lockCount(tx, ctx, countId);
    countMachine.assert(c.status, "recount", `Count ${c.countNumber}`);
    const counters = await countersOf(tx, c.id);
    ctx.assertSeparationAt(counters.has(ctx.userId), "SEPARATION_OF_DUTIES: you counted or are assigned to this count, so you cannot decide on its variances.", c.siteId);
    const ids = input.lineIds.filter(isUuid);
    const lines = ids.length ? await tx.select().from(stockCountLines).where(and(eq(stockCountLines.stockCountId, c.id), inArray(stockCountLines.id, ids))) : [];
    const rejectable = lines.filter((l) => !l.isUnlabelled);
    if (rejectable.length === 0) throw new DomainError("validation", "Choose at least one counted line to send back for recount.");
    await tx
      .update(stockCountLines)
      .set({ lineStatus: "recount_required", varianceReasonCode: null, autoApproved: false })
      .where(inArray(stockCountLines.id, rejectable.map((l) => l.id)));
    const step = c.status === "pending_approval" ? 2 : 1;
    await tx.insert(approvalDecisions).values({ organizationId: c.organizationId, siteId: c.siteId, recordType: "stock_count", recordId: c.id, cycle: await countApprovalCycle(tx, c.id), step, decision: "rejected", decidedBy: ctx.userId, note: input.note.trim() }).onConflictDoNothing();
    await tx.update(stockCounts).set({ status: "recount", requiresSecondApproval: false, updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.variance_rejected",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      reason: input.note.trim(),
      before: { status: c.status },
      after: { status: "recount", lines: rejectable.length },
    });
    return { lines: rejectable.length };
  });
}

/**
 * W03-08: post an approved count. One `adjustment` movement per variant line (source
 * `stock_count`), bringing the location balance to the final counted quantity; then the count is
 * posted and its locations unfreeze. Unlabelled finds are not posted here; they are resolved with a
 * found-stock adjustment document.
 */
export async function postCount(ctx: AuthContext, countId: string, idempotencyKey: string) {
  ctx.require("inventory.stock_count.post");
  const key = `count_post:${countId}:${idempotencyKey}`;
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ movements: number }>(tx, ctx.organizationId, key, "inventory.stock_count.post", { countId });
    if (claimed) return { ...claimed.replay, replayed: true };
    const c = await lockCount(tx, ctx, countId);
    countMachine.assert(c.status, "posted", `Count ${c.countNumber}`);
    if (ctx.sodBlocksAt(c.requiresSecondApproval && c.approvedBy === ctx.userId, "SEPARATION_OF_DUTIES: above the approval threshold the person who posts must differ from the final approver.", c.siteId)) {
      throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: above the approval threshold the person who posts must differ from the final approver.", ctx.refusalDetails());
    }
    const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    const postable = lines.filter((l) => l.lotId && l.finalQtyBase !== null);
    const lotIds = [...new Set(postable.map((l) => l.lotId!))].sort();
    if (lotIds.length) await tx.select({ id: inventoryLots.id }).from(inventoryLots).where(inArray(inventoryLots.id, lotIds)).orderBy(asc(inventoryLots.id)).for("update");
    let count = 0;
    for (const l of postable) {
      const [bal] = await tx
        .select({ qty: inventoryBalances.qtyBase })
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.lotId, l.lotId!), eq(inventoryBalances.locationId, l.locationId)))
        .limit(1);
      const current = new Decimal(bal?.qty ?? 0);
      const delta = new Decimal(l.finalQtyBase!).minus(current);
      if (delta.isZero()) continue;
      const { movement } = await postMovement(tx, ctx, {
        movementType: "adjustment",
        lotId: l.lotId!,
        fromLocationId: delta.lt(0) ? l.locationId : null,
        toLocationId: delta.gt(0) ? l.locationId : null,
        qtyBase: delta.abs(),
        sourceDocumentType: "stock_count",
        sourceDocumentId: c.id,
        sourceDocumentNumber: c.countNumber,
        reason: l.varianceReasonCode ?? (l.autoApproved ? "count_auto_approved" : "count_variance"),
        idempotencyKey: `${key}:${l.id}`,
        // The count's own freeze does not block its adjustments; any other count's freeze does.
        freezeExemptCountId: c.id,
        meta: { stockCountLineId: l.id, expected: l.expectedQtyBase, counted: l.finalQtyBase, balanceAtPosting: current.toString() },
      });
      await tx.update(stockCountLines).set({ adjustmentMovementId: movement.id }).where(eq(stockCountLines.id, l.id));
      count++;
    }
    await tx.update(stockCounts).set({ status: "posted", postedAt: new Date(), postedBy: ctx.userId, updatedAt: new Date() }).where(eq(stockCounts.id, c.id));
    await audit(tx, ctx, {
      action: "inventory.stock_count.posted",
      entityType: "stock_count",
      entityId: c.id,
      entityNumber: c.countNumber,
      siteId: c.siteId,
      before: { status: c.status },
      after: { status: "posted", adjustments: count },
    });
    const result = { movements: count };
    await storeIdempotentResult(tx, ctx.organizationId, key, { countId }, result);
    return { ...result, replayed: false };
  });
}

/** Counts of the current site, newest first. */
export async function listCounts(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("inventory.stock_count.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(stockCounts.siteId, ctx.currentSiteId)];
  if (f.status) conds.push(eq(stockCounts.status, f.status));
  return db
    .select({
      id: stockCounts.id,
      countNumber: stockCounts.countNumber,
      countKind: stockCounts.countKind,
      status: stockCounts.status,
      isBlind: stockCounts.isBlind,
      scheduledFor: stockCounts.scheduledFor,
      createdAt: stockCounts.createdAt,
      createdBy: users.displayName,
      locations: sql<number>`(select count(*)::int from ${stockCountScopes} s where s.stock_count_id = ${stockCounts.id})`,
      lines: sql<number>`(select count(*)::int from ${stockCountLines} l where l.stock_count_id = ${stockCounts.id})`,
    })
    .from(stockCounts)
    .innerJoin(users, eq(users.id, stockCounts.createdBy))
    .where(and(...conds))
    .orderBy(desc(stockCounts.createdAt))
    .limit(200);
}

/**
 * Count detail. In a blind count the expected quantity and other people's counts are hidden from
 * counters while counting or recounting; approvers who did not count see everything.
 */
export async function getCount(ctx: AuthContext, countId: string) {
  ctx.require("inventory.stock_count.view");
  if (!isUuid(countId)) throw new DomainError("not_found", "Stock count not found in your sites.");
  const [c] = await db.select().from(stockCounts).where(and(eq(stockCounts.id, countId), inArray(stockCounts.siteId, ctx.allowedSiteIds))).limit(1);
  if (!c || c.organizationId !== ctx.organizationId) throw new DomainError("not_found", "Stock count not found in your sites.");
  ctx.requireSite(c.siteId);
  const counters = await countersOf(db, c.id);
  const isCounter = counters.has(ctx.userId);
  const counting = c.status === "in_progress" || c.status === "recount";
  const reveal = !c.isBlind || !counting || (ctx.can("inventory.stock_count.approve") && !isCounter);

  const scope = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(stockCountScopes)
    .innerJoin(locations, eq(locations.id, stockCountScopes.locationId))
    .where(eq(stockCountScopes.stockCountId, c.id))
    .orderBy(asc(locations.code));
  const assigned = await db
    .select({ id: users.id, name: users.displayName })
    .from(stockCountCounters)
    .innerJoin(users, eq(users.id, stockCountCounters.userId))
    .where(eq(stockCountCounters.stockCountId, c.id));
  const lines = await db
    .select({
      id: stockCountLines.id,
      locationId: stockCountLines.locationId,
      locationCode: locations.code,
      lotId: stockCountLines.lotId,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      itemCode: sql<string | null>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string | null>`coalesce(${materials.name}, ${products.name})`,
      baseUom: stockCountLines.baseUom,
      expected: stockCountLines.expectedQtyBase,
      isUnexpected: stockCountLines.isUnexpected,
      isUnlabelled: stockCountLines.isUnlabelled,
      description: stockCountLines.description,
      lineStatus: stockCountLines.lineStatus,
      final: stockCountLines.finalQtyBase,
      variance: stockCountLines.varianceQtyBase,
      variancePct: stockCountLines.variancePct,
      reasonCode: stockCountLines.varianceReasonCode,
      reasonNote: stockCountLines.varianceNote,
      autoApproved: stockCountLines.autoApproved,
      adjustmentMovementId: stockCountLines.adjustmentMovementId,
    })
    .from(stockCountLines)
    .innerJoin(locations, eq(locations.id, stockCountLines.locationId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, stockCountLines.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(eq(stockCountLines.stockCountId, c.id))
    .orderBy(asc(locations.code), asc(inventoryLots.lotNumber));
  const entries = await db
    .select({ id: stockCountEntries.id, lineId: stockCountEntries.stockCountLineId, kind: stockCountEntries.entryKind, qty: stockCountEntries.qtyBase, byId: stockCountEntries.countedBy, by: users.displayName, at: stockCountEntries.countedAt, note: stockCountEntries.note })
    .from(stockCountEntries)
    .innerJoin(users, eq(users.id, stockCountEntries.countedBy))
    .where(eq(stockCountEntries.stockCountId, c.id))
    .orderBy(asc(stockCountEntries.countedAt));
  const decisions = await db
    .select({ step: approvalDecisions.step, decision: approvalDecisions.decision, by: users.displayName, at: approvalDecisions.decidedAt, note: approvalDecisions.note })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.recordType, "stock_count"), eq(approvalDecisions.recordId, c.id)))
    .orderBy(asc(approvalDecisions.decidedAt));
  const [wh] = c.warehouseId ? await db.select({ code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, c.warehouseId)) : [];

  const outLines = lines.map((l) => {
    const mine = entries.filter((e) => e.lineId === l.id);
    const visibleEntries = reveal ? mine : mine.filter((e) => e.byId === ctx.userId);
    const firstCount = mine.find((e) => e.kind === "count");
    const recount = mine.filter((e) => e.kind === "recount").at(-1);
    return {
      ...l,
      expected: reveal ? l.expected : null,
      final: reveal ? l.final : null,
      variance: reveal ? l.variance : null,
      variancePct: reveal ? l.variancePct : null,
      entries: visibleEntries,
      firstCount: reveal && firstCount ? { qty: firstCount.qty, by: firstCount.by } : null,
      recount: reveal && recount ? { qty: recount.qty, by: recount.by } : null,
      countedByMe: mine.some((e) => e.byId === ctx.userId),
      counted: mine.length > 0,
    };
  });
  const locationsCounted = scope.filter((s) => {
    const ls = outLines.filter((l) => l.locationId === s.id);
    return ls.length > 0 && ls.every((l) => l.counted);
  }).length;
  return {
    ...c,
    warehouse: wh ?? null,
    scope,
    counters: assigned,
    isCounter,
    // ADR-088 §2: a counter may still approve as a top role at the site (or under the owner override).
    canApproveVariances: ctx.canAt("inventory.stock_count.approve", c.siteId) && !(isCounter && ctx.sodConflictAt(ctx.userId, c.siteId)),
    reveal,
    lines: outLines,
    decisions,
    progress: { locationsCounted, locations: scope.length, linesCounted: outLines.filter((l) => l.counted).length, lines: outLines.length },
  };
}

export type CountDetail = Awaited<ReturnType<typeof getCount>>;

/** Resolves a scanned or typed lot code (BC:LOT:<n> or the number) at the count's site for capture. */
export async function findLotForCount(ctx: AuthContext, countId: string, raw: string) {
  ctx.require("inventory.stock_count.submit");
  const c = await getCount(ctx, countId);
  const code = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase().replace(/^BC:LOT:/, "");
  if (!code) return null;
  const [lot] = await db
    .select({ id: inventoryLots.id, lotNumber: inventoryLots.lotNumber, baseUom: inventoryLots.baseUom, itemName: sql<string>`coalesce(${materials.name}, ${products.name})` })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.siteId, c.siteId), eq(inventoryLots.lotNumber, code)))
    .limit(1);
  return lot ?? null;
}

/**
 * "To approve" verdicts for count variances waiting for the second step (ADR-083 §8, ADR-088 §2; registered in
 * src/modules/wiring.ts): the same role and same-person rules as `approveCount`, read only, caller's sites only.
 */
export async function countApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select()
    .from(stockCounts)
    .where(and(eq(stockCounts.organizationId, ctx.organizationId), inArray(stockCounts.id, ids), inArray(stockCounts.siteId, ctx.allowedSiteIds), eq(stockCounts.status, "pending_approval")));
  for (const c of rows) {
    const lines = await db.select().from(stockCountLines).where(eq(stockCountLines.stockCountId, c.id));
    const ev = await evaluateApprovalRules(db, c.organizationId, { documentType: "stock_count_variance", siteId: c.siteId, basis: countVarianceBasis(lines) });
    const firsts = await db
      .select({ by: approvalDecisions.decidedBy })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.recordType, "stock_count"), eq(approvalDecisions.recordId, c.id), eq(approvalDecisions.step, 1), eq(approvalDecisions.decision, "approved")))
      .orderBy(desc(approvalDecisions.decidedAt))
      .limit(1);
    const counters = await countersOf(db, c.id);
    const v = stepVerdict(ctx, {
      step: ev.steps[1] ?? null,
      basePermission: "inventory.stock_count.approve",
      siteId: c.siteId,
      pendingSince: c.updatedAt,
      excludedUserIds: [...counters],
      priorApproverIds: firsts.map((f) => f.by),
      operational: true,
      roleStandIn: false,
    });
    out.set(c.id, v);
  }
  return out;
}
