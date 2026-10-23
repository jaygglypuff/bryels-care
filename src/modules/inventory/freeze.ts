import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { COUNT_FROZEN_STATUSES, locations, stockCounts, stockCountScopes } from "@/db/schema";
import { DomainError } from "@/lib/errors";

/*
 * Stock-count freeze (V-FREEZE, US-2-17). Kept apart from counts.ts so the ledger can enforce it
 * inside postMovement without an import cycle (counts.ts posts through the ledger).
 */

/**
 * V-FREEZE: refuses a posting that touches a location inside a released, not yet posted or
 * cancelled count. Takes a share lock on the location rows so a concurrent release (which locks
 * them for update before snapshotting) and a posting serialize.
 */
export async function assertLocationsNotFrozen(tx: Tx, locationIds: string[], opts: { exceptCountId?: string } = {}) {
  const ids = [...new Set(locationIds.filter(Boolean))].sort();
  if (ids.length === 0) return;
  await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, ids)).orderBy(asc(locations.id)).for("share");
  const rows = await tx
    .select({ countNumber: stockCounts.countNumber, countId: stockCounts.id, code: locations.code })
    .from(stockCountScopes)
    .innerJoin(stockCounts, eq(stockCounts.id, stockCountScopes.stockCountId))
    .innerJoin(locations, eq(locations.id, stockCountScopes.locationId))
    .where(and(inArray(stockCountScopes.locationId, ids), inArray(stockCounts.status, [...COUNT_FROZEN_STATUSES])));
  const hit = rows.find((r) => r.countId !== opts.exceptCountId);
  if (hit) {
    throw new DomainError("conflict", `V-FREEZE: location ${hit.code} is frozen by stock count ${hit.countNumber}. Nothing can move in or out until the count is posted or cancelled.`, {
      rule: "V-FREEZE",
      countNumber: hit.countNumber,
    });
  }
}

/** Active counts freezing any of the given locations (for location cards and the scan page). */
export async function activeCountsForLocations(q: Tx | typeof db, locationIds: string[]) {
  if (locationIds.length === 0) return [];
  return q
    .select({ locationId: stockCountScopes.locationId, countId: stockCounts.id, countNumber: stockCounts.countNumber, status: stockCounts.status })
    .from(stockCountScopes)
    .innerJoin(stockCounts, eq(stockCounts.id, stockCountScopes.stockCountId))
    .where(and(inArray(stockCountScopes.locationId, locationIds), inArray(stockCounts.status, [...COUNT_FROZEN_STATUSES])));
}

