import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx } from "@/db/client";
import { materials } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";

/**
 * Packaging in the flow (ADR-088 §3). The wrappers, labels and boxes a batch needs are batch lines like
 * the ingredients, so they are set aside when the order is approved and taken at "Get materials":
 *
 *   1. the recipe's own packaging lines (formula lines whose material kind is `packaging`; quantity in
 *      the material's unit, usually pieces; `proportional` scales with the batch size, `fixed` is per
 *      batch), or, when the recipe has none,
 *   2. the per-product setup `production.packaging.per_piece` (A-G5-01): expected pieces × per piece,
 *      plus the spare percentage, rounded up.
 *
 * Packaging lines are never weighed: their batch line status is `packaging` (not pending/partial), so
 * every "still to weigh" rule skips them. The packaging step records the issue against the taken lot.
 */

export const PACKAGING_KIND = "packaging";
/** batch_materials.status of a packaging line (not weighed; issued at the packaging step). */
export const PACKAGING_LINE_STATUS = "packaging";
/** First line number of packaging lines added from the per-piece setup (after the recipe's lines). */
export const PER_PIECE_LINE_NO = 900;

export const isPackagingKind = (kind: string | null | undefined) => kind === PACKAGING_KIND;

/** Expected pieces of one batch: size × expected % ÷ weight per piece, rounded down (as Finish). */
export function expectedPieces(batchSizeG: Decimal.Value, yieldPct: Decimal.Value, unitNetMassG: Decimal.Value): Decimal {
  const m = new Decimal(unitNetMassG);
  if (m.lte(0)) return new Decimal(0);
  return new Decimal(batchSizeG).mul(yieldPct).div(100).div(m).floor();
}

/** Pieces of a packaging item for a batch: pieces × per piece × (1 + spare %), rounded up. */
export function perPieceQty(pieces: Decimal.Value, perPiece: Decimal.Value, extraPct: Decimal.Value = 0): Decimal {
  return new Decimal(pieces).mul(perPiece).mul(new Decimal(100).plus(extraPct)).div(100).ceil();
}

export type PerPieceLine = { materialId: string; materialCode: string; materialName: string; materialKind: string; baseUom: string; perPiece: string; extraPct: string };

/**
 * The per-piece packaging setup of a product (empty when none). A code that is not an active packaging
 * material of the organization is a setup error the site manager must fix: it is refused with a plain message.
 */
export async function perPieceSetup(q: DbOrTx, organizationId: string, siteId: string | null, productSku: string): Promise<PerPieceLine[]> {
  const all = await getSetting(q, organizationId, "production.packaging.per_piece", siteId ?? undefined);
  const entries = all?.[productSku] ?? [];
  if (!entries.length) return [];
  const codes = entries.map((e) => e.materialCode.trim().toUpperCase());
  const rows = await q.select().from(materials).where(and(eq(materials.organizationId, organizationId), inArray(materials.code, codes)));
  return entries.map((e) => {
    const m = rows.find((r) => r.code === e.materialCode.trim().toUpperCase());
    if (!m || !isPackagingKind(m.materialKind) || m.status !== "active") {
      throw new DomainError("validation", `The packaging setup of ${productSku} lists ${e.materialCode}, which is not an active packaging item. Ask the site manager to fix "Packaging per piece" in Settings.`, { setting: "production.packaging.per_piece" });
    }
    return { materialId: m.id, materialCode: m.code, materialName: m.name, materialKind: m.materialKind, baseUom: m.baseUom, perPiece: String(e.perPiece), extraPct: String(e.extraPct ?? 0) };
  });
}
