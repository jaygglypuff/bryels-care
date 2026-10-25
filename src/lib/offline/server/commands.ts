import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, batches, inventoryBalances, inventoryLots, materials, stockCounts } from "@/db/schema";
import { type CommandContract, commands } from "@/lib/api/contract";
import type { ApiError } from "@/lib/api/server";
import type { AuthContext } from "@/lib/auth/context";
import { recordCount, transferStock } from "@/modules/inventory";
import { recordDispense } from "@/modules/production";
import { openDeviation } from "@/modules/quality";
import { OFFLINE_COMMANDS, type OfflineCommandType, type SyncConflictReason } from "../protocol";

/**
 * Thin adapters from an offline command to the module service that runs it online (docs/offline-sync.md
 * §3). The services are called unchanged: same permission, site, state, lot, tolerance and SoD checks,
 * same audit. Each adapter only adds what the sync queue needs: the record the command concerns (for
 * the reviewer's "server version") and, for a weighing outside tolerance, a deviation stub.
 */
export type RelatedRecord = { type: string; id: string; number: string | null; state: Record<string, unknown> } | null;

export type OfflineHandler = {
  contract: CommandContract;
  run: (ctx: AuthContext, payload: Record<string, unknown>, meta: { idempotencyKey: string }) => Promise<unknown>;
  /** What the command created or changed, for `sync_commands.applied_entity_*`. */
  applied: (result: unknown, payload: Record<string, unknown>) => Promise<{ type: string; id: string | null; number: string | null }>;
  /** Current server view of the record the command concerns (`sync_conflicts.server_state`). */
  related: (payload: Record<string, unknown>) => Promise<RelatedRecord>;
  /** Command-specific reason refinement (e.g. a count no longer open is `count_closed`). */
  reason?: (error: ApiError, base: SyncConflictReason) => SyncConflictReason;
  /** Side effect after a rejection, e.g. the deviation stub for an out-of-tolerance weighing. Returns extra server state. */
  onRejected?: (ctx: AuthContext, payload: Record<string, unknown>, error: ApiError, reason: SyncConflictReason, meta: { commandId: string; clientCreatedAt: string }) => Promise<Record<string, unknown> | null>;
};

const offlineContract = (type: OfflineCommandType, summary: string): CommandContract => ({
  kind: "command",
  name: type,
  method: "POST",
  path: "/api/v1/sync/commands",
  summary,
  permission: OFFLINE_COMMANDS[type].permission,
  payload: OFFLINE_COMMANDS[type].payload,
  idempotent: true,
  offline: "queueable",
});

const str = (v: unknown) => (typeof v === "string" ? v : null);

async function lotState(lotId: string | null, locationId: string | null): Promise<RelatedRecord> {
  if (!lotId) return null;
  const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId)).limit(1);
  if (!lot) return null;
  const [bal] = locationId ? await db.select({ q: inventoryBalances.qtyBase }).from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId))).limit(1) : [];
  return { type: "inventory_lot", id: lot.id, number: lot.lotNumber, state: { qualityStatus: lot.qualityStatus, expiresOn: lot.expiresOn, onHandAtSource: bal?.q ?? "0", baseUom: lot.baseUom } };
}

export const OFFLINE_HANDLERS: Record<OfflineCommandType, OfflineHandler> = {
  "inventory.movement.transfer": {
    contract: commands.transferStock,
    run: (ctx, p, meta) => transferStock(ctx, { ...(p as Parameters<typeof transferStock>[1]), idempotencyKey: meta.idempotencyKey }),
    applied: async (r) => {
      const x = r as { movementId: string; number: string };
      return { type: "stock_movement", id: x.movementId, number: x.number || null };
    },
    related: (p) => lotState(str(p.lotId), str(p.fromLocationId)),
  },
  "inventory.stock_count.record": {
    contract: offlineContract("inventory.stock_count.record", "Record a blind count entry captured offline (replayed through recordCount)."),
    run: (ctx, p, meta) => recordCount(ctx, { ...(p as Omit<Parameters<typeof recordCount>[1], "idempotencyKey">), idempotencyKey: meta.idempotencyKey }),
    applied: async (r, p) => {
      const x = r as { entryId: string };
      const [c] = await db.select({ n: stockCounts.countNumber }).from(stockCounts).where(eq(stockCounts.id, String(p.countId))).limit(1);
      return { type: "stock_count_entry", id: x.entryId, number: c?.n ?? null };
    },
    related: async (p) => {
      const id = str(p.countId);
      if (!id) return null;
      const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id)).limit(1);
      return c ? { type: "stock_count", id: c.id, number: c.countNumber, state: { status: c.status, isBlind: c.isBlind } } : null;
    },
    // offline.count_plan_closed: a line replayed after the count left in_progress.
    reason: (e, base) => (e.code === "INVALID_STATE" ? "count_closed" : base),
  },
  "production.dispense_record.create": {
    contract: offlineContract("production.dispense_record.create", "Record a weighing captured offline (replayed through recordDispense; the checker signs online afterwards)."),
    // The service keeps its own row in idempotency_keys; the pipeline already reserved the command's key there,
    // so the service gets a derived key (same retry safety, no clash with the pipeline's reservation).
    run: (ctx, p, meta) => recordDispense(ctx, { ...(p as unknown as Parameters<typeof recordDispense>[1]), idempotencyKey: `offline:${meta.idempotencyKey}` }),
    applied: async (r, p) => {
      const x = r as { dispenseRecordId: string };
      const [b] = await db.select({ n: batches.batchNumber }).from(batches).where(eq(batches.id, String(p.batchId))).limit(1);
      return { type: "dispense_record", id: x.dispenseRecordId, number: b?.n ?? null };
    },
    related: async (p) => {
      const id = str(p.batchId);
      if (!id) return null;
      const [b] = await db.select().from(batches).where(eq(batches.id, id)).limit(1);
      if (!b) return null;
      const lineId = str(p.batchMaterialId);
      const [line] = lineId
        ? await db
            .select({ status: batchMaterials.status, dispensedQtyG: batchMaterials.dispensedQtyG, theoreticalQtyG: batchMaterials.theoreticalQtyG, material: materials.name })
            .from(batchMaterials)
            .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
            .where(and(eq(batchMaterials.id, lineId), eq(batchMaterials.batchId, b.id)))
            .limit(1)
        : [];
      return { type: "batch", id: b.id, number: b.batchNumber, state: { status: b.status, line: line ?? null } };
    },
    // V-MAT (the lot is another material, or not the reserved lot) is `wrong_lot` (docs/offline-sync.md §3).
    reason: (e, base) => (e.code === "STOCK_NOT_ELIGIBLE" && e.details?.rule === "V-MAT" ? "wrong_lot" : base),
    // docs/offline-sync.md §3: an out-of-tolerance capture is never auto-accepted; a deviation stub is
    // opened for QA (when the operator may open deviations) and the capture waits in conflict review.
    onRejected: async (ctx, p, e, reason, meta) => {
      if (reason !== "out_of_tolerance" || !ctx.canAt("quality.deviation.create", ctx.currentSiteId)) return null;
      const lot = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.lotNumber, String(p.lotRef ?? "").toUpperCase().replace(/^BC:LOT:/, ""))).limit(1);
      try {
        const d = await openDeviation(ctx, {
          batchId: String(p.batchId),
          lotId: lot[0]?.id ?? null,
          source: "cx_tol",
          stepRef: "Offline weighing",
          description: `Offline weighing captured ${meta.clientCreatedAt} was outside tolerance and was not accepted: ${e.message} Nothing was consumed; the capture waits in sync conflict review.`,
          idempotencyKey: `sync:${meta.commandId}:deviation`,
        });
        return { deviationId: d.deviationId, deviationNumber: d.deviationNumber };
      } catch {
        return null;
      }
    },
  },
};
