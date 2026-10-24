import "server-only";
import Decimal from "decimal.js";
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import type { ReportRow } from "./types";

/** SQL helpers shared by the report definitions. Every query filters on the scope's site ids. */

export const inIds = (col: AnyPgColumn | SQL, ids: string[]) => sql`${col} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;

/** Start instant of a local calendar day in `tz` (half-open periods, analytics-kpis §1.6). */
export const dayStart = (iso: string, tz: string) => sql`((${iso}::date)::timestamp at time zone ${tz})`;

/** Local timestamp text `YYYY-MM-DD HH:MM` in `tz`. */
export const localTs = (col: AnyPgColumn | SQL, tz: string) => sql`to_char(${col} at time zone ${tz}, 'YYYY-MM-DD HH24:MI')`;

/** ILIKE pattern with LIKE metacharacters escaped. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

export async function select<T extends ReportRow>(q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

/** Sum of a decimal column per unit ("1,250 g · 48 pcs"); quantities are never summed across units. */
export function totalsByUnit(rows: ReportRow[], qtyKey: string, unitKey: string): string {
  const by = new Map<string, Decimal>();
  for (const r of rows) {
    const q = r[qtyKey];
    if (q === null || q === undefined || q === "") continue;
    const u = String(r[unitKey] ?? "");
    by.set(u, (by.get(u) ?? new Decimal(0)).plus(new Decimal(String(q))));
  }
  if (by.size === 0) return "none";
  return [...by.entries()].map(([u, d]) => `${d.toFixed()} ${u}`.trim()).join(" · ");
}

export function countBy(rows: ReportRow[], key: string): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(String(r[key] ?? "—"), (by.get(String(r[key] ?? "—")) ?? 0) + 1);
  return [...by.entries()].map(([k, n]) => `${k}: ${n}`).join(" · ") || "none";
}
