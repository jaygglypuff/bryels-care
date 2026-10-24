import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, batchStateTransitions, batches, formulaRevisions, formulas, inventoryLots, processStepRecords, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import { createBatch } from "@/modules/production";
import { loc, type Kit } from "../../support/kit";

/**
 * W2C fixture: an Acapulco Soap batch created through createBatch (so it freezes the QA-approved
 * finished-product plan IP-ACS-FP), then brought to awaiting_qc directly in the database: lines
 * dispensed, every snapshot step conducted by the operator and checked by the checker, and a
 * quarantined output lot posted to QUA-01. Independent of the execution screens (W2B) on purpose.
 */
export async function awaitingQcBatch(kit: Kit, manager: AuthContext, units = 60) {
  const [rev] = await db
    .select({ id: formulaRevisions.id })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(and(eq(formulas.code, "F-ACS-01"), eq(formulaRevisions.status, "approved")));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { batchId } = await createBatch(manager, { formulaRevisionId: rev.id, plannedSizeKg: "8.8", plannedStartOn: today });
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const operatorId = (await db.select().from(users).where(eq(users.email, "operator.nfd@bryels-care.test")))[0].id;
  const checkerId = (await db.select().from(users).where(eq(users.email, "checker.nfd@bryels-care.test")))[0].id;
  for (const l of await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId))) {
    await db.update(batchMaterials).set({ status: "dispensed", dispensedQtyG: l.theoreticalQtyG }).where(eq(batchMaterials.id, l.id));
  }
  const snap = b.formulaSnapshot as { steps: { routingStepId: string; stepNo: number; name: string }[] };
  for (const st of snap.steps) {
    await db.insert(processStepRecords).values({ batchId, routingStepId: st.routingStepId, stepNo: st.stepNo, name: st.name, conductedBy: operatorId, checkedBy: checkerId });
  }
  const [product] = await db.select({ productId: batches.productId }).from(batches).where(eq(batches.id, batchId));
  const [lot] = await db
    .insert(inventoryLots)
    .values({
      organizationId: kit.orgId,
      siteId: kit.nfd.id,
      lotNumber: `L-W2C-${b.batchNumber.replace(/[^0-9]/g, "")}`,
      itemKind: "product",
      productId: product.productId,
      manufacturedOn: today,
      expiresOn: "2028-12-31",
      qualityStatus: "quarantine",
      sourceBatchId: batchId,
      baseUom: "pcs",
    })
    .returning();
  const qua = await loc(kit.nfd.id, "QUA-01");
  await db.transaction((tx) => postMovement(tx, manager, { movementType: "output", lotId: lot.id, toLocationId: qua.id, qtyBase: String(units), sourceDocumentType: "batch", sourceDocumentId: batchId, sourceDocumentNumber: b.batchNumber }));
  await db.update(batches).set({ status: "awaiting_qc", outputLotId: lot.id, completedAt: new Date(), actualUnits: String(units) }).where(eq(batches.id, batchId));
  await db.insert(batchStateTransitions).values({ batchId, fromState: "planned", toState: "awaiting_qc", actorId: operatorId, reason: "test fixture" });
  return { batchId, batchNumber: b.batchNumber, lotId: lot.id, lotNumber: lot.lotNumber, inspectionPlanId: b.inspectionPlanId };
}
