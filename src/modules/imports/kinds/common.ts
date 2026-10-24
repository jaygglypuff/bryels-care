import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { normalisedName, similarity, TIER3_THRESHOLD } from "./values";
import type { ExistingMatch, KindRunState } from "./types";

/** State key under which the engine shares the tier 1 keys of every row of the file. */
export const FILE_KEYS = "fileTier1Keys";

/**
 * Loader-assigned master-data codes (docs/data-migration-plan.md §6): `<PREFIX>-<SEQ>` with SEQ width 4,
 * one counter per import kind (not a numbering_rules document type). Reads the highest code in use in the
 * caller's transaction, so earlier rows of the same chunk are counted.
 */
export async function nextLoaderCode(tx: Tx, table: "materials" | "suppliers" | "products", column: "code" | "sku_code", organizationId: string, prefix: string, state: KindRunState, width = 4): Promise<string> {
  const rows = await tx.execute<{ max: number | null }>(
    sql`select max(substring(${sql.identifier(column)} from ${`^${prefix}-(\\d+)$`})::int) as max from ${sql.identifier(table)} where organization_id = ${organizationId} and ${sql.identifier(column)} ~ ${`^${prefix}-\\d+$`}`,
  );
  // Codes that appear further down in the same file are never handed out (they would collide when those rows post).
  const inFile = (state.get(FILE_KEYS) as Set<string> | undefined) ?? new Set<string>();
  let next = (rows[0]?.max ?? 0) + 1;
  while (inFile.has(`code:${prefix}-${String(next).padStart(width, "0")}`)) next++;
  return `${prefix}-${String(next).padStart(width, "0")}`;
}

/** Tier 2 (normalised name) and tier 3 (similarity ≥ 0.85) candidates among existing names (§8). */
export function nameMatches(name: string, existing: { id: string; label: string; names: string[] }[], entityType: string, what: string): ExistingMatch | null {
  const n = normalisedName(name);
  if (!n) return null;
  const t2 = existing.find((e) => e.names.some((x) => normalisedName(x) === n));
  if (t2) return { tier: 2, entityType, entityId: t2.id, label: t2.label, message: `Possible duplicate: the name matches existing ${what} ${t2.label}. Decide "same as existing", "new record" or "reject".` };
  let best: { e: (typeof existing)[number]; s: number } | null = null;
  for (const e of existing) {
    const s = Math.max(...e.names.map((x) => similarity(name, x)));
    if (s >= TIER3_THRESHOLD && (!best || s > best.s)) best = { e, s };
  }
  if (best) return { tier: 3, entityType, entityId: best.e.id, label: best.e.label, message: `Possible duplicate: the name is very similar (${Math.round(best.s * 100)} %) to existing ${what} ${best.e.label}. Decide "same as existing", "new record" or "reject".` };
  return null;
}
