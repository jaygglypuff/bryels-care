import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, batches, dispenseRecords, inventoryLots, materials, processStepRecords, processStepReadings, products, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { checkPermission } from "./execution";
import { flowHref } from "./flow-paths";
import { plainWords } from "./plain-words";
import { type FormulaSnapshot } from "./shared";
import { plainNumber, weighUnitFor } from "./floor-words";

/**
 * ADR-130 one checker flow: everything that waits for the signed-in person's second check at the current site,
 * one card per thing. The checker opens `/production/checks`, taps "Looks right" (or "Not right" with a reason)
 * and comes back to this list; the operator's next screen is never shown to the checker (round 5 B18).
 *
 * | Card                                 | Source                                         | Permission at the site               |
 * |--------------------------------------|------------------------------------------------|--------------------------------------|
 * | Check 4 weighings for B-26-0004       | dispense_records not checked, not voided, line | production.dispense_record.approve   |
 * |  (one card per batch when together;   |  needs a checker, someone else weighed it      |                                      |
 * |   one card per weighing when not)     |                                                |                                      |
 * | Check "Heat and mix" of B-26-0004     | process_step_records awaiting_check, done by   | the step kind's check permission     |
 * |                                      |  someone else                                  |                                      |
 *
 * Read model only. The commands are `checkDispenses` / `returnDispense` and `checkStep` / `returnStep`, which
 * enforce the same rules again (separation of duties, permission at the site, still waiting).
 */

export type WeighingToCheck = {
  id: string;
  materialName: string;
  /** "17.92 kg" / "250 g": the unit the operator weighed in. */
  amount: string;
  lotNumber: string;
  operatorName: string;
};

export type CheckCard =
  | {
      kind: "weighings";
      key: string;
      batchId: string;
      batchNumber: string;
      productName: string;
      operatorNames: string[];
      weighings: WeighingToCheck[];
      /** Where the batch is worked on (for "See the batch"); never the checker's next screen. */
      batchHref: string;
    }
  | {
      kind: "step";
      key: string;
      batchId: string;
      batchNumber: string;
      productName: string;
      stepNo: number;
      stepName: string;
      stepKind: string;
      doneBy: string;
      /** What was typed on the step, in plain words ("Mix temperature: 70 °C"). */
      facts: string[];
      batchHref: string;
    };

export type CheckerQueue = { cards: CheckCard[]; /** Things to check (a card of 4 weighings counts 4). */ count: number; together: boolean };

const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "someone";

/** What waits for my check at my current site (see the table above). Empty when I may check nothing. */
export async function checkerQueue(ctx: AuthContext): Promise<CheckerQueue> {
  ctx.require("production.batch.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const canWeighCheck = ctx.canAt("production.dispense_record.approve", siteId);
  const canStepCheck = ctx.canAt("production.process_step_record.approve", siteId);
  const canStartCheck = ctx.canAt("production.line_clearance.approve", siteId);
  const together = await getSetting(db, ctx.organizationId, "production.weighing.check_together", siteId);
  const cards: CheckCard[] = [];
  let count = 0;
  if (!canWeighCheck && !canStepCheck && !canStartCheck) return { cards, count, together };

  const live = await db
    .select({ id: batches.id, batchNumber: batches.batchNumber, workOrderId: batches.workOrderId, snapshot: batches.formulaSnapshot, productName: products.name })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, siteId), inArray(batches.status, ["materials_staged", "in_process", "rework_approved"])))
    .orderBy(asc(batches.batchNumber))
    .limit(200);
  if (!live.length) return { cards, count, together };
  const byId = new Map(live.map((b) => [b.id, b]));

  if (canWeighCheck) {
    const rows = await db
      .select({
        id: dispenseRecords.id,
        batchId: batchMaterials.batchId,
        lineNo: batchMaterials.lineNo,
        materialName: materials.name,
        baseUom: materials.baseUom,
        actualQtyG: dispenseRecords.actualQtyG,
        enteredQty: dispenseRecords.enteredQty,
        enteredUom: dispenseRecords.enteredUom,
        lotNumber: inventoryLots.lotNumber,
        operatorId: dispenseRecords.operatorId,
        operatorName: users.displayName,
      })
      .from(dispenseRecords)
      .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
      .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
      .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
      .innerJoin(users, eq(users.id, dispenseRecords.operatorId))
      .where(and(inArray(batchMaterials.batchId, [...byId.keys()]), isNull(dispenseRecords.checkerId), isNull(dispenseRecords.voidedAt), ne(dispenseRecords.operatorId, ctx.userId)))
      .orderBy(asc(batchMaterials.lineNo), asc(dispenseRecords.recordedAt));
    const perBatch = new Map<string, WeighingToCheck[]>();
    const opsPerBatch = new Map<string, Set<string>>();
    for (const r of rows) {
      const b = byId.get(r.batchId)!;
      const snap = b.snapshot as FormulaSnapshot;
      if (snap.lines?.find((l) => l.lineNo === r.lineNo)?.requiresChecker === false) continue;
      const unit = r.enteredUom && r.enteredQty ? r.enteredUom : weighUnitFor(r.baseUom, r.actualQtyG);
      const amount = r.enteredUom && r.enteredQty ? `${plainNumber(r.enteredQty)} ${r.enteredUom}` : unit === "kg" ? `${plainNumber(new Decimal(r.actualQtyG).div(1000))} kg` : `${plainNumber(r.actualQtyG)} ${r.baseUom}`;
      const w = { id: r.id, materialName: r.materialName, amount, lotNumber: r.lotNumber, operatorName: r.operatorName };
      perBatch.set(r.batchId, [...(perBatch.get(r.batchId) ?? []), w]);
      opsPerBatch.set(r.batchId, (opsPerBatch.get(r.batchId) ?? new Set()).add(firstName(r.operatorName)));
    }
    for (const [batchId, list] of perBatch) {
      const b = byId.get(batchId)!;
      const batchHref = flowHref({ batchId, workOrderId: b.workOrderId }, "weigh");
      const groups = together ? [list] : list.map((w) => [w]);
      for (const g of groups) {
        cards.push({ kind: "weighings", key: `w:${g.map((x) => x.id).join(",")}`, batchId, batchNumber: b.batchNumber, productName: b.productName, operatorNames: [...new Set(g.map((x) => firstName(x.operatorName)))], weighings: g, batchHref });
        count += g.length;
      }
    }
  }

  const steps = await db
    .select({ id: processStepRecords.id, batchId: processStepRecords.batchId, stepNo: processStepRecords.stepNo, name: processStepRecords.name, kind: processStepRecords.stepKind, doneBy: users.displayName, conductedBy: processStepRecords.conductedBy })
    .from(processStepRecords)
    .leftJoin(users, eq(users.id, processStepRecords.conductedBy))
    .where(and(inArray(processStepRecords.batchId, [...byId.keys()]), eq(processStepRecords.status, "awaiting_check")))
    .orderBy(asc(processStepRecords.stepNo));
  const mine = steps.filter((s) => s.conductedBy !== ctx.userId && ctx.canAt(checkPermission(s.kind ?? ""), siteId));
  const readings = mine.length
    ? await db
        .select({ recId: processStepReadings.processStepRecordId, id: processStepReadings.id, supersedesId: processStepReadings.supersedesId, name: processStepReadings.parameterName, num: processStepReadings.valueNumeric, text: processStepReadings.valueText, bool: processStepReadings.valueBoolean, uom: processStepReadings.uom, within: processStepReadings.isWithinLimits })
        .from(processStepReadings)
        .where(inArray(processStepReadings.processStepRecordId, mine.map((s) => s.id)))
    : [];
  const superseded = new Set(readings.map((r) => r.supersedesId).filter(Boolean));
  for (const s of mine) {
    const b = byId.get(s.batchId)!;
    const facts = readings
      .filter((r) => r.recId === s.id && !superseded.has(r.id))
      .map((r) => `${plainWords(r.name)}: ${r.num !== null ? `${plainNumber(r.num)}${r.uom ? ` ${r.uom}` : ""}` : r.text ?? (r.bool === null ? "" : r.bool ? "yes" : "no")}${r.within === false ? " (outside the range)" : ""}`);
    cards.push({ kind: "step", key: `s:${s.id}`, batchId: s.batchId, batchNumber: b.batchNumber, productName: b.productName, stepNo: s.stepNo, stepName: plainWords(s.name), stepKind: s.kind ?? "", doneBy: s.doneBy ?? "someone", facts, batchHref: flowHref({ batchId: s.batchId, workOrderId: b.workOrderId }, `step/${s.stepNo}`) });
    count += 1;
  }
  return { cards, count, together };
}

/** For Homes (round 5 B13): how many things wait for my check at my current site; 0 when I check nothing. */
export async function checksWaitingCount(ctx: AuthContext): Promise<number> {
  if (!ctx.can("production.batch.view")) return 0;
  return (await checkerQueue(ctx)).count;
}
