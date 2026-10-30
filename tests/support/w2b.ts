import { and, eq, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  bomLines,
  equipment,
  formulaRevisions,
  formulas,
  inventoryLots,
  locations,
  materials,
  products,
  routingRevisions,
  routingStepChecklistItems,
  routingStepParameters,
  routingSteps,
  routings,
  settings,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { recordServiceRecord } from "@/modules/masterdata";
import {
  type FormulaSnapshot,
  completeStep,
  countPackaging,
  createBatch,
  issuePackaging,
  postBatchToQuarantine,
  recordDispense,
  recordReading,
  recordYield,
  selectEquipment,
  startBatch,
  submitChecklist,
} from "@/modules/production";
import { type Kit, makeLot } from "./kit";

/**
 * Batch-execution helpers (W2B) for integration tests of this and other streams. Every helper goes
 * through the services (permissions, SoD, ledger), never through direct inserts.
 */

/**
 * Batches without a work order are refused by default (A-W2A-01). Execution fixtures create batches
 * directly on purpose; this turns the switch on for the organization of the kit (idempotent).
 */
export async function allowDirectBatches(kit: { orgId: string }) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "production.batch.allow_without_work_order"), isNull(settings.siteId)));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "production.batch.allow_without_work_order", value: true });
}

export const manilaDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export async function userId(email: string) {
  return (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;
}

export async function acapulcoRevisionId() {
  const [rev] = await db
    .select({ id: formulaRevisions.id })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(and(eq(formulas.code, "F-ACS-01"), eq(formulaRevisions.status, "approved")));
  return rev.id;
}

export const snapshotOf = (b: { formulaSnapshot: unknown }) => b.formulaSnapshot as FormulaSnapshot;

/** Seeded released FEFO lot per Acapulco material (supplier lot number) and its location. */
export const SOAP_LOTS: Record<string, string> = { "MAT-0012": "LOS-24871", "MAT-0013": "MPC-7731", "MAT-0021": "LYE-1009", "MAT-0043": "LB-7712", "MAT-0051": "GRN-0311" };

export async function lotBySupplierLot(supplierLot: string) {
  return (await db.select().from(inventoryLots).where(eq(inventoryLots.supplierLotNumber, supplierLot)))[0];
}

/** Marks a piece of equipment clean through a cleaning service record (the W13 way). */
export async function cleanEquipment(ctx: AuthContext, code: string) {
  const [e] = await db.select().from(equipment).where(eq(equipment.code, code));
  if (e.cleaningStatus !== "clean") await recordServiceRecord(ctx, { equipmentId: e.id, serviceKind: "cleaning", result: "completed" });
  return e;
}

/** Answers every checklist item "yes" and signs with the checker. */
export async function signChecklist(operator: AuthContext, checker: AuthContext | null, batchId: string, step: FormulaSnapshot["steps"][number]) {
  return submitChecklist(operator, { batchId, stepNo: step.stepNo, answers: (step.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
}

/** Weighs every open ingredient line at its target from the seeded lots on SC-01, co-signed by the checker. */
export async function weighAllAtTarget(operator: AuthContext, checker: AuthContext | null, batchId: string, scale = "SC-01") {
  const lines = await db.select({ bm: batchMaterials, code: materials.code }).from(batchMaterials).innerJoin(materials, eq(materials.id, batchMaterials.materialId)).where(eq(batchMaterials.batchId, batchId));
  for (const { bm, code } of lines.sort((a, z) => a.bm.lineNo - z.bm.lineNo)) {
    if (bm.status !== "pending") continue;
    const lot = await lotBySupplierLot(SOAP_LOTS[code]);
    await recordDispense(operator, { batchId, batchMaterialId: bm.id, lotRef: `BC:LOT:${lot.lotNumber}`, qty: new Decimal(bm.theoreticalQtyG).toDecimalPlaces(3).toString(), equipmentRef: scale }, { checker });
  }
}

/**
 * Runs a seeded-routing soap batch (Acapulco, 7 steps) from creation to awaiting_qc through every
 * W2B service. Returns the batch id, number and output lot.
 */
export async function runSoapBatchToQuarantine(kit: Kit, a: { manager: AuthContext; operator: AuthContext; checker: AuthContext; plannedSizeKg?: string; units?: string }) {
  await allowDirectBatches(kit);
  const { batchId, batchNumber } = await createBatch(a.manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: a.plannedSizeKg ?? "17.6", plannedStartOn: manilaDay(0) });
  await startBatch(a.operator, batchId);
  await cleanEquipment(a.operator, "SC-01");
  await cleanEquipment(a.operator, "MIX-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const steps = [...snapshotOf(b!).steps].sort((x, y) => x.stepNo - y.stepNo);
  for (const s of steps) {
    if (s.stepKind === "line_clearance") await signChecklist(a.operator, a.checker, batchId, s);
    else if (s.stepKind === "dispensing") {
      await weighAllAtTarget(a.operator, a.checker, batchId);
      await completeStep(a.operator, { batchId, stepNo: s.stepNo }, { checker: a.checker });
    } else if (s.stepKind === "process") {
      if (s.requiresEquipment) await selectEquipment(a.operator, { batchId, stepNo: s.stepNo, equipmentRef: "MIX-01" });
      for (const p of s.parameters ?? []) {
        if (!p.isRequired) continue;
        await recordReading(a.operator, { batchId, stepNo: s.stepNo, parameterId: p.id, value: p.valueKind === "numeric" ? (p.targetValue ?? p.minValue ?? "45") : p.valueKind === "boolean" ? "yes" : "MOULD-A" });
      }
      await completeStep(a.operator, { batchId, stepNo: s.stepNo }, { checker: a.checker });
    } else if (s.stepKind === "packaging") {
      const wrappers = await makeLot(a.manager, b!.siteId, (await locId(b!.siteId, "PKG-01")), "500", { materialCode: "PKG-0101" });
      const { reconciliationId } = await issuePackaging(a.operator, { batchId, stepNo: s.stepNo, lotRef: wrappers.id, qty: "130" });
      await countPackaging(a.operator, { reconciliationId, used: "124", damaged: "2", returned: "4" });
      for (const p of s.parameters ?? []) if (p.isRequired) await recordReading(a.operator, { batchId, stepNo: s.stepNo, parameterId: p.id, value: p.code === "wrappers_used" ? "124" : "2" });
      await completeStep(a.operator, { batchId, stepNo: s.stepNo }, { checker: a.checker });
    }
  }
  await recordYield(a.operator, { batchId, actualUnits: a.units ?? "124" });
  const r = await postBatchToQuarantine(a.operator, { batchId, locationRef: "BC:LOC:QUA-01", idempotencyKey: `t-${uuidv7()}` }, { checker: a.checker });
  return { batchId, batchNumber, ...r };
}

async function locId(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l.id;
}

export type FixtureStep = {
  name: string;
  kind: string;
  area?: string;
  requiresChecker?: boolean;
  equipmentKind?: string;
  minDurationMinutes?: number;
  inspectionPlanId?: string;
  checklist?: { text: string; isBlocking?: boolean }[];
  parameters?: { code: string; name: string; valueKind: "numeric" | "text" | "boolean"; uom?: string; min?: string; target?: string; max?: string; isRequired?: boolean }[];
};

let fixtureSeq = 0;
/**
 * Creates a fictional product with an approved formula (two lines: coconut oil ±1 %, palm oil ±5 g
 * absolute) and an approved routing with the given steps (limits, holds, equipment), effective from
 * yesterday. Inserted as draft and then approved, like the W1D seed (fixture only).
 */
export async function makeExecutionFixture(kit: Kit, steps: FixtureStep[], opts: { unitNetMassG?: string; yieldPct?: string; lineChecker?: [boolean, boolean] } = {}) {
  fixtureSeq += 1;
  const tag = `${Date.now().toString(36).toUpperCase()}${fixtureSeq}`;
  const mgr = await userId("manager.nfd@bryels-care.test");
  const qa = await userId("qa.nfd@bryels-care.test");
  const [p] = await db
    .insert(products)
    .values({ organizationId: kit.orgId, skuCode: `TST-${tag}`, name: `Test Bar ${tag} (fictional)`, family: "soap", unitNetMassG: opts.unitNetMassG ?? "100", shelfLifeDays: 365 })
    .returning();
  const [coconut] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
  const [palm] = await db.select().from(materials).where(eq(materials.code, "MAT-0013"));
  const [f] = await db.insert(formulas).values({ organizationId: kit.orgId, productId: p.id, code: `F-TST-${tag}`, name: `Test formula ${tag}` }).returning();
  const [rev] = await db.insert(formulaRevisions).values({ formulaId: f.id, revisionNo: 1, referenceBatchSizeG: "1500", theoreticalYieldPct: opts.yieldPct ?? "100", createdBy: mgr }).returning();
  await db.insert(bomLines).values([
    { formulaRevisionId: rev.id, lineNo: 1, materialId: coconut.id, quantityG: "1000", tolerancePct: "1", requiresChecker: opts.lineChecker?.[0] ?? true },
    { formulaRevisionId: rev.id, lineNo: 2, materialId: palm.id, quantityG: "500", toleranceAbsG: "5", requiresChecker: opts.lineChecker?.[1] ?? true },
  ]);
  await db.update(formulaRevisions).set({ status: "approved", effectiveFrom: manilaDay(-1), submittedBy: mgr, submittedAt: new Date(), approvedBy: qa, approvedAt: new Date() }).where(eq(formulaRevisions.id, rev.id));
  const [r] = await db.insert(routings).values({ organizationId: kit.orgId, productId: p.id, code: `R-TST-${tag}`, name: `Test routing ${tag}` }).returning();
  const [rr] = await db.insert(routingRevisions).values({ routingId: r.id, revisionNo: 1, createdBy: mgr }).returning();
  for (const [i, s] of steps.entries()) {
    const [row] = await db
      .insert(routingSteps)
      .values({
        routingRevisionId: rr.id,
        stepNo: i + 1,
        name: s.name,
        stepKind: s.kind,
        area: s.area ?? null,
        requiresChecker: s.requiresChecker ?? true,
        requiresEquipment: !!s.equipmentKind,
        equipmentKind: s.equipmentKind ?? null,
        minDurationMinutes: s.minDurationMinutes ?? null,
        inspectionPlanId: s.inspectionPlanId ?? null,
      })
      .returning();
    if (s.checklist?.length) await db.insert(routingStepChecklistItems).values(s.checklist.map((c, j) => ({ routingStepId: row.id, itemNo: j + 1, text: c.text, isBlocking: c.isBlocking ?? true })));
    if (s.parameters?.length) {
      await db.insert(routingStepParameters).values(
        s.parameters.map((x, j) => ({ routingStepId: row.id, sequence: j + 1, code: x.code, name: x.name, valueKind: x.valueKind, uom: x.uom ?? null, minValue: x.min ?? null, targetValue: x.target ?? null, maxValue: x.max ?? null, isRequired: x.isRequired ?? true })),
      );
    }
  }
  await db.update(routingRevisions).set({ status: "approved", effectiveFrom: manilaDay(-1), changeScope: "quality_relevant", submittedBy: mgr, submittedAt: new Date(), approvedBy: qa, approvedAt: new Date() }).where(eq(routingRevisions.id, rr.id));
  return { product: p, formulaRevisionId: rev.id };
}
