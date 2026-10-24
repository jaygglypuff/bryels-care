import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

/** Default patterns for MVP document types (A-PRD-04; configurable later). */
const RULES: Record<string, { prefix: string; width: number; period: "YY" | "YYMM" | "" }> = {
  GR: { prefix: "GR", width: 5, period: "YY" },
  LOT: { prefix: "L", width: 5, period: "YYMM" },
  BATCH: { prefix: "B", width: 4, period: "YY" },
  SO: { prefix: "SO", width: 5, period: "YY" },
  DR: { prefix: "DR", width: 5, period: "YY" },
  MOV: { prefix: "MOV", width: 6, period: "YY" },
  QH: { prefix: "QH", width: 4, period: "YY" }, // Wave 1 W1B: quality holds (data-model §9.2)
  // Wave 1 W1C: boxes, transfers, counts, adjustments, reservations (data-model §9.2)
  BOX: { prefix: "BX", width: 8, period: "" },
  TR: { prefix: "TR", width: 6, period: "YY" },
  CNT: { prefix: "CNT", width: 4, period: "YY" },
  ADJ: { prefix: "ADJ", width: 5, period: "YY" },
  RSV: { prefix: "RSV", width: 6, period: "YY" },
  DOC: { prefix: "DOC", width: 7, period: "YY" }, // W1E: generated documents, organization scope (A-RPT-03)
  // Wave 2 W2C: inspections and deviations (data-model §9.2)
  INS: { prefix: "INS", width: 5, period: "YY" },
  DEV: { prefix: "DEV", width: 4, period: "YY" },
};

function periodKey(kind: "YY" | "YYMM" | "", now = new Date()): string {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const yy = String(local.getFullYear()).slice(2);
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  return kind === "YY" ? yy : kind === "YYMM" ? yy + mm : "";
}

/**
 * Allocates the next number inside the caller's transaction (row lock via upsert),
 * e.g. GR-26-00012, L-2610-00171, B-26-0012.
 */
export async function nextNumber(tx: DbOrTx, organizationId: string, documentType: keyof typeof RULES): Promise<string> {
  const rule = RULES[documentType];
  const pk = periodKey(rule.period);
  const rows = await tx.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${documentType}, ${rule.prefix}, ${rule.width}, ${pk}, 2)
    ON CONFLICT (organization_id, document_type, period_key)
    DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  const n = String(rows[0].value).padStart(rule.width, "0");
  return [rule.prefix, pk, n].filter(Boolean).join("-");
}
