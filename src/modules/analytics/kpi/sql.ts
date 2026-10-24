import { type SQL, sql } from "drizzle-orm";

/**
 * SQL fragments shared by the KPI record queries (docs/analytics-kpis.md §1.6, §1.7). Every record
 * query reads posted, immutable records "known by" the as-of instant, so a value recomputed later
 * for the same as-of is the same value (the reconciliation rule of §1.4).
 */

export type KpiQueryParams = {
  /** Allowed and selected sites. */
  siteIds: string[];
  /** Local dates [fromDate, toDate) and the instants they begin, in the scope's time zone. */
  fromDate: string;
  toDate: string;
  from: Date;
  to: Date;
  /** Point-in-time instant: records posted after it do not count, statuses are taken as of it. */
  asOf: Date;
  /** Business date of asOf in the scope's time zone. */
  asOfDate: string;
  /**
   * Stock on hand source: `projection` = inventory_balances minus movements posted after asOf
   * (snapshots, dashboards); `ledger` = Σ stock_movements posted up to asOf (the R-query).
   */
  source: "projection" | "ledger";
  /** Include organization-level rows (site_id null), used by the all-sites scope only. */
  includeOrgLevel: boolean;
  /** Configured windows (settings analytics.*). */
  fefoWindowDays: number;
  otifGraceDays: number;
  /** Time zone of the scope (labels only; period boundaries are already instants). */
  tz: string;
};

export const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
export const dt = (s: string) => sql`${s}::date`;

/** `<column> in (...)` over uuids; an empty scope matches nothing. */
export function inSites(column: string, ids: string[]): SQL {
  if (ids.length === 0) return sql`false`;
  return sql`${sql.raw(column)} in (${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )})`;
}

/** Quality status of lot alias `l` as of T: the status before the first disposition after T, else the current one. */
export function lotStatusAt(alias: string, asOf: Date): SQL {
  return sql`coalesce((select d.from_status from dispositions d where d.subject_type = 'lot' and d.subject_id = ${sql.raw(alias)}.id and d.decided_at > ${ts(asOf)} order by d.decided_at, d.id limit 1), ${sql.raw(alias)}.quality_status)`;
}

/** Work order status of alias `w` as of T (work_order_state_transitions). */
export function workOrderStatusAt(alias: string, asOf: Date): SQL {
  return sql`coalesce((select t.from_state from work_order_state_transitions t where t.work_order_id = ${sql.raw(alias)}.id and t.occurred_at > ${ts(asOf)} order by t.occurred_at, t.id limit 1), ${sql.raw(alias)}.status)`;
}

/** Inspection status of alias `i` as of T (inspection_state_transitions). */
export function inspectionStatusAt(alias: string, asOf: Date): SQL {
  return sql`coalesce((select t.from_state from inspection_state_transitions t where t.inspection_id = ${sql.raw(alias)}.id and t.occurred_at > ${ts(asOf)} order by t.occurred_at, t.id limit 1), ${sql.raw(alias)}.status)`;
}

/**
 * CTE body: positive on-hand per lot (site_id, lot_id, qty) as of p.asOf, from the projection or
 * from the ledger (docs/data-model.md §5.6: ledger qty = Σ into a location − Σ out of it).
 */
export function onHandCte(p: KpiQueryParams): SQL {
  const T = ts(p.asOf);
  if (p.source === "ledger") {
    return sql`select x.site_id, x.lot_id, sum(x.delta) as qty from (
        select m.site_id, m.lot_id, m.qty_base as delta from stock_movements m
         where m.to_location_id is not null and m.posted_at <= ${T} and ${inSites("m.site_id", p.siteIds)}
        union all
        select m.site_id, m.lot_id, -m.qty_base from stock_movements m
         where m.from_location_id is not null and m.posted_at <= ${T} and ${inSites("m.site_id", p.siteIds)}
      ) x group by 1, 2 having sum(x.delta) > 0`;
  }
  return sql`select b.site_id, b.lot_id, sum(b.qty_base - coalesce(lt.delta, 0)) as qty
      from inventory_balances b
      left join (
        select y.lot_id, y.location_id, sum(y.delta) as delta from (
          select m.lot_id, m.to_location_id as location_id, m.qty_base as delta from stock_movements m
           where m.to_location_id is not null and m.posted_at > ${T} and ${inSites("m.site_id", p.siteIds)}
          union all
          select m.lot_id, m.from_location_id, -m.qty_base from stock_movements m
           where m.from_location_id is not null and m.posted_at > ${T} and ${inSites("m.site_id", p.siteIds)}
        ) y group by 1, 2
      ) lt on lt.lot_id = b.lot_id and lt.location_id = b.location_id
     where ${inSites("b.site_id", p.siteIds)}
     group by 1, 2 having sum(b.qty_base - coalesce(lt.delta, 0)) > 0`;
}

/** A stock movement not reversed by a reversal posted up to T (netting rule of §1.7). */
export function notReversedMovement(alias: string, asOf: Date): SQL {
  return sql`not exists (select 1 from stock_movements r where r.reversal_of_id = ${sql.raw(alias)}.id and r.posted_at <= ${ts(asOf)})`;
}

export function notReversedPosting(alias: string, asOf: Date): SQL {
  return sql`not exists (select 1 from production_postings r where r.reversal_of_id = ${sql.raw(alias)}.id and r.posted_at <= ${ts(asOf)})`;
}

/** Item name of lot alias `l` (material or product). */
export function lotItemName(alias: string): SQL {
  return sql`coalesce((select m.name from materials m where m.id = ${sql.raw(alias)}.material_id), (select p.name from products p where p.id = ${sql.raw(alias)}.product_id), '—')`;
}
