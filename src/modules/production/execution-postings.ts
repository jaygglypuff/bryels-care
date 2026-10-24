import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { DbOrTx, Tx } from "@/db/client";
import { batchMaterials, batches, dispenseRecords, inventoryBalances, inventoryLots, packagingReconciliations, productionPostings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { postMovement } from "@/modules/inventory/ledger";
import type { BatchRow } from "./execution";

/**
 * Batch-side postings (docs/data-model.md §5.7): every stock change of a batch goes through
 * postMovement (which writes the movement's own audit row) and gets one production_postings row
 * 1:1 with the stock movement. Callers hold the batch lock; postMovement locks the lot and balance.
 */
export async function postBatchMovement(
  tx: Tx,
  ctx: AuthContext,
  batch: BatchRow,
  p: {
    postingType: "consumption" | "output" | "reversal";
    lotId: string;
    qtyBase: Decimal.Value;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    reason: string;
    idempotencyKey: string;
    reversalOfMovementId?: string;
    reversalOfPostingId?: string;
    links?: { batchMaterialId?: string | null; dispenseRecordId?: string | null; packagingReconciliationId?: string | null; batchOutputId?: string | null; processStepRecordId?: string | null };
    meta?: Record<string, unknown>;
  },
) {
  const { movement } = await postMovement(tx, ctx, {
    movementType: p.postingType,
    lotId: p.lotId,
    fromLocationId: p.fromLocationId ?? null,
    toLocationId: p.toLocationId ?? null,
    qtyBase: p.qtyBase,
    sourceDocumentType: "batch",
    sourceDocumentId: batch.id,
    sourceDocumentNumber: batch.batchNumber,
    reason: p.reason,
    idempotencyKey: p.idempotencyKey,
    reversalOfId: p.reversalOfMovementId,
    meta: { ...(p.meta ?? {}), postingType: p.postingType },
  });
  const [existing] = await tx.select().from(productionPostings).where(eq(productionPostings.stockMovementId, movement.id)).limit(1);
  if (existing) return existing;
  const [posting] = await tx
    .insert(productionPostings)
    .values({
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      postingType: p.postingType,
      batchMaterialId: p.links?.batchMaterialId ?? null,
      dispenseRecordId: p.links?.dispenseRecordId ?? null,
      packagingReconciliationId: p.links?.packagingReconciliationId ?? null,
      batchOutputId: p.links?.batchOutputId ?? null,
      processStepRecordId: p.links?.processStepRecordId ?? null,
      lotId: p.lotId,
      qtyBase: new Decimal(p.qtyBase).toString(),
      baseUom: movement.baseUom,
      stockMovementId: movement.id,
      reversalOfId: p.reversalOfPostingId ?? null,
      postedBy: ctx.userId,
    })
    .returning();
  return posting;
}

/** Posts the consumption of one weighing (at dispense when the site option is on, else at W05-17). */
export async function postDispenseConsumption(tx: Tx, ctx: AuthContext, batch: BatchRow, rec: typeof dispenseRecords.$inferSelect, materialName: string) {
  if (rec.productionPostingId || rec.voidedAt) return null;
  const posting = await postBatchMovement(tx, ctx, batch, {
    postingType: "consumption",
    lotId: rec.lotId,
    qtyBase: rec.actualQtyG,
    fromLocationId: rec.fromLocationId,
    reason: `Dispensed ${materialName} for batch ${batch.batchNumber}`,
    idempotencyKey: `dispense:${rec.id}`,
    links: { batchMaterialId: rec.batchMaterialId, dispenseRecordId: rec.id },
    meta: { dispenseRecordId: rec.id },
  });
  await tx.update(dispenseRecords).set({ productionPostingId: posting.id }).where(eq(dispenseRecords.id, rec.id));
  return posting;
}

/** Consumed quantity of a counted packaging component: issued − returned (used, damaged and any unexplained variance). */
export function packagingConsumedQty(r: { issuedQty: string; returnedQty: string | null }) {
  return new Decimal(r.issuedQty).minus(r.returnedQty ?? 0);
}

export async function postPackagingConsumption(tx: Tx, ctx: AuthContext, batch: BatchRow, r: typeof packagingReconciliations.$inferSelect, materialName: string) {
  if (r.productionPostingId || r.voidedAt || r.countedAt === null) return null;
  const qty = packagingConsumedQty(r);
  if (qty.lte(0)) return null;
  const posting = await postBatchMovement(tx, ctx, batch, {
    postingType: "consumption",
    lotId: r.lotId,
    qtyBase: qty,
    fromLocationId: r.fromLocationId,
    reason: `Packaging ${materialName} used for batch ${batch.batchNumber}`,
    idempotencyKey: `packaging:${r.id}`,
    links: { packagingReconciliationId: r.id, processStepRecordId: r.processStepRecordId },
    meta: { packagingReconciliationId: r.id, issued: r.issuedQty, used: r.usedQty, damaged: r.damagedQty, returned: r.returnedQty },
  });
  await tx.update(packagingReconciliations).set({ productionPostingId: posting.id }).where(eq(packagingReconciliations.id, r.id));
  return posting;
}

const RUNNING_BATCH_STATES = ["materials_staged", "in_process"];

/**
 * Stock of a lot at a location that is not yet promised to an unposted weighing or packaging issue
 * of any batch. Used to refuse a weighing that the later consumption posting could not cover.
 */
export async function unpostedClaimsQty(q: DbOrTx, lotId: string, locationId: string) {
  // Only batches still running hold unposted claims: weighings of earlier (MVP) batches were posted
  // at dispense without a production_postings link and their batches have moved on.
  const [d] = await q
    .select({ s: sql<string>`coalesce(sum(${dispenseRecords.actualQtyG}), 0)::text` })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .innerJoin(batches, eq(batches.id, batchMaterials.batchId))
    .where(
      and(
        eq(dispenseRecords.lotId, lotId),
        eq(dispenseRecords.fromLocationId, locationId),
        isNull(dispenseRecords.productionPostingId),
        isNull(dispenseRecords.voidedAt),
        inArray(batches.status, RUNNING_BATCH_STATES),
      ),
    );
  const [p] = await q
    .select({ s: sql<string>`coalesce(sum(${packagingReconciliations.issuedQty} - coalesce(${packagingReconciliations.returnedQty}, 0)), 0)::text` })
    .from(packagingReconciliations)
    .innerJoin(batches, eq(batches.id, packagingReconciliations.batchId))
    .where(
      and(
        inArray(batches.status, RUNNING_BATCH_STATES),
        eq(packagingReconciliations.lotId, lotId),
        eq(packagingReconciliations.fromLocationId, locationId),
        isNull(packagingReconciliations.productionPostingId),
        isNull(packagingReconciliations.voidedAt),
      ),
    );
  return new Decimal(d?.s ?? 0).plus(p?.s ?? 0);
}

/** Refuses when the location cannot cover `qty` after earlier unposted claims (V-NEG ahead of posting). */
export async function assertStockCovers(q: DbOrTx, lot: typeof inventoryLots.$inferSelect, location: { id: string; code: string }, qty: Decimal) {
  const [bal] = await q
    .select({ qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, location.id)))
    .limit(1);
  const onHand = new Decimal(bal?.qty ?? 0);
  const claimed = await unpostedClaimsQty(q, lot.id, location.id);
  const free = onHand.minus(claimed);
  if (free.lt(qty)) {
    throw new DomainError(
      "insufficient_stock",
      `Not enough of lot ${lot.lotNumber} at ${location.code}: ${free.toString()} ${lot.baseUom} free (${onHand.toString()} on hand, ${claimed.toString()} already weighed or issued, not yet posted), ${qty.toString()} needed.`,
      { lotId: lot.id, locationId: location.id, free: free.toString() },
    );
  }
}
