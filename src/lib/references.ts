import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

/** Tables whose rows are not "use" of a record (audit trail, idempotency results, notifications). */
const NOT_USE = new Set(["audit_events", "idempotency_keys", "notifications"]);

/**
 * True when any row of another table references this record through a foreign key. Reads the
 * foreign keys from the catalogue, so tables added by later streams count automatically. Used to
 * make codes immutable once a record is in use (US-1-20..23) and to refuse deleting a draft that
 * something already points at (ADR-075).
 */
export async function isReferenced(q: DbOrTx, table: string, id: string, ignore: string[] = []): Promise<{ referenced: boolean; by: string[] }> {
  const fks = await q.execute<{ tbl: string; col: string }>(sql`
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = ${table}::regclass and array_length(c.conkey, 1) = 1`);
  const by: string[] = [];
  for (const fk of fks) {
    const tbl = fk.tbl.replace(/"/g, "");
    if (NOT_USE.has(tbl) || ignore.includes(tbl) || (tbl === table && fk.col === "id")) continue;
    const r = await q.execute(sql`select 1 from ${sql.identifier(tbl)} where ${sql.identifier(fk.col)} = ${id} limit 1`);
    if (r.length) by.push(tbl);
  }
  return { referenced: by.length > 0, by };
}
