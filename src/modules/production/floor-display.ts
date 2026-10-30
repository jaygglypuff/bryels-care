import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batches, products, users, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { defectSummary } from "./daily-log";
import { batchFlowFacts, shortDay, waitLabel } from "./flow-facts";
import { isLate, pieceWord, productionOrderStatus } from "./production-order-status";
import { loadBatchFacts, piecesOf } from "./production-orders";
import { addDays, manilaToday } from "./shared";

/**
 * Floor screen (ADR-084, docs/FLOOR_DISPLAY.md): the read model of the production TV. Read-only, from
 * existing records, no new tables. It answers four questions in order: what are we making now, what is
 * next, what is waiting, how is today going.
 *
 * Shows no prices, no customer or supplier names and only the first name of the person making an order.
 * Needs `production.batch.view` at the site (404 outside the caller's sites, 403 without the permission).
 * "Today" needs `production.daily_log.view` too; without it the panel is null (not shown).
 */

export const FLOOR_MAX_MAKING = 6;
export const FLOOR_MAX_NEXT = 5;

/** Batch states shown under "Making now" (plan §3). */
const MAKING_STATES = ["materials_staged", "in_process"] as const;
/** Batch states counted as "waiting for the quality check". */
const QC_STATES = ["awaiting_qc", "quarantined"] as const;

export type FloorTone = "good" | "wait" | "bad";

export type FloorMakingCard = {
  batchId: string;
  batchNumber: string;
  productName: string;
  status: (typeof MAKING_STATES)[number];
  /** Current step (null when every step is done: "Ready to finish"). */
  stepName: string | null;
  stepIndex: number;
  stepTotal: number;
  /** "Step 4 of 7 · Mixing and cutting", "Materials ready · not started", "Ready to finish". */
  stepText: string;
  /** Steps done ÷ steps, 0–100, whole number as text (decimal.js). */
  percent: string;
  /** First name of the person the order is assigned to; null = anyone at the site. */
  assignee: string | null;
  startedAt: string | null;
  /** Current step is a wait (curing / resting) that has started. */
  wait: { until: string; daysLeft: number; over: boolean; label: string } | null;
  /** One line in plain words with its tone: never colour alone (the screen adds an icon and this word). */
  note: string;
  tone: FloorTone;
};

export type FloorNextRow = {
  workOrderId: string;
  productName: string;
  /** "120 bars", "240 pieces". */
  piecesText: string;
  neededBy: string | null;
  /** "Needed by Fri 31 Oct", "Start Mon 3 Nov" when no needed-by date is set. */
  neededByText: string;
  late: boolean;
  missingMaterials: boolean;
};

export type FloorDisplay = {
  site: { id: string; code: string; name: string };
  generatedAt: string;
  /** The plant's day, YYYY-MM-DD in Asia/Manila. */
  date: string;
  makingNow: { cards: FloorMakingCard[]; total: number; more: number };
  nextUp: { rows: FloorNextRow[]; total: number; more: number };
  waiting: {
    /** Batches whose current step is a wait that has not ended. */
    curing: number;
    /** Waits that have ended: ready for the next step. */
    curingDone: number;
    qualityCheck: number;
    /** When the oldest batch started waiting for QA (ISO) and how long that is ("3 days", "5 hours"). */
    qualityCheckOldestSince: string | null;
    qualityCheckOldestText: string | null;
    /** Approved orders (not started) whose approval recorded material shortages. */
    missingMaterials: number;
  };
  /** Null without production.daily_log.view at the site. */
  today: {
    made: string;
    rejects: string;
    /** Rejects ÷ (made + rejects) × 100, one decimal; null when nothing was logged. */
    rejectPct: string | null;
    /** Expected pieces of the orders being made; null when not derivable (no bar). */
    planned: string | null;
    /** made ÷ planned × 100, capped at 100; null without a plan. */
    percentOfPlan: string | null;
  } | null;
};

const firstName = (name: string | null) => (name ? name.trim().split(/\s+/)[0] || null : null);

/** Whole days from one Manila date to another (YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

function leftWord(days: number): string {
  if (days <= 0) return "later today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** "3 days", "5 hours", "20 minutes" since `since`. */
export function ageText(since: Date, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (mins < 60) return mins === 1 ? "1 minute" : `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

const pct = (part: Decimal.Value, whole: Decimal.Value, dp = 0) => {
  const w = new Decimal(whole);
  if (w.lte(0)) return "0";
  return Decimal.min(new Decimal(part).div(w).mul(100), 100).toDecimalPlaces(dp, Decimal.ROUND_DOWN).toString();
};

export async function getFloorDisplay(ctx: AuthContext, opts: { siteId?: string } = {}, now: Date = new Date()): Promise<FloorDisplay> {
  ctx.require("production.batch.view");
  const siteId = opts.siteId ?? ctx.currentSiteId;
  ctx.requireAt("production.batch.view", siteId); // not_found outside the caller's sites, forbidden without the permission there
  const site = ctx.allowedSites.find((s) => s.id === siteId);
  if (!site) throw new DomainError("not_found", "Record not found in your sites.");
  const today = manilaToday(now);

  // ---------------------------------------------------------------- batches on the floor
  const live = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      startedAt: batches.startedAt,
      productName: products.name,
      assigneeName: users.displayName,
      enteredAt: sql<Date | null>`(select max(t.at) from batch_state_transitions t where t.batch_id = ${batches.id} and t.to_state = ${batches.status})`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(workOrders, eq(workOrders.id, batches.workOrderId))
    .leftJoin(users, eq(users.id, workOrders.assignedOperatorId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, siteId), inArray(batches.status, [...MAKING_STATES, ...QC_STATES])))
    .orderBy(sql`${batches.startedAt} asc nulls last`, asc(batches.batchNumber));

  const making = live.filter((b) => (MAKING_STATES as readonly string[]).includes(b.status));
  const facts = await batchFlowFacts(
    db,
    making.map((b) => b.id),
    now,
  );
  const cards: FloorMakingCard[] = making.map((b) => {
    const s = facts.get(b.id)?.currentStep ?? null;
    const total = s?.total ?? 0;
    const done = s ? s.index - 1 : total;
    const percent = s ? pct(done, total) : "100";
    const status = b.status as FloorMakingCard["status"];
    let wait: FloorMakingCard["wait"] = null;
    if (s && s.readyAt && s.status === "in_progress") {
      const daysLeft = Math.max(0, daysBetween(today, manilaToday(s.readyAt)));
      const over = !s.waiting;
      wait = { until: s.readyAt.toISOString(), daysLeft, over, label: over ? "" : `${waitLabel(s.kind, s.name, s.readyAt, now)} · ${leftWord(daysLeft)}` };
      if (over) wait.label = `${/mou?ld/i.test(s.name) ? "Mould time" : s.kind === "hold" ? "Resting" : "Curing"} finished — ready for the next step`;
    }
    const stepText =
      status === "materials_staged"
        ? "Materials ready · not started yet"
        : s
          ? `Step ${s.index} of ${s.total} · ${s.name}`
          : "Every step done · ready to finish";
    const note = wait ? wait.label : status === "materials_staged" ? "Ready to start" : s?.status === "awaiting_check" ? "Waiting for a second person to check" : s ? "Being made" : "Ready to finish";
    const tone: FloorTone = wait && !wait.over ? "wait" : s?.status === "awaiting_check" ? "wait" : "good";
    return {
      batchId: b.id,
      batchNumber: b.batchNumber,
      productName: b.productName,
      status,
      stepName: s?.name ?? null,
      stepIndex: s?.index ?? total,
      stepTotal: total,
      stepText,
      percent,
      assignee: firstName(b.assigneeName),
      startedAt: b.startedAt ? b.startedAt.toISOString() : null,
      wait,
      note,
      tone,
    };
  });

  const qc = live.filter((b) => (QC_STATES as readonly string[]).includes(b.status));
  const qcTimes = qc.map((b) => (b.enteredAt ? new Date(b.enteredAt) : null)).filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  const oldestQc = qcTimes.length ? new Date(Math.min(...qcTimes.map((d) => d.getTime()))) : null;

  // ---------------------------------------------------------------- orders: next up, missing materials, plan
  const orders = await db
    .select({
      wo: {
        id: workOrders.id,
        status: workOrders.status,
        qtyPlannedBase: workOrders.qtyPlannedBase,
        targetUnits: workOrders.targetUnits,
        batchCount: workOrders.batchCount,
        plannedStart: workOrders.plannedStart,
        neededBy: workOrders.neededBy,
        releaseShortages: workOrders.releaseShortages,
      },
      productName: products.name,
      productFamily: products.family,
      unitNetMassG: products.unitNetMassG,
      yieldPct: sql<
        string | null
      >`coalesce((select fr.theoretical_yield_pct from formula_revisions fr where fr.id = ${workOrders.formulaRevisionId}), (select fr.theoretical_yield_pct from formula_revisions fr where fr.formula_id = ${workOrders.formulaId} and fr.status = 'approved' order by fr.revision_no desc limit 1))::text`,
    })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .where(and(eq(workOrders.organizationId, ctx.organizationId), eq(workOrders.siteId, siteId), inArray(workOrders.status, ["released", "in_progress"])))
    .orderBy(sql`${workOrders.neededBy} asc nulls last`, asc(workOrders.plannedStart), asc(workOrders.createdAt))
    .limit(500);
  const orderFacts = await loadBatchFacts(orders.map((o) => o.wo.id));
  let planned = new Decimal(0);
  let missingMaterials = 0;
  const next: FloorNextRow[] = [];
  for (const o of orders) {
    const bf = orderFacts.get(o.wo.id) ?? [];
    const view = productionOrderStatus(o.wo.status, bf, now);
    const expected = piecesOf(o.wo, o.unitNetMassG, o.yieldPct, null, o.productFamily).expectedUnits;
    if (view.status === "in_progress") planned = planned.plus(expected);
    if (view.status !== "approved") continue;
    // An order whose batch has its materials ready is already on a "Making now" card.
    if (bf.some((b) => (MAKING_STATES as readonly string[]).includes(b.status))) continue;
    const short = Array.isArray(o.wo.releaseShortages) && o.wo.releaseShortages.length > 0;
    if (short) missingMaterials += 1;
    const n = new Decimal(expected).toFixed(0);
    next.push({
      workOrderId: o.wo.id,
      productName: o.productName,
      piecesText: `${Number(n).toLocaleString("en-PH")} ${pieceWord(o.productFamily, n)}`,
      neededBy: o.wo.neededBy,
      neededByText: o.wo.neededBy ? `Needed by ${neededWord(o.wo.neededBy, today)}` : `Start ${neededWord(o.wo.plannedStart, today)}`,
      late: isLate(o.wo.neededBy, view.status, today),
      missingMaterials: short,
    });
  }

  // ---------------------------------------------------------------- today
  let todayPanel: FloorDisplay["today"] = null;
  if (ctx.canAt("production.daily_log.view", siteId)) {
    const s = await defectSummary(ctx, { siteId, from: today, to: today });
    const plannedText = planned.gt(0) ? planned.toFixed(0) : null;
    todayPanel = {
      made: s.totals.good,
      rejects: s.totals.defects,
      rejectPct: s.totals.defectPct,
      planned: plannedText,
      percentOfPlan: plannedText ? pct(s.totals.good, plannedText) : null,
    };
  }

  return {
    site: { id: site.id, code: site.code, name: site.name },
    generatedAt: now.toISOString(),
    date: today,
    makingNow: { cards: cards.slice(0, FLOOR_MAX_MAKING), total: cards.length, more: Math.max(0, cards.length - FLOOR_MAX_MAKING) },
    nextUp: { rows: next.slice(0, FLOOR_MAX_NEXT), total: next.length, more: Math.max(0, next.length - FLOOR_MAX_NEXT) },
    waiting: {
      curing: cards.filter((c) => c.wait && !c.wait.over).length,
      curingDone: cards.filter((c) => c.wait?.over).length,
      qualityCheck: qc.length,
      qualityCheckOldestSince: oldestQc ? oldestQc.toISOString() : null,
      qualityCheckOldestText: oldestQc ? ageText(oldestQc, now) : null,
      missingMaterials,
    },
    today: todayPanel,
  };
}

/** "today", "tomorrow", "yesterday", else "Fri 31 Oct" (dates as on the order screens). */
function neededWord(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date === addDays(today, -1)) return "yesterday";
  return shortDay(new Date(date + "T12:00:00+08:00"));
}
