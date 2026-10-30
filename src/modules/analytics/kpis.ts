import "server-only";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { backgroundJobs, kpiDefinitions, kpiReconciliationResults, kpiRefreshLog, kpiSavedViews, kpiSnapshots, organizations, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { DASHBOARD_KPIS, KPIS, type KpiDefinition, UNAVAILABLE_KPIS, type UnavailableKpi, kpiByCode } from "./kpi/catalogue";
import { Dx, type KpiRow, type KpiSettings, type KpiValue, aggregate, fetchRows, queryParams, round, rowsForScope } from "./kpi/engine";
import { type Grain, type Period, type PeriodKey, PERIOD_LABELS, addDays, addMonths, bucketEnd, bucketStart, diffDays, isIsoDate, isPeriodKey, localDate, periodOf, resolvePeriod } from "./kpi/time";

/**
 * KPI read services (US-5-02, US-5-03, US-5-16). Every function takes the AuthContext first, checks
 * the analytics permission, resolves the scope to the caller's allowed sites only, and masks KPIs
 * whose class permissions the caller lacks (docs/analytics-kpis.md §1.5) in the DTO, never in the UI
 * alone. Live values aggregate the KPI record query with decimal.js; sparklines and trends read the
 * append-only snapshots. Nothing here writes business data.
 */

// ---------------------------------------------------------------- scope

export type KpiScope = {
  /** "all" or the site id. */
  key: string;
  all: boolean;
  siteIds: string[];
  sites: (SiteRef & { tz: string })[];
  label: string;
  tz: string;
  /** The scope covers every active site of the organization (the `all` snapshots apply). */
  coversAllActive: boolean;
};

export function canSeeCrossSite(ctx: AuthContext): boolean {
  return ctx.can("analytics.owner_dashboard.view") && ctx.allowedSites.length > 1;
}

/**
 * "all" = every allowed site, only with analytics.owner_dashboard.view; a site id must be one of the
 * caller's sites (404 otherwise, so a site outside the scope is never confirmed); default: all sites
 * for owner roles, else the current site.
 */
export async function resolveKpiScope(ctx: AuthContext, requested?: string | null): Promise<KpiScope> {
  const wantAll = requested === "all" || ((requested === undefined || requested === null || requested === "") && canSeeCrossSite(ctx));
  if (wantAll && !ctx.can("analytics.owner_dashboard.view")) throw new DomainError("forbidden", "Cross-site figures need the owner dashboard permission (analytics.owner_dashboard.view).");
  let chosen: SiteRef[];
  if (wantAll) chosen = ctx.allowedSites;
  else {
    const id = requested && requested !== "all" ? requested : ctx.currentSiteId;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Record not found in your sites.");
    ctx.requireSite(id);
    chosen = ctx.allowedSites.filter((s) => s.id === id);
  }
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const orgTz = org?.tz ?? "Asia/Manila";
  const rows = await db.select({ id: sites.id, tz: sites.timezone, active: sites.isActive }).from(sites).where(eq(sites.organizationId, ctx.organizationId));
  const tzOf = new Map(rows.map((r) => [r.id, r.tz]));
  const activeIds = rows.filter((r) => r.active).map((r) => r.id);
  const withTz = chosen.map((s) => ({ ...s, tz: tzOf.get(s.id) ?? orgTz }));
  const all = wantAll && chosen.length > 1;
  const siteIds = withTz.map((s) => s.id);
  return {
    key: all ? "all" : siteIds[0],
    all,
    siteIds,
    sites: withTz,
    label: all ? `All sites (${withTz.map((s) => s.code).join(", ")})` : `${withTz[0].code} · ${withTz[0].name}`,
    tz: all ? orgTz : withTz[0].tz,
    coversAllActive: siteIds.length === activeIds.length && activeIds.every((id) => siteIds.includes(id)),
  };
}

/** Every permission of the KPI, at every site of the scope. */
export function canSeeKpi(ctx: AuthContext, perms: readonly Permission[], siteIds: string[]): boolean {
  return perms.every((p) => ctx.can(p) && siteIds.every((s) => ctx.canAt(p, s)));
}

async function kpiSettings(organizationId: string): Promise<KpiSettings> {
  return {
    fefoWindowDays: await getSetting(db, organizationId, "analytics.fefo_window_days"),
    otifGraceDays: await getSetting(db, organizationId, "analytics.otif_grace_days"),
  };
}

// ---------------------------------------------------------------- DTOs

export type KpiNumber = { value: string | null; numerator: string; denominator: string | null; rowCount: number };
const dto = (v: KpiValue): KpiNumber => ({
  value: v.value === null ? null : v.value.toString(),
  numerator: round(v.numerator).toString(),
  denominator: v.denominator === null ? null : round(v.denominator).toString(),
  rowCount: v.rowCount,
});

export type KpiMeta = Pick<KpiDefinition, "code" | "name" | "short" | "unit" | "label" | "kind" | "aggregate" | "better" | "definition" | "formula" | "timeBasis" | "sources" | "refresh" | "area">;
const meta = (d: KpiDefinition): KpiMeta => ({
  code: d.code,
  name: d.name,
  short: d.short,
  unit: d.unit,
  label: d.label,
  kind: d.kind,
  aggregate: d.aggregate,
  better: d.better,
  definition: d.definition,
  formula: d.formula,
  timeBasis: d.timeBasis,
  sources: d.sources,
  refresh: d.refresh,
  area: d.area,
});

export type Breakdown = { key: string; label: string; tone: "good" | "bad" | "neutral" | "warn"; rows: number; num: string };
export type DayPoint = { date: string; value: string | null; numerator: string; denominator: string | null; rowCount: number };
export type SparkPoint = { periodStart: string; value: string | null };

export type KpiTile = KpiMeta & {
  masked: boolean;
  current: KpiNumber | null;
  previous: KpiNumber | null;
  /** Rows grouped by `category` (donuts, bar breakdowns). */
  breakdown: Breakdown[] | null;
  /** Period KPIs: the value per local day of the period (column and line charts). */
  daily: DayPoint[] | null;
  /** Last 12 nightly day snapshots of the scope (sparkline); null when none or not combinable. */
  sparkline: SparkPoint[] | null;
  href: string;
  asOf: string;
};

export type PeriodDto = { key: string; label: string; fromDate: string; toDate: string; previousLabel: string; previousFromDate: string; previousToDate: string };
const periodDto = (cur: Period, prev: Period): PeriodDto => ({ key: cur.key, label: cur.label, fromDate: cur.fromDate, toDate: cur.toDate, previousLabel: prev.label, previousFromDate: prev.fromDate, previousToDate: prev.toDate });

export function drillHref(code: string, scope: KpiScope, p: { fromDate: string; toDate: string }) {
  return `/analytics/kpi/${code}?scope=${scope.key}&from=${p.fromDate}&to=${p.toDate}`;
}

function breakdownOf(def: KpiDefinition, rows: KpiRow[]): Breakdown[] {
  const m = new Map<string, { rows: number; num: InstanceType<typeof Dx> }>();
  for (const r of rows) {
    const k = r.category ?? "none";
    const e = m.get(k) ?? { rows: 0, num: new Dx(0) };
    e.rows += 1;
    e.num = e.num.plus(r.num ?? 0);
    m.set(k, e);
  }
  const known = def.categories ?? [];
  const keys = [...known.map((c) => c.key).filter((k) => m.has(k)), ...[...m.keys()].filter((k) => !known.some((c) => c.key === k)).sort()];
  return keys.map((k) => {
    const c = known.find((x) => x.key === k);
    const e = m.get(k)!;
    return { key: k, label: c?.label ?? k.replace(/_/g, " "), tone: c?.tone ?? "neutral", rows: e.rows, num: e.num.toString() };
  });
}

function dailyOf(def: KpiDefinition, rows: KpiRow[], period: Period): DayPoint[] {
  const days = Math.min(diffDays(period.toDate, period.fromDate), 92);
  const by = new Map<string, KpiRow[]>();
  for (const r of rows) {
    if (!r.basis_at) continue;
    const d = localDate(r.basis_at instanceof Date ? r.basis_at : new Date(r.basis_at), period.tz);
    by.set(d, [...(by.get(d) ?? []), r]);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(period.fromDate, i);
    const v = aggregate(def, by.get(date) ?? []);
    return { date, ...dto(v) };
  });
}

// ---------------------------------------------------------------- live computation

type ComputeOpts = { breakdown?: boolean; daily?: boolean; previous?: boolean };

async function liveRows(def: KpiDefinition, siteIds: string[], tz: string, period: Period, now: Date, settings: KpiSettings, includeOrgLevel: boolean) {
  const p = queryParams({ siteIds, fromDate: period.fromDate, toDate: period.toDate, tz, now, source: "projection", includeOrgLevel, settings });
  return { rows: await fetchRows(db, def, p), asOf: p.asOf };
}

async function computeTile(ctx: AuthContext, def: KpiDefinition, scope: KpiScope, cur: Period, prev: Period, now: Date, settings: KpiSettings, opts: ComputeOpts): Promise<KpiTile & { _rows?: KpiRow[] }> {
  const base = { ...meta(def), href: drillHref(def.code, scope, cur), sparkline: null };
  if (!canSeeKpi(ctx, def.permissions, scope.siteIds)) return { ...base, masked: true, current: null, previous: null, breakdown: null, daily: null, asOf: now.toISOString() };
  const { rows, asOf } = await liveRows(def, scope.siteIds, scope.tz, cur, now, settings, scope.all);
  const previous = opts.previous === false ? null : dto(aggregate(def, (await liveRows(def, scope.siteIds, scope.tz, prev, now, settings, scope.all)).rows));
  return {
    ...base,
    masked: false,
    current: dto(aggregate(def, rows)),
    previous,
    breakdown: opts.breakdown ? breakdownOf(def, rows) : null,
    daily: opts.daily && def.kind === "period" ? dailyOf(def, rows, cur) : null,
    asOf: asOf.toISOString(),
    _rows: rows,
  };
}

// ---------------------------------------------------------------- snapshots: sparklines and freshness

type SnapRow = typeof kpiSnapshots.$inferSelect;

/** Combines per-site snapshots for a scope that is not the `all` scope (additive KPIs only). */
function combine(def: KpiDefinition, rows: SnapRow[], siteIds: string[]): KpiNumber | null {
  if (rows.length !== siteIds.length) return null;
  const norm = (v: string | null) => (v === null ? null : new Dx(v).toString());
  if (rows.length === 1) return { value: norm(rows[0].value), numerator: norm(rows[0].numerator)!, denominator: norm(rows[0].denominator), rowCount: rows[0].rowCount };
  if (!def.additive) return null;
  const n = rows.reduce((a, r) => a.plus(r.numerator), new Dx(0));
  const d = def.aggregate === "ratio" ? rows.reduce((a, r) => a.plus(r.denominator ?? 0), new Dx(0)) : null;
  const value = def.aggregate === "ratio" ? (d!.gt(0) ? round(n.div(d!)).toString() : null) : round(n).toString();
  return { value, numerator: round(n).toString(), denominator: d ? round(d).toString() : null, rowCount: rows.reduce((a, r) => a + r.rowCount, 0) };
}

const scopeKeys = (scope: KpiScope) => (scope.coversAllActive && scope.all ? ["all"] : scope.siteIds.map((id) => `site:${id}`));

/**
 * Values per bucket from the snapshots. Period KPIs: the snapshot of the bucket (latest as-of date,
 * i.e. the most complete). Point-in-time KPIs: the last day snapshot inside the bucket.
 */
async function snapshotSeries(organizationId: string, def: KpiDefinition, scope: KpiScope, grain: Grain, buckets: string[]): Promise<{ points: (KpiNumber | null)[]; computedAt: Date | null; combinable: boolean }> {
  if (buckets.length === 0) return { points: [], computedAt: null, combinable: true };
  const keys = scopeKeys(scope);
  const combinable = keys.length === 1 || def.additive;
  if (!combinable) return { points: buckets.map(() => null), computedAt: null, combinable };
  const first = buckets[0];
  const last = bucketEnd(buckets[buckets.length - 1], grain);
  const g = def.kind === "asof" ? "day" : grain;
  const rows = await db
    .select()
    .from(kpiSnapshots)
    .where(and(eq(kpiSnapshots.organizationId, organizationId), eq(kpiSnapshots.kpiCode, def.code), eq(kpiSnapshots.grain, g), inArray(kpiSnapshots.scopeKey, keys), gte(kpiSnapshots.periodStart, first), lt(kpiSnapshots.periodStart, last)))
    .orderBy(desc(kpiSnapshots.asOfDate), desc(kpiSnapshots.computedAt));
  let computedAt: Date | null = null;
  const points = buckets.map((b) => {
    const end = bucketEnd(b, grain);
    const pick = new Map<string, SnapRow>();
    for (const r of rows) {
      const inBucket = def.kind === "asof" ? r.periodStart >= b && r.periodStart < end : r.periodStart === b;
      if (!inBucket) continue;
      const cur = pick.get(r.scopeKey);
      // rows are ordered newest as-of first; for as-of KPIs the latest day of the bucket wins
      if (!cur || (def.kind === "asof" && r.periodStart > cur.periodStart)) pick.set(r.scopeKey, r);
    }
    const chosen = [...pick.values()];
    for (const c of chosen) if (!computedAt || c.computedAt > computedAt) computedAt = c.computedAt;
    return chosen.length ? combine(def, chosen, keys) : null;
  });
  return { points, computedAt, combinable };
}

async function sparkline(organizationId: string, def: KpiDefinition, scope: KpiScope, today: string): Promise<SparkPoint[] | null> {
  const buckets = Array.from({ length: 12 }, (_, i) => addDays(today, i - 12));
  const s = await snapshotSeries(organizationId, def, scope, "day", buckets);
  if (s.points.every((p) => p === null)) return null;
  return buckets.map((b, i) => ({ periodStart: b, value: s.points[i]?.value ?? null }));
}

export type Freshness = {
  lastSnapshotAt: string | null;
  lastBusinessDate: string | null;
  stale: boolean;
  reason: string | null;
  failedJobId: string | null;
  lastReconciliation: { at: string; checked: number; mismatches: number; id: string } | null;
};

/** "Updated HH:MM" of snapshot-based visuals and the Stale badge (§1.3: older than twice the cadence, or the last run failed). */
export async function snapshotFreshness(ctx: AuthContext, now = new Date()): Promise<Freshness> {
  const staleHours = await getSetting(db, ctx.organizationId, "analytics.snapshot_stale_hours");
  const [ok] = await db
    .select()
    .from(kpiRefreshLog)
    .where(and(eq(kpiRefreshLog.organizationId, ctx.organizationId), eq(kpiRefreshLog.runKind, "snapshot"), eq(kpiRefreshLog.status, "succeeded")))
    .orderBy(desc(kpiRefreshLog.finishedAt))
    .limit(1);
  const [failed] = await db
    .select({ id: backgroundJobs.id, at: backgroundJobs.updatedAt, error: backgroundJobs.errorMessage })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.organizationId, ctx.organizationId), eq(backgroundJobs.jobKind, "analytics.snapshot_kpis"), eq(backgroundJobs.status, "failed")))
    .orderBy(desc(backgroundJobs.updatedAt))
    .limit(1);
  const [rec] = await db
    .select()
    .from(kpiRefreshLog)
    .where(and(eq(kpiRefreshLog.organizationId, ctx.organizationId), eq(kpiRefreshLog.runKind, "reconcile"), eq(kpiRefreshLog.status, "succeeded")))
    .orderBy(desc(kpiRefreshLog.finishedAt))
    .limit(1);
  const lastAt = ok?.finishedAt ?? null;
  const failedAfter = failed && (!lastAt || failed.at >= lastAt) ? failed : null;
  const tooOld = !lastAt || now.getTime() - lastAt.getTime() > staleHours * 3600_000;
  const reason = failedAfter
    ? `The last KPI snapshot job failed (job ${failedAfter.id.slice(0, 8)}): ${failedAfter.error?.slice(0, 160) ?? "see Diagnostics"}.`
    : !lastAt
      ? "No nightly KPI snapshot has run yet."
      : tooOld
        ? `The last KPI snapshot is older than ${staleHours} hours.`
        : null;
  return {
    lastSnapshotAt: lastAt?.toISOString() ?? null,
    lastBusinessDate: ok?.businessDate ?? null,
    stale: !!reason,
    reason,
    failedJobId: failedAfter?.id ?? null,
    lastReconciliation: rec ? { at: (rec.finishedAt ?? rec.startedAt).toISOString(), checked: rec.checked, mismatches: rec.mismatches, id: rec.id } : null,
  };
}

// ---------------------------------------------------------------- dashboards

export type UnavailableTile = UnavailableKpi & { masked: boolean };

export type DashboardData = {
  scope: KpiScope;
  period: PeriodDto;
  generatedAt: string;
  tiles: Record<string, KpiTile>;
  freshness: Freshness;
};

function pickPeriod(key: string | undefined, fallback: PeriodKey, now: Date, tz: string) {
  const k: PeriodKey = isPeriodKey(key) ? key : fallback;
  return resolvePeriod(k, now, tz);
}

async function computeTiles(ctx: AuthContext, codes: string[], scope: KpiScope, cur: Period, prev: Period, now: Date, opts: Record<string, ComputeOpts> = {}) {
  const settings = await kpiSettings(ctx.organizationId);
  const today = localDate(now, scope.tz);
  const out: Record<string, KpiTile & { _rows?: KpiRow[] }> = {};
  const tiles = await Promise.all(
    codes.map(async (code) => {
      const def = kpiByCode(code)!;
      const t = await computeTile(ctx, def, scope, cur, prev, now, settings, opts[code] ?? {});
      if (!t.masked) t.sparkline = await sparkline(ctx.organizationId, def, scope, today);
      return t;
    }),
  );
  for (const t of tiles) out[t.code] = t;
  return out;
}

const strip = (tiles: Record<string, KpiTile & { _rows?: KpiRow[] }>): Record<string, KpiTile> =>
  Object.fromEntries(Object.entries(tiles).map(([k, { _rows, ...t }]) => (void _rows, [k, t])));

export type ListRow = { refType: string; refId: string | null; refNumber: string | null; siteCode: string | null; at: string | null; num: string | null; den: string | null; item: string | null; detail: string | null; category: string | null };

function toList(rows: KpiRow[], scope: KpiScope, limit = 10): ListRow[] {
  const code = new Map(scope.sites.map((s) => [s.id, s.code]));
  return rows.slice(0, limit).map((r) => ({
    refType: r.ref_type,
    refId: r.ref_id,
    refNumber: r.ref_number,
    siteCode: r.site_id ? (code.get(r.site_id) ?? null) : null,
    at: r.basis_at ? (r.basis_at instanceof Date ? r.basis_at : new Date(r.basis_at)).toISOString() : null,
    num: r.num,
    den: r.den,
    item: r.item,
    detail: r.detail,
    category: r.category,
  }));
}

export type SiteComparisonRow = {
  siteId: string;
  siteCode: string;
  siteName: string;
  cells: Record<string, { masked: boolean; unavailable?: boolean; value: string | null; numerator: string | null; denominator: string | null }>;
};

/** KPI-OWN-14: one row per allowed site (never a site outside the caller's scope, not even its name). */
export const COMPARISON_KPIS = ["KPI-OPS-01", "KPI-OPS-02", "KPI-SAL-02", "KPI-QUA-03", "KPI-INV-04", "KPI-FIN-02"] as const;

async function siteComparison(ctx: AuthContext, cur: Period, now: Date): Promise<SiteComparisonRow[] | null> {
  if (ctx.allowedSites.length < 2) return null;
  const settings = await kpiSettings(ctx.organizationId);
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const tz = org?.tz ?? "Asia/Manila";
  const rows: SiteComparisonRow[] = ctx.allowedSites.map((s) => ({ siteId: s.id, siteCode: s.code, siteName: s.name, cells: {} }));
  const period = periodOf(cur.fromDate, cur.toDate, tz, cur.key, cur.label);
  for (const code of COMPARISON_KPIS) {
    const def = kpiByCode(code)!;
    const visible = rows.filter((r) => canSeeKpi(ctx, def.permissions, [r.siteId]));
    const fetched = visible.length ? await liveRows(def, visible.map((r) => r.siteId), tz, period, now, settings, false) : { rows: [] as KpiRow[] };
    for (const r of rows) {
      if (!visible.includes(r)) {
        r.cells[code] = { masked: true, value: null, numerator: null, denominator: null };
        continue;
      }
      const v = dto(aggregate(def, rowsForScope(def, fetched.rows, { siteId: r.siteId, siteIds: [r.siteId] })));
      r.cells[code] = { masked: false, value: v.value, numerator: v.numerator, denominator: v.denominator };
    }
  }
  for (const r of rows) r.cells["KPI-OWN-07"] = { masked: !canSeeKpi(ctx, ["inventory.lot.view"], [r.siteId]), unavailable: true, value: null, numerator: null, denominator: null };
  return rows;
}

export type OwnerOverview = DashboardData & {
  unavailable: UnavailableTile[];
  comparison: SiteComparisonRow[] | null;
  exceptions: ListRow[] | null;
  canCrossSite: boolean;
};

export const OWNER_TILE_CODES = ["KPI-SAL-01", "KPI-SAL-01V", "KPI-OPS-01", "KPI-INV-04", "KPI-INV-04E", "KPI-QUA-03", "KPI-QUA-03A", "KPI-OPS-02", "KPI-OPS-03", "KPI-INV-07", "KPI-SAL-02", "KPI-FIN-02", "KPI-OWN-13"];

/** US-5-02: owner overview on the KPI engine. Default period: this week (§3). */
export async function getOwnerOverview(ctx: AuthContext, input: { scope?: string | null; period?: string | null; now?: Date } = {}): Promise<OwnerOverview> {
  ctx.require("analytics.dashboard.view");
  const now = input.now ?? new Date();
  const scope = await resolveKpiScope(ctx, input.scope);
  const { current, previous } = pickPeriod(input.period ?? undefined, "week", now, scope.tz);
  const tiles = await computeTiles(ctx, OWNER_TILE_CODES, scope, current, previous, now, { "KPI-SAL-02": { breakdown: true }, "KPI-OWN-13": { breakdown: true, previous: false }, "KPI-SAL-01": { daily: true } });
  const exceptionsTile = tiles["KPI-OWN-13"];
  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const exceptions = exceptionsTile.masked ? null : toList([...(exceptionsTile._rows ?? [])].sort((a, b) => (severityRank[a.category ?? ""] ?? 3) - (severityRank[b.category ?? ""] ?? 3)), scope, 8);
  return {
    scope,
    period: periodDto(current, previous),
    generatedAt: now.toISOString(),
    tiles: strip(tiles),
    freshness: await snapshotFreshness(ctx, now),
    unavailable: UNAVAILABLE_KPIS.map((u) => ({ ...u, masked: !canSeeKpi(ctx, u.permissions, scope.siteIds) })),
    comparison: await siteComparison(ctx, current, now),
    exceptions,
    canCrossSite: canSeeCrossSite(ctx),
  };
}

/**
 * One KPI tile for a named period, or an explicit local-date range [from, to) compared with the same
 * number of days just before it (Home cards and the 7-day sales trend). The value aggregates the KPI's
 * record query, so `href` (the drill-down) lists exactly the rows the number is made of (W11-02).
 */
export async function getKpiTile(
  ctx: AuthContext,
  code: string,
  input: { scope?: string | null; period?: PeriodKey; from?: string; to?: string; daily?: boolean; now?: Date } = {},
): Promise<KpiTile> {
  ctx.require("analytics.dashboard.view");
  const def = kpiByCode(code);
  if (!def) throw new DomainError("not_found", "No such KPI.");
  const now = input.now ?? new Date();
  const scope = await resolveKpiScope(ctx, input.scope);
  let cur: Period;
  let prev: Period;
  if (input.from || input.to) {
    if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.to <= input.from) throw new DomainError("validation", "Choose a valid period (from before to, YYYY-MM-DD).");
    const days = diffDays(input.to, input.from);
    if (days > 400) throw new DomainError("validation", "Choose a period of at most 400 days.");
    cur = periodOf(input.from, input.to, scope.tz, "custom", `${input.from} to ${addDays(input.to, -1)}`);
    prev = periodOf(addDays(input.from, -days), input.from, scope.tz, "prev", `the ${days} days before`);
  } else ({ current: cur, previous: prev } = pickPeriod(input.period, "today", now, scope.tz));
  const settings = await kpiSettings(ctx.organizationId);
  const { _rows, ...tile } = await computeTile(ctx, def, scope, cur, prev, now, settings, { daily: input.daily });
  void _rows;
  return tile;
}

export type AreaKey = keyof typeof DASHBOARD_KPIS;
export const AREAS: Record<AreaKey, { title: string; defaultPeriod: PeriodKey; intro: string }> = {
  operations: { title: "Operations", defaultPeriod: "today", intro: "Output against plan, yield, work order status and execution exceptions." },
  inventory: { title: "Inventory", defaultPeriod: "today", intro: "Usable and blocked stock, FEFO risk and material coverage, as of the period end." },
  quality: { title: "Quality", defaultPeriod: "month", intro: "QC turnaround, first-pass release, holds, out-of-specification results and deviations." },
  sales: { title: "Sales", defaultPeriod: "month", intro: "Orders, on time in full, fill rate and overdue orders." },
};

export type AreaDashboard = DashboardData & {
  area: AreaKey;
  lists: Record<string, ListRow[]>;
  /** Inventory: usable stock recomputed from the ledger; equal to the projection-based tiles when they agree. */
  ledgerCheck: { code: string; projection: string | null; ledger: string | null; agrees: boolean }[] | null;
};

const AREA_OPTS: Record<AreaKey, Record<string, ComputeOpts>> = {
  operations: { "KPI-OPS-01": { daily: true, breakdown: true }, "KPI-OPS-02": { daily: true, breakdown: true }, "KPI-OPS-05": { breakdown: true }, "KPI-OPS-07": { breakdown: true }, "KPI-OPS-16": { breakdown: true } },
  inventory: { "KPI-INV-02": { breakdown: true }, "KPI-INV-07": { breakdown: true }, "KPI-INV-10": { breakdown: true } },
  quality: { "KPI-QUA-01": { daily: true }, "KPI-QUA-06": { breakdown: true }, "KPI-QUA-02": { breakdown: true }, "KPI-QUA-11": { breakdown: true } },
  sales: { "KPI-SAL-01": { daily: true }, "KPI-SAL-02": { breakdown: true }, "KPI-SAL-04": { daily: true } },
};

/** List sections per dashboard: [list key, KPI code, row filter, sort]. */
const AREA_LISTS: Record<AreaKey, [string, string, (r: KpiRow) => boolean][]> = {
  operations: [
    ["late_work_orders", "KPI-OPS-14", () => true],
    ["yield_outside", "KPI-OPS-02", (r) => r.category === "outside"],
    ["dispense_exceptions", "KPI-OPS-16", (r) => r.category === "outside"],
  ],
  inventory: [
    ["fefo_risk", "KPI-INV-04", () => true],
    ["expired", "KPI-INV-04E", () => true],
    ["coverage_short", "KPI-INV-07", (r) => r.category === "short"],
  ],
  quality: [
    ["open_holds", "KPI-QUA-03A", () => true],
    ["incoming_backlog", "KPI-QUA-11", () => true],
    ["oos", "KPI-QUA-04", (r) => r.category === "oos"],
  ],
  sales: [
    ["overdue_orders", "KPI-SAL-11", () => true],
    ["otif_missed", "KPI-SAL-02", (r) => r.category !== "on_time"],
  ],
};

/** US-5-03: the operations, inventory, quality and sales dashboards (§3). */
export async function getAreaDashboard(ctx: AuthContext, area: AreaKey, input: { scope?: string | null; period?: string | null; now?: Date } = {}): Promise<AreaDashboard> {
  ctx.require("analytics.dashboard.view");
  if (!(area in DASHBOARD_KPIS)) throw new DomainError("not_found", "No such dashboard.");
  const now = input.now ?? new Date();
  const scope = await resolveKpiScope(ctx, input.scope);
  const { current, previous } = pickPeriod(input.period ?? undefined, AREAS[area].defaultPeriod, now, scope.tz);
  const tiles = await computeTiles(ctx, DASHBOARD_KPIS[area], scope, current, previous, now, AREA_OPTS[area]);
  for (const [, code] of AREA_LISTS[area]) if (!tiles[code]) tiles[code] = await computeTile(ctx, kpiByCode(code)!, scope, current, previous, now, await kpiSettings(ctx.organizationId), { previous: false });
  const lists: Record<string, ListRow[]> = {};
  for (const [key, code, filter] of AREA_LISTS[area]) {
    const t = tiles[code];
    if (t.masked) continue;
    const rows = (t._rows ?? []).filter(filter);
    if (code === "KPI-QUA-03A") rows.sort((a, b) => new Dx(b.num ?? 0).comparedTo(a.num ?? 0));
    lists[key] = toList(rows, scope, 12);
  }
  let ledgerCheck: AreaDashboard["ledgerCheck"] = null;
  if (area === "inventory") {
    const settings = await kpiSettings(ctx.organizationId);
    ledgerCheck = [];
    for (const code of ["KPI-INV-01G", "KPI-INV-01P", "KPI-INV-02"]) {
      const def = kpiByCode(code)!;
      const t = tiles[code];
      if (!t || t.masked) continue;
      const p = queryParams({ siteIds: scope.siteIds, fromDate: current.fromDate, toDate: current.toDate, tz: scope.tz, now, source: "ledger", includeOrgLevel: scope.all, settings });
      const ledger = dto(aggregate(def, await fetchRows(db, def, p)));
      ledgerCheck.push({ code, projection: t.current?.value ?? null, ledger: ledger.value, agrees: ledger.value === (t.current?.value ?? null) });
    }
  }
  // Tiles that only feed a list are not shown as cards.
  const shown = Object.fromEntries(Object.entries(tiles).filter(([k]) => DASHBOARD_KPIS[area].includes(k)));
  return { area, scope, period: periodDto(current, previous), generatedAt: now.toISOString(), tiles: strip(shown), freshness: await snapshotFreshness(ctx, now), lists, ledgerCheck };
}

// ---------------------------------------------------------------- drill-down (the R-query records)

export type KpiRecords = {
  def: KpiMeta & { permissions: Permission[] };
  version: { versionNo: number; effectiveFrom: string } | null;
  scope: KpiScope;
  period: { fromDate: string; toDate: string; label: string; asOf: string };
  total: KpiNumber;
  rows: ListRow[];
  truncated: boolean;
  lastCheck: { status: string; checkedAt: string; detail: string | null } | null;
};

export const RECORD_LIMIT = 500;

/**
 * The records behind a KPI value for a scope and period: the KPI's record query, so the list is by
 * construction what the number was made of (W11-02); `total` is the tile value.
 */
export async function getKpiRecords(ctx: AuthContext, code: string, input: { scope?: string | null; period?: string | null; from?: string | null; to?: string | null; now?: Date }): Promise<KpiRecords> {
  ctx.require("analytics.dashboard.view");
  const def = kpiByCode(code);
  if (!def) throw new DomainError("not_found", "No such KPI.");
  const now = input.now ?? new Date();
  const scope = await resolveKpiScope(ctx, input.scope);
  if (!canSeeKpi(ctx, def.permissions, scope.siteIds)) throw new DomainError("forbidden", `You do not have access to ${def.name} at these sites.`);
  let period: Period;
  if (input.from || input.to) {
    if (!isIsoDate(input.from) || !isIsoDate(input.to) || input.to <= input.from) throw new DomainError("validation", "Choose a valid period (from before to, YYYY-MM-DD).");
    if (diffDays(input.to, input.from) > 400) throw new DomainError("validation", "Choose a period of at most 400 days.");
    period = periodOf(input.from, input.to, scope.tz, "custom", `${input.from} to ${addDays(input.to, -1)}`);
  } else period = pickPeriod(input.period ?? undefined, def.kind === "asof" ? "today" : "month", now, scope.tz).current;
  const settings = await kpiSettings(ctx.organizationId);
  const { rows, asOf } = await liveRows(def, scope.siteIds, scope.tz, period, now, settings, scope.all);
  const [version] = await db.select().from(kpiDefinitions).where(eq(kpiDefinitions.kpiCode, def.code)).orderBy(desc(kpiDefinitions.versionNo)).limit(1);
  const [check] = await db
    .select({ status: kpiReconciliationResults.status, checkedAt: kpiReconciliationResults.checkedAt, detail: kpiReconciliationResults.detail })
    .from(kpiReconciliationResults)
    .where(and(eq(kpiReconciliationResults.organizationId, ctx.organizationId), eq(kpiReconciliationResults.kpiCode, def.code), inArray(kpiReconciliationResults.scopeKey, scopeKeys(scope))))
    .orderBy(desc(kpiReconciliationResults.checkedAt))
    .limit(1);
  return {
    def: { ...meta(def), permissions: def.permissions },
    version: version ? { versionNo: version.versionNo, effectiveFrom: version.effectiveFrom.toISOString() } : null,
    scope,
    period: { fromDate: period.fromDate, toDate: period.toDate, label: period.label, asOf: asOf.toISOString() },
    total: dto(aggregate(def, rows)),
    rows: toList(rows, scope, RECORD_LIMIT),
    truncated: rows.length > RECORD_LIMIT,
    lastCheck: check ? { status: check.status, checkedAt: check.checkedAt.toISOString(), detail: check.detail } : null,
  };
}

// ---------------------------------------------------------------- trends (US-5-16)

export const TREND_SPANS: Record<Grain, number[]> = { day: [14, 30, 60, 90], week: [8, 12, 26, 52], month: [3, 6, 12, 24] };
export const TREND_MAX_SERIES = 6;
export const COMPARISONS = ["none", "previous", "last_year"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const trendInputSchema = z
  .object({
    codes: z.array(z.string().regex(/^KPI-[A-Z]{3}-\d{2}[A-Z0-9]*$/)).min(1, "Pick at least one KPI.").max(TREND_MAX_SERIES, `Pick at most ${TREND_MAX_SERIES} KPIs.`),
    grain: z.enum(["day", "week", "month"]),
    span: z.number().int(),
    comparison: z.enum(COMPARISONS),
    scope: z.string().nullable().optional(),
  })
  .strict()
  .refine((v) => TREND_SPANS[v.grain].includes(v.span), { message: "Choose one of the offered lengths for this grain.", path: ["span"] });
export type TrendInput = z.infer<typeof trendInputSchema>;

export type TrendSeries = KpiMeta & { slot: number; points: (KpiNumber | null)[]; comparison: (KpiNumber | null)[] | null; note: string | null };
export type Trends = {
  scope: KpiScope;
  grain: Grain;
  span: number;
  comparison: Comparison;
  buckets: { start: string; end: string; comparisonStart: string | null; href: (string | null)[] }[];
  series: TrendSeries[];
  computedAt: string | null;
  freshness: Freshness;
};

function shiftBucket(start: string, grain: Grain, comparison: Comparison, span: number): string | null {
  if (comparison === "none") return null;
  if (comparison === "previous") return grain === "day" ? addDays(start, -span) : grain === "week" ? addDays(start, -7 * span) : addMonths(start, -span);
  return grain === "day" ? addDays(start, -364) : grain === "week" ? addDays(start, -364) : addMonths(start, -12);
}

/** The KPIs a caller may pick on the trends page. */
export function trendCatalogue(ctx: AuthContext, scope: KpiScope) {
  return KPIS.filter((k) => canSeeKpi(ctx, k.permissions, scope.siteIds)).map(meta);
}

export async function getTrends(ctx: AuthContext, raw: unknown, now = new Date()): Promise<Trends> {
  ctx.require("analytics.dashboard.view");
  const parsed = trendInputSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError("validation", parsed.error.issues[0]?.message ?? "Check the selection.", { issues: parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? "form"), message: i.message })) });
  const input = parsed.data;
  const scope = await resolveKpiScope(ctx, input.scope ?? null);
  const defs = [...new Set(input.codes)].map((c) => {
    const d = kpiByCode(c);
    if (!d) throw new DomainError("validation", `Unknown KPI ${c}.`);
    if (!canSeeKpi(ctx, d.permissions, scope.siteIds)) throw new DomainError("forbidden", `You do not have access to ${d.name} at these sites.`);
    return d;
  });
  // Snapshots close yesterday; the last bucket is the one containing yesterday.
  const yesterday = addDays(localDate(now, scope.tz), -1);
  const lastStart = bucketStart(yesterday, input.grain);
  const starts: string[] = [];
  for (let i = input.span - 1; i >= 0; i--) starts.push(input.grain === "day" ? addDays(lastStart, -i) : input.grain === "week" ? addDays(lastStart, -7 * i) : addMonths(lastStart, -i));
  const compStarts = starts.map((b) => shiftBucket(b, input.grain, input.comparison, input.span));
  let computedAt: Date | null = null;
  const series: TrendSeries[] = [];
  for (const [slot, def] of defs.entries()) {
    const s = await snapshotSeries(ctx.organizationId, def, scope, input.grain, starts);
    if (s.computedAt && (!computedAt || s.computedAt > computedAt)) computedAt = s.computedAt;
    const c = input.comparison === "none" ? null : await snapshotSeries(ctx.organizationId, def, scope, input.grain, compStarts as string[]);
    series.push({
      ...meta(def),
      slot: slot + 1,
      points: s.points,
      comparison: c ? c.points : null,
      note: s.combinable ? null : "A median or maximum cannot be added across sites; pick one site to see this KPI.",
    });
  }
  return {
    scope,
    grain: input.grain,
    span: input.span,
    comparison: input.comparison,
    buckets: starts.map((start, i) => {
      const end = bucketEnd(start, input.grain);
      return { start, end, comparisonStart: compStarts[i], href: defs.map((d) => drillHref(d.code, scope, { fromDate: start, toDate: end })) };
    }),
    series,
    computedAt: computedAt ? (computedAt as Date).toISOString() : null,
    freshness: await snapshotFreshness(ctx, now),
  };
}

// ---------------------------------------------------------------- saved views

const viewConfigSchema = z
  .object({ codes: z.array(z.string()).min(1).max(TREND_MAX_SERIES), grain: z.enum(["day", "week", "month"]), span: z.number().int(), comparison: z.enum(COMPARISONS), scope: z.string().nullable() })
  .strict();
export type SavedViewConfig = z.infer<typeof viewConfigSchema>;

/** "Save view": stores the caller's own selection (validated as a trends request first). Same name replaces it. */
export async function saveTrendView(ctx: AuthContext, input: { name: string; config: SavedViewConfig }) {
  ctx.require("analytics.dashboard.view");
  ctx.assertWritable();
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new DomainError("validation", "Give the view a name of 1 to 80 characters.", { field: "name" });
  const config = viewConfigSchema.parse(input.config);
  // The selection must be one the caller may open right now (scope and every KPI).
  await getTrends(ctx, config);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(kpiSavedViews)
      .values({ organizationId: ctx.organizationId, userId: ctx.userId, name, config })
      .onConflictDoUpdate({ target: [kpiSavedViews.userId, kpiSavedViews.name], set: { config, updatedAt: new Date() } })
      .returning();
    await audit(tx, ctx, { action: "analytics.saved_view.saved", entityType: "kpi_saved_view", entityId: row.id, entityNumber: name, siteId: null, after: config });
    return row;
  });
}

export async function listTrendViews(ctx: AuthContext) {
  ctx.require("analytics.dashboard.view");
  return db.select().from(kpiSavedViews).where(and(eq(kpiSavedViews.organizationId, ctx.organizationId), eq(kpiSavedViews.userId, ctx.userId))).orderBy(kpiSavedViews.name);
}

export async function deleteTrendView(ctx: AuthContext, id: string) {
  ctx.require("analytics.dashboard.view");
  ctx.assertWritable();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "View not found.");
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(kpiSavedViews).where(and(eq(kpiSavedViews.id, id), eq(kpiSavedViews.userId, ctx.userId))).returning();
    if (!row) throw new DomainError("not_found", "View not found.");
    await audit(tx, ctx, { action: "analytics.saved_view.deleted", entityType: "kpi_saved_view", entityId: row.id, entityNumber: row.name, siteId: null });
  });
}

// ---------------------------------------------------------------- definitions and reconciliation status

export type DefinitionEntry = KpiMeta & { permissions: Permission[]; versionNo: number | null; effectiveFrom: string | null; visible: boolean; lastCheck: { status: string; checkedAt: string } | null };

export async function listKpiDefinitions(ctx: AuthContext, input: { runId?: string | null } = {}) {
  ctx.require("analytics.kpi_definition.view");
  const versions = await db.select().from(kpiDefinitions).orderBy(desc(kpiDefinitions.versionNo));
  const latestRun = input.runId && /^[0-9a-f-]{36}$/i.test(input.runId)
    ? (await db.select().from(kpiRefreshLog).where(and(eq(kpiRefreshLog.id, input.runId), eq(kpiRefreshLog.organizationId, ctx.organizationId))).limit(1))[0]
    : (await db.select().from(kpiRefreshLog).where(and(eq(kpiRefreshLog.organizationId, ctx.organizationId), eq(kpiRefreshLog.runKind, "reconcile"))).orderBy(desc(kpiRefreshLog.startedAt)).limit(1))[0];
  const results = latestRun
    ? await db
        .select({ kpiCode: kpiReconciliationResults.kpiCode, status: kpiReconciliationResults.status, checkedAt: kpiReconciliationResults.checkedAt, scopeKey: kpiReconciliationResults.scopeKey, grain: kpiReconciliationResults.grain, periodStart: kpiReconciliationResults.periodStart, detail: kpiReconciliationResults.detail })
        .from(kpiReconciliationResults)
        .where(eq(kpiReconciliationResults.refreshLogId, latestRun.id))
    : [];
  // Mismatch details name record counts and values only; scope keys of sites outside the caller's scope are hidden.
  const allowed = new Set(["all", ...ctx.allowedSiteIds.map((id) => `site:${id}`)]);
  const siteCode = new Map(ctx.allowedSites.map((s) => [`site:${s.id}`, s.code]));
  const entries: DefinitionEntry[] = KPIS.map((k) => {
    const v = versions.find((x) => x.kpiCode === k.code);
    const mine = results.filter((r) => r.kpiCode === k.code && allowed.has(r.scopeKey));
    const status = mine.length === 0 ? null : mine.some((r) => r.status === "mismatch") ? "mismatch" : "match";
    return { ...meta(k), permissions: k.permissions, versionNo: v?.versionNo ?? null, effectiveFrom: v?.effectiveFrom.toISOString() ?? null, visible: canSeeKpi(ctx, k.permissions, ctx.allowedSiteIds.slice(0, 1)), lastCheck: status ? { status, checkedAt: mine[0].checkedAt.toISOString() } : null };
  });
  const mismatches = results
    .filter((r) => r.status === "mismatch" && allowed.has(r.scopeKey) && (!r.scopeKey.startsWith("site:") || siteCode.has(r.scopeKey)) && (r.scopeKey !== "all" || ctx.can("analytics.owner_dashboard.view")))
    .map((r) => ({ ...r, scopeLabel: r.scopeKey === "all" ? "All sites" : siteCode.get(r.scopeKey) ?? "", checkedAt: r.checkedAt.toISOString() }));
  return {
    entries,
    unavailable: UNAVAILABLE_KPIS,
    run: latestRun ? { id: latestRun.id, businessDate: latestRun.businessDate, status: latestRun.status, checked: latestRun.checked, mismatches: latestRun.mismatches, finishedAt: latestRun.finishedAt?.toISOString() ?? null } : null,
    mismatches,
  };
}

export { PERIOD_LABELS };
