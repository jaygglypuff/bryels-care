import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  batches,
  goodsReceipts,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  organizations,
  products,
  salesOrderLines,
  salesOrders,
  userSiteAssignments,
  users,
} from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { D } from "@/lib/qty";

/**
 * Owner overview and operator home read models (docs/analytics-kpis.md §2.1, §3).
 * Every figure is computed live from posted transactions in the caller's allowed sites; nothing is cached
 * or estimated. Each section is only computed when the caller also holds the view permission of the
 * module the figure comes from (analytics-kpis §1.5).
 */

// ---------- scope ----------

export type DashboardScope = { all: boolean; siteIds: string[]; sites: SiteRef[]; label: string };

/** Current site by default; every allowed site when ?scope=all and the user has more than one site. */
export function resolveScope(ctx: AuthContext, wantAll: boolean): DashboardScope {
  const all = wantAll && ctx.allowedSites.length > 1;
  const sites = all ? ctx.allowedSites : [ctx.currentSite];
  for (const s of sites) ctx.requireSite(s.id);
  return {
    all,
    siteIds: sites.map((s) => s.id),
    sites,
    label: all ? `All my sites (${sites.map((s) => s.code).join(", ")})` : `${ctx.currentSite.code} · ${ctx.currentSite.name}`,
  };
}

/** True when the user holds an organization-wide assignment (sees org-level audit events). */
export async function isOrganizationWide(ctx: AuthContext): Promise<boolean> {
  const rows = await db
    .select({ id: userSiteAssignments.id })
    .from(userSiteAssignments)
    .where(and(eq(userSiteAssignments.userId, ctx.userId), eq(userSiteAssignments.isOrganizationWide, true)))
    .limit(1);
  return rows.length > 0;
}

// ---------- helpers ----------

const toDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const DAY_MS = 86_400_000;

/** Adds n days to a YYYY-MM-DD string (calendar arithmetic, timezone-free). */
export function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY_MS);
}

async function orgClock(ctx: AuthContext): Promise<{ tz: string; today: string }> {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const tz = o?.tz ?? "Asia/Manila";
  const [r] = await db.execute<{ today: string }>(sql`select ((now() at time zone ${tz})::date)::text as today`);
  return { tz, today: r.today };
}

/** Start instant (timestamptz) of local calendar day `isoDate` in `tz`, as a SQL fragment. */
const dayStart = (isoDate: string, tz: string) => sql`((${isoDate}::date)::timestamp at time zone ${tz})`;

/** On-hand quantity per lot (only positive balances) within the given sites. */
function onHandSubquery(siteIds: string[]) {
  return db
    .select({
      lotId: inventoryBalances.lotId,
      qty: sql<string>`sum(${inventoryBalances.qtyBase})`.as("qty"),
      locs: sql<string>`string_agg(${locations.code}, ', ' order by ${inventoryBalances.qtyBase} desc)`.as("locs"),
    })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(inArray(inventoryBalances.siteId, siteIds), gt(inventoryBalances.qtyBase, "0")))
    .groupBy(inventoryBalances.lotId)
    .as("oh");
}

// ---------- owner overview ----------

export type BoardCard = {
  id: string;
  batchNumber: string;
  status: string;
  productName: string;
  plannedSizeG: string;
  siteCode: string;
  meta: string;
  stepsDone: number;
  stepsTotal: number;
};

export type NearExpiryLot = {
  id: string;
  lotNumber: string;
  itemName: string;
  itemCode: string;
  expiresOn: string;
  daysToExpiry: number;
  onHand: string;
  uom: string;
  locations: string;
  status: string;
  siteCode: string;
};

export type ActivityRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityNumber: string | null;
  actorName: string | null;
  occurredAt: Date;
  siteCode: string | null;
};

export type OwnerDashboard = {
  scope: DashboardScope;
  generatedAt: Date;
  today: string;
  timezone: string;
  orders: null | {
    count7: number;
    countPrev7: number;
    value7: string;
    daily: { day: string; count: number }[];
  };
  output: null | {
    batches: number;
    awaitingQc: number;
    units: string;
    outputG: string;
    plannedG: string;
    yieldPct: string | null;
  };
  fefo: null | { releasedExpiring30: number; within14: number; expiredOnHand: number };
  qa: null | { quarantinedLots: number; awaitingQcBatches: number; onHoldLots: number; oldestDays: number | null };
  board: null | { planned: BoardCard[]; inProcess: BoardCard[]; awaitingQc: BoardCard[]; released: BoardCard[] };
  nearExpiry: null | { rows: NearExpiryLot[]; total: number };
  fulfilment: null | { byStatus: { status: string; count: number }[]; total: number; cancelled: number };
  activity: null | ActivityRow[];
  /** People who posted work in scope in the last 30 days (avatar row on the batch journey board). */
  team: null | { userId: string; name: string; actions: number }[];
};

export const NEAR_EXPIRY_WINDOW_DAYS = 30;
const BOARD_RELEASED_DAYS = 14;
export const BOARD_LIMIT = 6;
const NEAR_EXPIRY_LIMIT = 10;

export async function getOwnerDashboard(ctx: AuthContext, scope: DashboardScope): Promise<OwnerDashboard> {
  ctx.require("analytics.dashboard.view");
  for (const id of scope.siteIds) ctx.requireSite(id);
  const { tz, today } = await orgClock(ctx);
  const siteCode = new Map(ctx.allowedSites.map((s) => [s.id, s.code]));
  const ids = scope.siteIds;

  const [orders, output, fefo, qa, board, nearExpiry, fulfilment, activity, team] = await Promise.all([
    ctx.can("sales.sales_order.view") ? ordersKpi(ids, tz, today) : null,
    ctx.can("production.batch.view") ? outputKpi(ids, tz, today) : null,
    ctx.can("inventory.lot.view") ? fefoKpi(ids, today) : null,
    ctx.can("quality.disposition.view") ? qaKpi(ids, today, tz) : null,
    ctx.can("production.batch.view") ? productionBoard(ids, tz, today, siteCode) : null,
    ctx.can("inventory.lot.view") ? nearExpiryLots(ids, today, siteCode) : null,
    ctx.can("sales.sales_order.view") ? fulfilmentDonut(ids, tz, today) : null,
    ctx.can("platform.audit.view") ? recentActivity(ctx, scope, siteCode) : null,
    ctx.can("production.batch.view") ? teamActivity(scope.siteIds) : null,
  ]);

  return { scope, generatedAt: new Date(), today, timezone: tz, orders, output, fefo, qa, board, nearExpiry, fulfilment, activity, team };
}

/** Actors with posted changes (non-view, non-session events) at the scope's sites in the last 30 days. */
async function teamActivity(siteIds: string[]) {
  const n = sql<number>`count(*)::int`;
  const rows = await db
    .select({ userId: users.id, name: users.displayName, actions: n })
    .from(auditEvents)
    .innerJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        inArray(auditEvents.siteId, siteIds),
        sql`${auditEvents.occurredAt} >= now() - interval '30 days'`,
        sql`${auditEvents.action} not like '%.viewed'`,
        sql`${auditEvents.action} not like 'identity.session.%'`,
      ),
    )
    .groupBy(users.id, users.displayName)
    .orderBy(desc(n))
    .limit(8);
  return rows.map((r) => ({ ...r, actions: Number(r.actions) }));
}

/** KPI-OWN-01: sales orders created in the last 7 local days (today included), cancelled excluded. */
async function ordersKpi(siteIds: string[], tz: string, today: string) {
  const from14 = addDays(today, -13);
  const from7 = addDays(today, -6);
  const localDay = sql<string>`((${salesOrders.createdAt} at time zone ${tz})::date)::text`;
  const daily = await db
    .select({ day: localDay, n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(and(inArray(salesOrders.siteId, siteIds), sql`${salesOrders.status} <> 'cancelled'`, sql`${salesOrders.createdAt} >= ${dayStart(from14, tz)}`))
    .groupBy(sql`1`); // positional: the parametrised tz makes the expression differ textually
  const byDay = new Map(daily.map((r) => [r.day, Number(r.n)]));
  const series = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(from14, i);
    return { day, count: byDay.get(day) ?? 0 };
  });
  const [v] = await db
    .select({ value: sql<string>`coalesce(sum(${salesOrderLines.qtyUnits} * ${salesOrderLines.unitPrice}), 0)::text` })
    .from(salesOrders)
    .leftJoin(salesOrderLines, eq(salesOrderLines.salesOrderId, salesOrders.id))
    .where(and(inArray(salesOrders.siteId, siteIds), sql`${salesOrders.status} <> 'cancelled'`, sql`${salesOrders.createdAt} >= ${dayStart(from7, tz)}`));
  const count7 = series.slice(7).reduce((a, r) => a + r.count, 0);
  const countPrev7 = series.slice(0, 7).reduce((a, r) => a + r.count, 0);
  return { count7, countPrev7, value7: v?.value ?? "0", daily: series };
}

/** KPI-OWN-04 (MVP form): batches completed in the last 30 local days; units, mass and mass-weighted yield. */
async function outputKpi(siteIds: string[], tz: string, today: string) {
  const from30 = addDays(today, -29);
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      awaiting: sql<number>`count(*) filter (where ${batches.status} = 'awaiting_qc')::int`,
      units: sql<string>`coalesce(sum(${batches.actualUnits}), 0)::text`,
      outputG: sql<string>`coalesce(sum(${batches.actualOutputG}), 0)::text`,
      plannedG: sql<string>`coalesce(sum(${batches.plannedSizeG}), 0)::text`,
      yOut: sql<string | null>`sum(${batches.actualOutputG}) filter (where ${batches.theoreticalYieldG} > 0)::text`,
      yTheo: sql<string | null>`sum(${batches.theoreticalYieldG}) filter (where ${batches.theoreticalYieldG} > 0 and ${batches.actualOutputG} is not null)::text`,
    })
    .from(batches)
    .where(and(inArray(batches.siteId, siteIds), sql`${batches.completedAt} is not null`, sql`${batches.completedAt} >= ${dayStart(from30, tz)}`, sql`${batches.status} <> 'rejected'`));
  const yieldPct = r?.yOut && r?.yTheo && D(r.yTheo).gt(0) ? D(r.yOut).div(r.yTheo).mul(100).toFixed(1) : null;
  return {
    batches: Number(r?.n ?? 0),
    awaitingQc: Number(r?.awaiting ?? 0),
    units: r?.units ?? "0",
    outputG: r?.outputG ?? "0",
    plannedG: r?.plannedG ?? "0",
    yieldPct,
  };
}

/** KPI-OWN-08: released lots with stock on hand expiring within 30 days; expired lots still on hand. */
async function fefoKpi(siteIds: string[], today: string) {
  const oh = onHandSubquery(siteIds);
  const until30 = addDays(today, NEAR_EXPIRY_WINDOW_DAYS);
  const until14 = addDays(today, 14);
  const [r] = await db
    .select({
      released30: sql<number>`count(*) filter (where ${inventoryLots.qualityStatus} = 'released' and ${inventoryLots.expiresOn} >= ${today}::date and ${inventoryLots.expiresOn} <= ${until30}::date)::int`,
      within14: sql<number>`count(*) filter (where ${inventoryLots.qualityStatus} = 'released' and ${inventoryLots.expiresOn} >= ${today}::date and ${inventoryLots.expiresOn} <= ${until14}::date)::int`,
      expired: sql<number>`count(*) filter (where ${inventoryLots.qualityStatus} = 'expired' or ${inventoryLots.expiresOn} < ${today}::date)::int`,
    })
    .from(inventoryLots)
    .innerJoin(oh, eq(oh.lotId, inventoryLots.id))
    .where(inArray(inventoryLots.siteId, siteIds));
  return { releasedExpiring30: Number(r?.released30 ?? 0), within14: Number(r?.within14 ?? 0), expiredOnHand: Number(r?.expired ?? 0) };
}

/** KPI-OWN-10 (MVP form): quarantined lots + batches awaiting QC; oldest age in days. */
async function qaKpi(siteIds: string[], today: string, tz: string) {
  const [l] = await db
    .select({
      q: sql<number>`count(*) filter (where ${inventoryLots.qualityStatus} = 'quarantine')::int`,
      hold: sql<number>`count(*) filter (where ${inventoryLots.qualityStatus} = 'on_hold')::int`,
      oldest: sql<string | null>`(min(${inventoryLots.createdAt}) filter (where ${inventoryLots.qualityStatus} = 'quarantine'))::text`,
    })
    .from(inventoryLots)
    .where(inArray(inventoryLots.siteId, siteIds));
  const enteredQc = sql`coalesce((select max(t.at) from batch_state_transitions t where t.batch_id = "batches"."id" and t.to_state = 'awaiting_qc'), ${batches.completedAt}, ${batches.createdAt})`;
  const [b] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`(min(${enteredQc}))::text` })
    .from(batches)
    .where(and(inArray(batches.siteId, siteIds), eq(batches.status, "awaiting_qc")));
  const oldest = [toDate(l?.oldest), toDate(b?.oldest)].filter((d): d is Date => !!d).sort((a, z) => a.getTime() - z.getTime())[0];
  const oldestDays = oldest ? Math.max(0, diffDays(today, oldest.toLocaleDateString("en-CA", { timeZone: tz }))) : null;
  return { quarantinedLots: Number(l?.q ?? 0), awaitingQcBatches: Number(b?.n ?? 0), onHoldLots: Number(l?.hold ?? 0), oldestDays };
}

async function productionBoard(siteIds: string[], tz: string, today: string, siteCode: Map<string, string>) {
  const releasedAt = sql<string | null>`(coalesce(
      (select max(d.decided_at) from dispositions d where d.subject_type = 'batch' and d.subject_id = "batches"."id" and d.decision = 'release'),
      (select max(t.at) from batch_state_transitions t where t.batch_id = "batches"."id" and t.to_state = 'released')))::text`;
  const stepsDone = sql<number>`(select count(*)::int from process_step_records p where p.batch_id = "batches"."id")`;
  const stepsTotal = sql<number>`coalesce(jsonb_array_length(${batches.formulaSnapshot}->'steps'), 0)`;
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      siteId: batches.siteId,
      plannedSizeG: batches.plannedSizeG,
      plannedStartOn: batches.plannedStartOn,
      startedAt: batches.startedAt,
      completedAt: batches.completedAt,
      productName: products.name,
      releasedAt,
      stepsDone,
      stepsTotal,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(inArray(batches.siteId, siteIds), inArray(batches.status, ["planned", "materials_staged", "in_process", "awaiting_qc", "released"])))
    .orderBy(asc(batches.batchNumber));
  const releasedFrom = Date.parse(addDays(today, -(BOARD_RELEASED_DAYS - 1)) + "T00:00:00Z");
  const local = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: tz }) : "");
  const localTime = (d: Date | null) => (d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "");
  const col = { planned: [] as BoardCard[], inProcess: [] as BoardCard[], awaitingQc: [] as BoardCard[], released: [] as BoardCard[] };
  for (const r of rows) {
    const rel = toDate(r.releasedAt);
    const base = {
      id: r.id,
      batchNumber: r.batchNumber,
      status: r.status,
      productName: r.productName,
      plannedSizeG: r.plannedSizeG,
      siteCode: siteCode.get(r.siteId) ?? "",
      stepsDone: Number(r.stepsDone),
      stepsTotal: Number(r.stepsTotal),
    };
    if (r.status === "planned") col.planned.push({ ...base, meta: r.plannedStartOn ? `Starts ${local(new Date(r.plannedStartOn + "T00:00:00Z"))}` : "No start date" });
    else if (r.status === "materials_staged" || r.status === "in_process")
      col.inProcess.push({ ...base, meta: r.startedAt ? `Started ${local(r.startedAt)} ${localTime(r.startedAt)}` : "Materials staged" });
    else if (r.status === "awaiting_qc") col.awaitingQc.push({ ...base, meta: r.completedAt ? `Completed ${local(r.completedAt)}` : "Awaiting QC" });
    else if (r.status === "released" && rel) {
      const relLocal = rel.toLocaleDateString("en-CA", { timeZone: tz });
      if (Date.parse(relLocal + "T00:00:00Z") >= releasedFrom) col.released.push({ ...base, meta: `Released ${local(rel)}` });
    }
  }
  col.released.sort((a, b) => b.batchNumber.localeCompare(a.batchNumber));
  return {
    planned: col.planned,
    inProcess: col.inProcess,
    awaitingQc: col.awaitingQc,
    released: col.released,
  };
}

async function nearExpiryLots(siteIds: string[], today: string, siteCode: Map<string, string>) {
  const oh = onHandSubquery(siteIds);
  const until = addDays(today, NEAR_EXPIRY_WINDOW_DAYS);
  const where = and(inArray(inventoryLots.siteId, siteIds), sql`${inventoryLots.expiresOn} is not null`, sql`${inventoryLots.expiresOn} <= ${until}::date`);
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      siteId: inventoryLots.siteId,
      expiresOn: inventoryLots.expiresOn,
      status: inventoryLots.qualityStatus,
      uom: inventoryLots.baseUom,
      onHand: oh.qty,
      locs: oh.locs,
      materialName: materials.name,
      materialCode: materials.code,
      productName: products.name,
      productCode: products.skuCode,
    })
    .from(inventoryLots)
    .innerJoin(oh, eq(oh.lotId, inventoryLots.id))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(where)
    .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber))
    .limit(NEAR_EXPIRY_LIMIT);
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryLots).innerJoin(oh, eq(oh.lotId, inventoryLots.id)).where(where);
  return {
    total: Number(c?.n ?? 0),
    rows: rows.map((r) => {
      const expiresOn = r.expiresOn!;
      const daysToExpiry = diffDays(expiresOn, today);
      return {
        id: r.id,
        lotNumber: r.lotNumber,
        itemName: r.materialName ?? r.productName ?? "—",
        itemCode: r.materialCode ?? r.productCode ?? "",
        expiresOn,
        daysToExpiry,
        onHand: String(r.onHand),
        uom: r.uom,
        locations: String(r.locs ?? ""),
        // A lot past its date is shown as expired even before the expiry job flips the status.
        status: daysToExpiry < 0 && r.status === "released" ? "expired" : r.status,
        siteCode: siteCode.get(r.siteId) ?? "",
      } satisfies NearExpiryLot;
    }),
  };
}

export const FULFILMENT_STATUSES = ["draft", "confirmed", "allocated", "shipped"] as const;

async function fulfilmentDonut(siteIds: string[], tz: string, today: string) {
  const from30 = addDays(today, -29);
  const rows = await db
    .select({ status: salesOrders.status, n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(and(inArray(salesOrders.siteId, siteIds), sql`${salesOrders.createdAt} >= ${dayStart(from30, tz)}`))
    .groupBy(salesOrders.status);
  const m = new Map(rows.map((r) => [r.status, Number(r.n)]));
  const byStatus = FULFILMENT_STATUSES.map((s) => ({ status: s, count: m.get(s) ?? 0 }));
  return { byStatus, total: byStatus.reduce((a, r) => a + r.count, 0), cancelled: m.get("cancelled") ?? 0 };
}

async function recentActivity(ctx: AuthContext, scope: DashboardScope, siteCode: Map<string, string>): Promise<ActivityRow[]> {
  const orgWide = scope.all && (await isOrganizationWide(ctx));
  const siteFilter = orgWide ? or(inArray(auditEvents.siteId, scope.siteIds), isNull(auditEvents.siteId)) : inArray(auditEvents.siteId, scope.siteIds);
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      entityNumber: auditEvents.entityNumber,
      siteId: auditEvents.siteId,
      occurredAt: auditEvents.occurredAt,
      actorName: users.displayName,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        eq(auditEvents.organizationId, ctx.organizationId),
        siteFilter,
        // Activity = changes. Read events (*.viewed) and sign-ins stay in the audit log only.
        sql`${auditEvents.action} not like '%.viewed'`,
        sql`${auditEvents.action} not like 'identity.session.%'`,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(8);
  return rows.map((r) => ({ ...r, siteCode: r.siteId ? (siteCode.get(r.siteId) ?? null) : null }));
}

// ---------- operator home ----------

export type OperatorTile = {
  key: "receive" | "scan" | "batches" | "qa" | "dispatch";
  title: string;
  href: string;
  count: number;
  countLabel: string;
  description: string;
};

/** Task tiles for users without analytics.dashboard.view; each tile needs its own module permission. */
export async function getOperatorHome(ctx: AuthContext): Promise<OperatorTile[]> {
  ctx.requireSite(ctx.currentSiteId);
  const site = ctx.currentSiteId;
  const { tz, today } = await orgClock(ctx);
  const tiles: Promise<OperatorTile>[] = [];

  if (ctx.can("procurement.goods_receipt.create"))
    tiles.push(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.siteId, site), sql`${goodsReceipts.receivedAt} >= ${dayStart(today, tz)}`))
        .then(([r]) => ({ key: "receive", title: "Receive materials", href: "/inventory/receive", count: Number(r?.n ?? 0), countLabel: "receipts posted today", description: "Post a goods receipt, create lots in quarantine and print labels." })),
    );
  if (ctx.can("inventory.lot.view")) {
    const oh = onHandSubquery([site]);
    tiles.push(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(inventoryLots)
        .innerJoin(oh, eq(oh.lotId, inventoryLots.id))
        .where(eq(inventoryLots.siteId, site))
        .then(([r]) => ({ key: "scan", title: "Scan / look up", href: "/inventory/scan", count: Number(r?.n ?? 0), countLabel: "lots with stock on hand", description: "Scan a lot, box or location label, or type its number." })),
    );
  }
  if (ctx.can("production.batch.view"))
    tiles.push(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(batches)
        .where(and(eq(batches.siteId, site), inArray(batches.status, ["materials_staged", "in_process"])))
        .then(([r]) => ({
          key: "batches",
          title: ctx.can("production.dispense_record.create") ? "Weigh batch" : "Batches",
          href: "/production",
          count: Number(r?.n ?? 0),
          countLabel: "batches in process",
          description: "Open a batch to weigh materials and complete process steps.",
        })),
    );
  if (ctx.can("quality.disposition.view"))
    tiles.push(
      Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(inventoryLots).where(and(eq(inventoryLots.siteId, site), eq(inventoryLots.qualityStatus, "quarantine"))),
        db.select({ n: sql<number>`count(*)::int` }).from(batches).where(and(eq(batches.siteId, site), eq(batches.status, "awaiting_qc"))),
      ]).then(([[l], [b]]) => ({
        key: "qa",
        title: "QA queue",
        href: "/quality",
        count: Number(l?.n ?? 0) + Number(b?.n ?? 0),
        countLabel: `waiting for QA (${Number(l?.n ?? 0)} lots, ${Number(b?.n ?? 0)} batches)`,
        description: "Review quarantined lots and batches awaiting QC.",
      })),
    );
  if (ctx.can("sales.sales_order.view"))
    tiles.push(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(salesOrders)
        .where(and(eq(salesOrders.siteId, site), eq(salesOrders.status, "allocated")))
        .then(([r]) => ({ key: "dispatch", title: "Dispatch orders", href: "/sales", count: Number(r?.n ?? 0), countLabel: "orders allocated, ready to ship", description: "Pick allocated stock, dispatch and print the delivery receipt." })),
    );
  return Promise.all(tiles);
}

