import { sql, type SQL } from "drizzle-orm";

export * from "@/lib/location-sections";

/** SQL twin of `sectionOf` for queries; `l` and `w` are the SQL aliases of locations and warehouses. */
export function sectionSql(l = "l", w = "w"): SQL<string> {
  const L = sql.raw(l);
  const W = sql.raw(w);
  return sql<string>`coalesce(${L}.section, case when ${L}.kind in ('quarantine','hold','rejected','recall') then 'qa_hold' when ${L}.kind in ('production','staging') then 'production' when ${W}.warehouse_kind in ('raw_materials','packaging','finished_goods') then ${W}.warehouse_kind else 'other' end)`;
}

