import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as schema from "../../../db/schema";
import { kpiDefinitions, kpiReconciliationResults, kpiSnapshots } from "../../../db/schema/analytics";
import { KPIS, type KpiDefinition, kpiByCode } from "./catalogue";
import type { KpiQueryParams } from "./sql";
import { type Grain, addDays, asOfFor, bucketStart, periodOf } from "./time";

/**
 * KPI engine core (docs/analytics-kpis.md §1.4, §4.3). No `server-only`: the jobs, the services and
 * the demo seed share it. Money and quantities are decimal.js on numeric strings, never floats.
 */

/** The application database, a transaction, or the seed's connection (all postgres-js drizzle). */
export type DbOrTx = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** 40 significant digits: sums of numeric(18,6) and their ratios stay exact to 10 decimals. */
export const Dx = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dx>;

/** Stored scale of kpi_snapshots.value (numeric(30,10)). */
export const VALUE_DP = 10;
export const round = (d: Dec) => d.toDecimalPlaces(VALUE_DP);

export type KpiRow = {
  site_id: string | null;
  ref_type: string;
  ref_id: string | null;
  ref_number: string | null;
  basis_at: Date | string | null;
  num: string | null;
  den: string | null;
  item: string | null;
  detail: string | null;
  category: string | null;
};

export type KpiValue = { value: Dec | null; numerator: Dec; denominator: Dec | null; rowCount: number };

export async function fetchRows(q: DbOrTx, def: KpiDefinition, p: KpiQueryParams): Promise<KpiRow[]> {
  const res = await q.execute(def.rows(p));
  return [...(res as unknown as KpiRow[])];
}

function percentileDisc(sorted: Dec[], f: number): Dec | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil(f * sorted.length) - 1);
  return sorted[idx];
}

/** The application-side aggregation (snapshot and dashboard path). */
export function aggregate(def: KpiDefinition, rows: KpiRow[]): KpiValue {
  const nums = rows.filter((r) => r.num !== null && r.num !== undefined).map((r) => new Dx(r.num as string));
  switch (def.aggregate) {
    case "sum": {
      const n = nums.reduce((a, b) => a.plus(b), new Dx(0));
      return { value: round(n), numerator: n, denominator: null, rowCount: rows.length };
    }
    case "ratio": {
      const n = nums.reduce((a, b) => a.plus(b), new Dx(0));
      const d = rows.filter((r) => r.den !== null && r.den !== undefined).reduce((a, r) => a.plus(r.den as string), new Dx(0));
      return { value: d.gt(0) ? round(n.div(d)) : null, numerator: n, denominator: d, rowCount: rows.length };
    }
    case "median":
    case "p90": {
      const sorted = [...nums].sort((a, b) => a.comparedTo(b));
      const v = percentileDisc(sorted, def.aggregate === "median" ? 0.5 : 0.9);
      return { value: v ? round(v) : null, numerator: v ?? new Dx(0), denominator: null, rowCount: rows.length };
    }
    case "max": {
      const v = nums.length ? nums.reduce((a, b) => (b.gt(a) ? b : a)) : null;
      return { value: v ? round(v) : null, numerator: v ?? new Dx(0), denominator: null, rowCount: rows.length };
    }
  }
}

/** R-<code>: the same record query aggregated by PostgreSQL, bypassing snapshots (the reconciliation path). */
export async function rQuery(q: DbOrTx, def: KpiDefinition, p: KpiQueryParams): Promise<KpiValue> {
  const res = await q.execute<{ num: string; den: string | null; n: number; p50: string | null; p90: string | null; mx: string | null }>(sql`
    select coalesce(sum(r.num), 0)::text as num, sum(r.den)::text as den, count(*)::int as n,
           (percentile_disc(0.5) within group (order by r.num))::text as p50,
           (percentile_disc(0.9) within group (order by r.num))::text as p90,
           max(r.num)::text as mx
      from (${def.rows(p)}) r`);
  const [r] = [...(res as unknown as { num: string; den: string | null; n: number; p50: string | null; p90: string | null; mx: string | null }[])];
  const rowCount = Number(r.n);
  switch (def.aggregate) {
    case "sum": {
      const n = new Dx(r.num);
      return { value: round(n), numerator: n, denominator: null, rowCount };
    }
    case "ratio": {
      const n = new Dx(r.num);
      const d = new Dx(r.den ?? 0);
      return { value: d.gt(0) ? round(n.div(d)) : null, numerator: n, denominator: d, rowCount };
    }
    case "median":
    case "p90": {
      const v = def.aggregate === "median" ? r.p50 : r.p90;
      return { value: v === null ? null : round(new Dx(v)), numerator: new Dx(v ?? 0), denominator: null, rowCount };
    }
    case "max":
      return { value: r.mx === null ? null : round(new Dx(r.mx)), numerator: new Dx(r.mx ?? 0), denominator: null, rowCount };
  }
}

/** Tolerance of §1.4 (A-KPI-20): 0.01 for money, exact for counts, quantities, durations and ratios. */
export const toleranceFor = (def: KpiDefinition) => new Dx(def.unit === "money" ? "0.01" : "0");

const eqWithin = (a: Dec | null, b: Dec | null, tol: Dec) => (a === null || b === null ? a === b : a.minus(b).abs().lte(tol));

export function compareValues(def: KpiDefinition, snap: KpiValue, recomputed: KpiValue): string | null {
  const tol = toleranceFor(def);
  const diffs: string[] = [];
  if (!eqWithin(snap.value, recomputed.value, tol)) diffs.push(`value ${snap.value?.toString() ?? "n/a"} vs ${recomputed.value?.toString() ?? "n/a"}`);
  if (!eqWithin(round(snap.numerator), round(recomputed.numerator), tol)) diffs.push(`numerator ${snap.numerator.toString()} vs ${recomputed.numerator.toString()}`);
  if (def.aggregate === "ratio" && !eqWithin(snap.denominator && round(snap.denominator), recomputed.denominator && round(recomputed.denominator), tol))
    diffs.push(`denominator ${snap.denominator?.toString() ?? "—"} vs ${recomputed.denominator?.toString() ?? "—"}`);
  if (snap.rowCount !== recomputed.rowCount) diffs.push(`${snap.rowCount} vs ${recomputed.rowCount} records`);
  return diffs.length ? diffs.join("; ") : null;
}

// ---------------------------------------------------------------- definitions

export function definitionChecksum(def: KpiDefinition): string {
  const body = {
    name: def.name,
    definition: def.definition,
    formula: def.formula,
    timeBasis: def.timeBasis,
    sources: def.sources,
    refresh: def.refresh,
    label: def.label,
    unit: def.unit,
    aggregate: def.aggregate,
    kind: def.kind,
    permissions: def.permissions,
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * Mirrors the catalogue into kpi_definitions: an unchanged definition keeps its row; a changed one
 * gets version_no + 1 (old snapshots keep pointing at the version they were computed with, A-KPI-17).
 * Returns code → current definition id.
 */
export async function syncDefinitions(q: DbOrTx): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const def of KPIS) {
    const checksum = definitionChecksum(def);
    const [existing] = await q
      .select({ id: kpiDefinitions.id })
      .from(kpiDefinitions)
      .where(and(eq(kpiDefinitions.kpiCode, def.code), eq(kpiDefinitions.checksum, checksum)))
      .limit(1);
    if (existing) {
      out.set(def.code, existing.id);
      continue;
    }
    const [last] = await q.select({ v: kpiDefinitions.versionNo }).from(kpiDefinitions).where(eq(kpiDefinitions.kpiCode, def.code)).orderBy(desc(kpiDefinitions.versionNo)).limit(1);
    const [row] = await q
      .insert(kpiDefinitions)
      .values({
        kpiCode: def.code,
        versionNo: (last?.v ?? 0) + 1,
        name: def.name,
        definition: def.definition,
        formulaText: def.formula,
        timeBasis: def.timeBasis,
        sources: def.sources,
        refreshClass: def.refresh,
        valueLabel: def.label,
        unit: def.unit,
        aggregate: def.aggregate,
        drillRoute: `/analytics/kpi/${def.code}`,
        permissions: def.permissions,
        checksum,
      })
      .onConflictDoNothing()
      .returning({ id: kpiDefinitions.id });
    if (row) out.set(def.code, row.id);
    else {
      const [again] = await q.select({ id: kpiDefinitions.id }).from(kpiDefinitions).where(and(eq(kpiDefinitions.kpiCode, def.code), eq(kpiDefinitions.checksum, checksum))).limit(1);
      out.set(def.code, again.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------- snapshots

export type KpiSettings = { fefoWindowDays: number; otifGraceDays: number };
export type SiteTz = { id: string; tz: string };
type Scope = { key: string; siteId: string | null; siteIds: string[]; tz: string };

export function paramsHash(s: KpiSettings): string {
  return createHash("sha256").update(JSON.stringify({ fefoWindowDays: s.fefoWindowDays, otifGraceDays: s.otifGraceDays })).digest("hex").slice(0, 16);
}

/** Rows of one scope taken from a fetch over several sites (scope filtering in the application). */
export function rowsForScope(def: KpiDefinition, rows: KpiRow[], scope: { siteId: string | null; siteIds: string[] }): KpiRow[] {
  if (scope.siteId === null) {
    const set = new Set(scope.siteIds);
    return rows.filter((r) => (r.site_id === null ? !!def.nullSiteRows : set.has(r.site_id)));
  }
  return rows.filter((r) => r.site_id === scope.siteId || (r.site_id === null && def.nullSiteRows === "every_site"));
}

export function queryParams(o: { siteIds: string[]; fromDate: string; toDate: string; tz: string; now: Date; source: "projection" | "ledger"; includeOrgLevel: boolean; settings: KpiSettings }): KpiQueryParams {
  const period = periodOf(o.fromDate, o.toDate, o.tz, "custom", "");
  const asOf = asOfFor(period, o.now);
  return {
    siteIds: o.siteIds,
    fromDate: o.fromDate,
    toDate: o.toDate,
    from: period.from,
    to: period.to,
    asOf,
    asOfDate: asOf.getTime() === period.to.getTime() ? addDays(o.toDate, -1) : asOf.toLocaleDateString("en-CA", { timeZone: o.tz }),
    source: o.source,
    includeOrgLevel: o.includeOrgLevel,
    fefoWindowDays: o.settings.fefoWindowDays,
    otifGraceDays: o.settings.otifGraceDays,
    tz: o.tz,
  };
}

/** Stored params of a snapshot (enough to rerun its R-query later). */
type StoredParams = { siteIds: string[]; fromDate: string; toDate: string; from: string; to: string; asOf: string; asOfDate: string; includeOrgLevel: boolean; fefoWindowDays: number; otifGraceDays: number; tz: string };

const toStored = (p: KpiQueryParams): StoredParams => ({
  siteIds: p.siteIds,
  fromDate: p.fromDate,
  toDate: p.toDate,
  from: p.from.toISOString(),
  to: p.to.toISOString(),
  asOf: p.asOf.toISOString(),
  asOfDate: p.asOfDate,
  includeOrgLevel: p.includeOrgLevel,
  fefoWindowDays: p.fefoWindowDays,
  otifGraceDays: p.otifGraceDays,
  tz: p.tz,
});

export const fromStored = (s: StoredParams, source: "projection" | "ledger"): KpiQueryParams => ({
  siteIds: s.siteIds,
  fromDate: s.fromDate,
  toDate: s.toDate,
  from: new Date(s.from),
  to: new Date(s.to),
  asOf: new Date(s.asOf),
  asOfDate: s.asOfDate,
  source,
  includeOrgLevel: s.includeOrgLevel,
  fefoWindowDays: s.fefoWindowDays,
  otifGraceDays: s.otifGraceDays,
  tz: s.tz,
});

export type SnapshotInput = {
  organizationId: string;
  sites: SiteTz[];
  orgTz: string;
  /** The business day the snapshot closes (yesterday for the 01:30 run). */
  businessDate: string;
  now: Date;
  settings: KpiSettings;
  refreshLogId: string | null;
  /** Period KPIs: grains to snapshot (day = the business day, week/month = to date). Default all three. */
  grains?: Grain[];
  /** Restrict to these KPI codes (tests, backfill). */
  codes?: string[];
};

/**
 * analytics.snapshot_kpis core: every KPI for the business day (and week/month to date for period
 * KPIs) per site and for all sites, as of the end of the business day. Rows are fetched once per
 * time zone group and split per scope in the application. Idempotent: the unique index of
 * kpi_snapshots is the job's idempotency key, a re-run inserts nothing new.
 */
export async function computeSnapshots(q: DbOrTx, input: SnapshotInput): Promise<{ written: number; computed: number }> {
  const defIds = await syncDefinitions(q);
  const allIds = input.sites.map((s) => s.id);
  const scopes: Scope[] = [...input.sites.map((s) => ({ key: `site:${s.id}`, siteId: s.id, siteIds: [s.id], tz: s.tz })), { key: "all", siteId: null, siteIds: allIds, tz: input.orgTz }];
  const byTz = new Map<string, Scope[]>();
  for (const sc of scopes) byTz.set(sc.tz, [...(byTz.get(sc.tz) ?? []), sc]);
  const hash = paramsHash(input.settings);
  const grains = input.grains ?? ["day", "week", "month"];
  let written = 0;
  let computed = 0;
  const end = addDays(input.businessDate, 1);
  for (const def of KPIS) {
    if (input.codes && !input.codes.includes(def.code)) continue;
    const defGrains: Grain[] = def.kind === "asof" ? ["day"] : grains;
    for (const grain of defGrains) {
      const start = bucketStart(input.businessDate, grain);
      for (const [tz, group] of byTz) {
        const siteIds = [...new Set(group.flatMap((g) => g.siteIds))];
        const fetchParams = queryParams({ siteIds, fromDate: start, toDate: end, tz, now: input.now, source: "projection", includeOrgLevel: group.some((g) => g.siteId === null), settings: input.settings });
        const rows = await fetchRows(q, def, fetchParams);
        const values = group.map((sc) => {
          const v = aggregate(def, rowsForScope(def, rows, sc));
          const own: KpiQueryParams = { ...fetchParams, siteIds: sc.siteIds, includeOrgLevel: sc.siteId === null };
          return {
            organizationId: input.organizationId,
            kpiCode: def.code,
            kpiDefinitionId: defIds.get(def.code)!,
            scopeKey: sc.key,
            siteId: sc.siteId,
            siteIds: sc.siteIds,
            grain,
            periodStart: start,
            periodEnd: end,
            asOf: own.asOf,
            asOfDate: input.businessDate,
            value: v.value === null ? null : v.value.toFixed(VALUE_DP),
            numerator: round(v.numerator).toFixed(VALUE_DP),
            denominator: v.denominator === null ? null : round(v.denominator).toFixed(VALUE_DP),
            rowCount: v.rowCount,
            valueLabel: def.label,
            params: toStored(own),
            paramsHash: hash,
            refreshLogId: input.refreshLogId,
          };
        });
        computed += values.length;
        const inserted = await q.insert(kpiSnapshots).values(values).onConflictDoNothing().returning({ id: kpiSnapshots.id });
        written += inserted.length;
      }
    }
  }
  return { written, computed };
}

// ---------------------------------------------------------------- reconciliation

export type Mismatch = { snapshotId: string; kpiCode: string; scopeKey: string; grain: string; periodStart: string; detail: string };

const snapValue = (s: typeof kpiSnapshots.$inferSelect): KpiValue => ({
  value: s.value === null ? null : new Dx(s.value),
  numerator: new Dx(s.numerator),
  denominator: s.denominator === null ? null : new Dx(s.denominator),
  rowCount: s.rowCount,
});

/**
 * analytics.reconcile_kpis core: reruns the R-query of every snapshot of the business date from the
 * transactions (stock from the ledger, not the projection), compares within tolerance, checks that
 * all-sites equals the sum of sites for additive KPIs, and writes kpi_reconciliation_results.
 * Nothing is corrected; mismatches are returned for the critical notification.
 */
export async function reconcileSnapshots(q: DbOrTx, input: { organizationId: string; businessDate: string; refreshLogId: string }): Promise<{ checked: number; mismatches: Mismatch[] }> {
  const snaps = await q
    .select()
    .from(kpiSnapshots)
    .where(and(eq(kpiSnapshots.organizationId, input.organizationId), eq(kpiSnapshots.asOfDate, input.businessDate)));
  const mismatches: Mismatch[] = [];
  const results: (typeof kpiReconciliationResults.$inferInsert)[] = [];
  for (const s of snaps) {
    const def = kpiByCode(s.kpiCode);
    if (!def) continue;
    const p = fromStored(s.params as StoredParams, "ledger");
    const re = await rQuery(q, def, p);
    const snap = snapValue(s);
    const diffs: string[] = [];
    const d = compareValues(def, snap, re);
    if (d) diffs.push(`R-query: ${d}`);
    if (def.additive && s.siteId === null) {
      const parts = snaps.filter((x) => x.kpiCode === s.kpiCode && x.grain === s.grain && x.periodStart === s.periodStart && x.paramsHash === s.paramsHash && x.siteId !== null && (s.siteIds as string[]).includes(x.siteId) && x.periodEnd === s.periodEnd);
      const sameTz = parts.every((x) => (x.params as StoredParams).tz === (s.params as StoredParams).tz);
      if (sameTz && parts.length === (s.siteIds as string[]).length) {
        const num = parts.reduce((a, x) => a.plus(x.numerator), new Dx(0));
        const den = def.aggregate === "ratio" ? parts.reduce((a, x) => a.plus(x.denominator ?? 0), new Dx(0)) : null;
        const tol = toleranceFor(def);
        if (!eqWithin(round(num), round(snap.numerator), tol) || (den !== null && !eqWithin(round(den), snap.denominator && round(snap.denominator), tol)))
          diffs.push(`all sites ≠ sum of sites (numerator ${snap.numerator.toString()} vs ${num.toString()}${den ? `, denominator ${snap.denominator?.toString()} vs ${den.toString()}` : ""})`);
      }
    }
    const detail = diffs.length ? diffs.join(" | ") : null;
    if (detail) mismatches.push({ snapshotId: s.id, kpiCode: s.kpiCode, scopeKey: s.scopeKey, grain: s.grain, periodStart: s.periodStart, detail });
    results.push({
      organizationId: input.organizationId,
      refreshLogId: input.refreshLogId,
      kpiSnapshotId: s.id,
      kpiCode: s.kpiCode,
      scopeKey: s.scopeKey,
      grain: s.grain,
      periodStart: s.periodStart,
      status: detail ? "mismatch" : "match",
      snapshotValue: s.value,
      recomputedValue: re.value === null ? null : re.value.toFixed(VALUE_DP),
      snapshotNumerator: s.numerator,
      recomputedNumerator: round(re.numerator).toFixed(VALUE_DP),
      snapshotDenominator: s.denominator,
      recomputedDenominator: re.denominator === null ? null : round(re.denominator).toFixed(VALUE_DP),
      snapshotRowCount: s.rowCount,
      recomputedRowCount: re.rowCount,
      tolerance: toleranceFor(def).toFixed(2),
      detail,
    });
  }
  for (let i = 0; i < results.length; i += 200) await q.insert(kpiReconciliationResults).values(results.slice(i, i + 200)).onConflictDoNothing();
  return { checked: results.length, mismatches };
}
