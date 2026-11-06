/**
 * Walk 2026-11-06 (coordinator note): a routing with a filling step AND a packaging step. The filling step records
 * every wrapper and label taken; the packaging step must see that record and not block with "No wrappers or labels
 * are recorded". Packaging is recorded once.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batches, inventoryBalances, inventoryLots, packagingReconciliations, processStepRecords, users } from "@/db/schema";
import type { BatchRow, SnapshotStep, StepRecord } from "@/modules/production/execution";
import { packagingBlockers } from "@/modules/production/packaging";
import { resetTestDatabase } from "../../support/db";
import { seedLot } from "../../support/kit";

let batch: BatchRow;

beforeAll(async () => {
  await resetTestDatabase();
  [batch] = (await db.select().from(batches).where(eq(batches.batchNumber, "B-26-0004"))) as BatchRow[];
}, 180_000);

const NO_WRAPPERS = /No wrappers or labels are recorded/;
const step = (stepKind: string) => ({ stepKind, stepNo: 6, name: "Wrap and box" }) as unknown as SnapshotStep;

describe("filling step + packaging step: packaging is recorded once", () => {
  it("the packaging step is not blocked when the filling step already recorded the wrappers", async () => {
    const [filling] = await db.select().from(processStepRecords).where(eq(processStepRecords.batchId, batch.id)).limit(1);
    const packagingRec = { ...filling, id: uuidv7() } as unknown as StepRecord;
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, seedLot("00014")));
    const [bal] = await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, lot.id)).limit(1);
    const [u] = await db.select().from(users).where(eq(users.email, "operator.nfd@bryels-care.test"));
    await db.insert(packagingReconciliations).values({ organizationId: batch.organizationId, siteId: batch.siteId, batchId: batch.id, processStepRecordId: filling.id, materialId: lot.materialId!, lotId: lot.id, fromLocationId: bal.locationId, baseUom: lot.baseUom, issuedQty: "123", issuedBy: u.id });
    const onPackaging = await packagingBlockers(db, batch, step("packaging"), packagingRec);
    expect(onPackaging.some((b) => NO_WRAPPERS.test(b.message))).toBe(false);
    // the filling step itself sees its own rows
    expect((await packagingBlockers(db, batch, step("filling"), filling as unknown as StepRecord)).some((b) => NO_WRAPPERS.test(b.message))).toBe(false);
  });
});
