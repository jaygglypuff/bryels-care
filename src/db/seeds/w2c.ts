/**
 * Wave 2 W2C fictional demo data (QA release, inspections, deviations; runs inside the
 * ALLOW_DEMO_SEED-guarded seed): a newly received coconut-oil lot in quarantine with an incoming
 * inspection in progress (one sample taken, CoA check entered by Nina, ready for the second QA user),
 * an open deviation on the batch in process, and a closed deviation on a released batch.
 * Lot numbers here are outside the LOT sequence so the demo numbering stays as in Wave 1.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

async function nextNo(db: Db, organizationId: string, type: string, prefix: string, width: number, period: string) {
  const rows = await db.execute<{ value: string }>(sql`
    INSERT INTO numbering_rules (id, organization_id, document_type, prefix, sequence_width, period_key, next_value)
    VALUES (gen_random_uuid(), ${organizationId}, ${type}, ${prefix}, ${width}, ${period}, 2)
    ON CONFLICT (organization_id, document_type, period_key) DO UPDATE SET next_value = numbering_rules.next_value + 1
    RETURNING (next_value - 1)::text AS value`);
  return [prefix, period, String(rows[0].value).padStart(width, "0")].filter(Boolean).join("-");
}

export async function seedW2C(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  const O = org.id;
  const YY = String(new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })).getFullYear()).slice(2);
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD")));
  const user = async (email: string) => (await db.select().from(s.users).where(eq(s.users.email, email)))[0];
  const qa = await user("qa.nfd@bryels-care.test");
  const lead = await user("qa.lead@bryels-care.test");
  const operator = await user("operator.nfd@bryels-care.test");
  const checker = await user("checker.nfd@bryels-care.test");
  const warehouse = await user("warehouse.nfd@bryels-care.test");
  if (!nfd || !qa || !lead || !operator) return;
  const [qua] = await db.select().from(s.locations).where(and(eq(s.locations.siteId, nfd.id), eq(s.locations.code, "QUA-01")));
  const [coconut] = await db.select().from(s.materials).where(and(eq(s.materials.organizationId, O), eq(s.materials.code, "MAT-0012")));
  const [plan] = await db.select().from(s.inspectionPlans).where(and(eq(s.inspectionPlans.organizationId, O), eq(s.inspectionPlans.code, "IP-MAT-0012-IN"), eq(s.inspectionPlans.status, "approved")));
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000);

  // 1. Quarantined coconut-oil lot with an incoming inspection in progress.
  if (qua && coconut && plan) {
    const [lot] = await db
      .insert(s.inventoryLots)
      .values({ organizationId: O, siteId: nfd.id, lotNumber: "L-DEMO-W2C-01", itemKind: "material", materialId: coconut.id, supplierName: "Laguna Oleo Supply", supplierLotNumber: "LOS-25102", expiresOn: new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10), qualityStatus: "quarantine", baseUom: "g", createdBy: warehouse.id, createdAt: at(30) })
      .returning();
    await db.insert(s.inventoryBalances).values({ siteId: nfd.id, lotId: lot.id, locationId: qua.id, qtyBase: "24950" });
    await db.insert(s.stockMovements).values({ organizationId: O, siteId: nfd.id, movementType: "receipt", lotId: lot.id, toLocationId: qua.id, qtyBase: "25000", baseUom: "g", qualityStatusAtPosting: "quarantine", sourceDocumentType: "demo_seed", sourceDocumentNumber: "LOS-25102", reason: "Demo receipt (fictional)", postedBy: warehouse.id, postedAt: at(30) });
    const insNo = await nextNo(db, O, "INS", "INS", 5, YY);
    const [ins] = await db
      .insert(s.inspections)
      .values({ organizationId: O, siteId: nfd.id, inspectionNumber: insNo, status: "in_progress", inspectionKind: "incoming", inspectionPlanId: plan.id, lotId: lot.id, sampledAt: at(20), sampledBy: qa.id, sampleQtyBase: "50", sampleUom: "g", performedBy: qa.id, dueAt: at(-18), createdBy: qa.id, createdAt: at(29), statusChangedAt: at(20), statusChangedBy: qa.id })
      .returning();
    const [mv] = await db
      .insert(s.stockMovements)
      .values({ organizationId: O, siteId: nfd.id, movementType: "consumption", lotId: lot.id, fromLocationId: qua.id, qtyBase: "50", baseUom: "g", qualityStatusAtPosting: "quarantine", sourceDocumentType: "inspection", sourceDocumentId: ins.id, sourceDocumentNumber: insNo, reason: "sample", postedBy: qa.id, postedAt: at(20) })
      .returning();
    await db.insert(s.inspectionSamples).values({ organizationId: O, siteId: nfd.id, inspectionId: ins.id, sampleNo: 1, lotId: lot.id, fromLocationId: qua.id, qtyBase: "50", baseUom: "g", sampledBy: qa.id, sampledAt: at(20), consumptionMovementId: mv.id });
    await db.insert(s.inspectionStateTransitions).values([
      { organizationId: O, siteId: nfd.id, inspectionId: ins.id, fromState: null, toState: "pending", actorId: qa.id, occurredAt: at(29) },
      { organizationId: O, siteId: nfd.id, inspectionId: ins.id, fromState: "pending", toState: "in_progress", actorId: qa.id, reason: "Sample 1 taken", occurredAt: at(20) },
    ]);
    const tests = await db.select().from(s.inspectionPlanTests).where(eq(s.inspectionPlanTests.inspectionPlanId, plan.id));
    const coa = tests.find((t) => t.testCode === "COA");
    if (coa) {
      await db.insert(s.testResults).values({ testName: coa.name, specification: coa.specText ?? "Pass", result: "Pass (CoA LOS-25102 matches)", passed: true, testedBy: qa.id, testedAt: at(19), inspectionId: ins.id, inspectionPlanTestId: coa.id, testCode: coa.testCode, valuePass: true, valueText: "CoA LOS-25102 matches" });
    }
  }

  // 2. Open deviation on the batch in process (raised by the operator from step 2).
  const [inProcess] = await db.select().from(s.batches).where(and(eq(s.batches.siteId, nfd.id), eq(s.batches.status, "in_process"))).limit(1);
  if (inProcess) {
    const n = await nextNo(db, O, "DEV", "DEV", 4, YY);
    const [d] = await db
      .insert(s.deviations)
      .values({ organizationId: O, siteId: nfd.id, deviationNumber: n, status: "open", source: "manual", description: "Mixer paused for about 8 minutes during trace (power dip). Batch kept covered; temperature not logged during the pause.", stepRef: "Step 3", batchId: inProcess.id, raisedBy: operator.id, raisedAt: at(3), statusChangedAt: at(3), statusChangedBy: operator.id })
      .returning();
    await db.insert(s.deviationStateTransitions).values({ organizationId: O, siteId: nfd.id, deviationId: d.id, fromState: null, toState: "open", actorId: operator.id, reason: d.description, occurredAt: at(3) });
  }

  // 3. Closed deviation on a released batch (history example).
  const [released] = await db.select().from(s.batches).where(and(eq(s.batches.siteId, nfd.id), eq(s.batches.status, "released"))).orderBy(s.batches.batchNumber).limit(1);
  if (released && checker) {
    const n = await nextNo(db, O, "DEV", "DEV", 4, YY);
    const [d] = await db
      .insert(s.deviations)
      .values({ organizationId: O, siteId: nfd.id, deviationNumber: n, status: "investigating", source: "manual", severity: "minor", description: "Wrapper roll changed mid-run; two wrappers misprinted and set aside.", stepRef: "Step 6", batchId: released.id, raisedBy: checker.id, raisedAt: at(400), classifiedBy: lead.id, classifiedAt: at(399), investigation: "Compared the set-aside wrappers with the roll; counted labels.", statusChangedAt: at(399), statusChangedBy: lead.id })
      .returning();
    await db
      .update(s.deviations)
      .set({ status: "closed", rootCause: "Roll end reached without warning.", resolution: "Misprints destroyed and counted in reconciliation; no product impact.", releasePermitted: true, closedBy: lead.id, closedAt: at(398), statusChangedAt: at(398), statusChangedBy: lead.id })
      .where(eq(s.deviations.id, d.id));
    await db.insert(s.deviationStateTransitions).values([
      { organizationId: O, siteId: nfd.id, deviationId: d.id, fromState: null, toState: "open", actorId: checker.id, occurredAt: at(400) },
      { organizationId: O, siteId: nfd.id, deviationId: d.id, fromState: "open", toState: "investigating", actorId: lead.id, occurredAt: at(399) },
      { organizationId: O, siteId: nfd.id, deviationId: d.id, fromState: "investigating", toState: "closed", actorId: lead.id, reason: "No product impact", occurredAt: at(398) },
    ]);
  }
}
