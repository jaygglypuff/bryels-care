import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, dispenseRecords, materials, processStepRecords, settings, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import {
  checkDispense,
  checkDispenses,
  checkStep,
  checkerQueue,
  checksWaitingCount,
  completeStep,
  createBatch,
  finishBatch,
  floorTaskCounts,
  myFloorTasks,
  recordDispense,
  selectEquipment,
  startBatch,
  stepDone,
} from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, signChecklist, snapshotOf, SOAP_LOTS } from "../../support/w2b";
import { directBatchReadyToFinish } from "../../support/g3";

/**
 * Round 5 floor fixes (ADR-130): B1 a name alone never signs a second-person check; the checker's list "Waiting
 * for you to check" (one card per batch of weighings, one per step); B2 empty packaging counts are refused; B3/B4
 * plain step sentences and an empty required reading refused before anything is written. Fictional data only.
 */
let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let warehouse: AuthContext;
let operatorRvs: AuthContext;
let checkerId: string;
const PW = "demo1234";
const key = () => `r5-${randomUUID()}`;

async function setSetting(k: string, value: unknown) {
  await db
    .insert(settings)
    .values({ organizationId: kit.orgId, scope: "organization", key: k, value })
    .onConflictDoUpdate({ target: [settings.organizationId, settings.scope, settings.siteId, settings.userId, settings.key], set: { value } });
}
async function clearSetting(k: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, k)));
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  checkerId = (await db.select().from(users).where(eq(users.email, "checker.nfd@bryels-care.test")))[0].id;
}, 180_000);

/** A direct Acapulco batch, started, with the Start check done; returns the batch and its snapshot steps. */
async function startedBatch() {
  await allowDirectBatches(kit);
  const { batchId, batchNumber } = await createBatch(manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "8.8", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  await cleanEquipment(operator, "SC-01");
  await cleanEquipment(operator, "MIX-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const steps = [...snapshotOf(b!).steps].sort((x, y) => x.stepNo - y.stepNo);
  for (const s of steps.filter((x) => x.stepKind === "line_clearance").slice(0, 1)) await signChecklist(operator, checker, batchId, s);
  return { batchId, batchNumber, steps };
}

/** Weighs every pending ingredient line at its target WITHOUT a checker (the checks wait on the checker's list). */
async function weighAllUnchecked(batchId: string) {
  const ids: string[] = [];
  const rows = await db.select({ bm: batchMaterials, code: materials.code }).from(batchMaterials).innerJoin(materials, eq(materials.id, batchMaterials.materialId)).where(eq(batchMaterials.batchId, batchId));
  for (const { bm, code } of rows.sort((a, z) => a.bm.lineNo - z.bm.lineNo)) {
    if (bm.status !== "pending" || !SOAP_LOTS[code]) continue;
    const lot = await lotBySupplierLot(SOAP_LOTS[code]);
    const r = await recordDispense(operator, { batchId, batchMaterialId: bm.id, lotRef: `BC:LOT:${lot.lotNumber}`, qty: new Decimal(bm.theoreticalQtyG).toDecimalPlaces(3).toString(), equipmentRef: "SC-01" });
    ids.push(r.dispenseRecordId);
  }
  return ids;
}

describe("B1: a second-person check is never signed by a name alone", () => {
  it("coSign refuses no password, a wrong password (audited) and the operator herself; a right password marks the context", async () => {
    const base = { role: "checker" as const, permission: "production.dispense_record.approve" as const, siteId: kit.nfd.id };
    await expectCode(coSign(operator, { ...base, userId: checkerId, password: "" }), "validation");
    await expectCode(coSign(operator, { ...base, userId: checkerId, password: "not-his-password" }), "validation");
    const failed = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, checkerId), eq(auditEvents.action, "identity.co_signature.failed")));
    expect(failed.length).toBeGreaterThanOrEqual(1);
    await expectCode(coSign(operator, { ...base, userId: operator.userId, password: PW }), "separation_of_duties");
    const s = await coSign(operator, { ...base, userId: checkerId, password: PW });
    expect(s.userId).toBe(checkerId);
    expect(s.coSigned).toMatchObject({ operatorUserId: operator.userId, via: "password" });
    expect(s.signedOn).toBe("operator_device");
    // The old name-only audit is gone; the password co-signature is recorded instead.
    const byName = await db.select().from(auditEvents).where(eq(auditEvents.action, "identity.co_signature.by_name"));
    expect(byName).toHaveLength(0);
    const pw = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, checkerId), eq(auditEvents.action, "identity.co_signature.password")));
    expect(pw.length).toBeGreaterThanOrEqual(1);
    // Reset the failure count for the following tests.
    await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, checkerId));
  });

  it("with same-device signing off, even the right password is refused: the checker uses their own phone", async () => {
    await setSetting("production.sign_off.same_device", false);
    try {
      const e = await expectCode(coSign(operator, { role: "checker", permission: "production.dispense_record.approve", siteId: kit.nfd.id, userId: checkerId, password: PW }), "validation");
      expect((e as Error).message).toMatch(/own phone/);
    } finally {
      await clearSetting("production.sign_off.same_device");
    }
  });

  it("the record says where it was signed: password on the operator's phone vs the checker's own session", async () => {
    const { batchId } = await startedBatch();
    const [first, second] = await weighAllUnchecked(batchId);
    const cosigned = await coSign(operator, { role: "checker", permission: "production.dispense_record.approve", siteId: kit.nfd.id, userId: checkerId, password: PW });
    await checkDispense(cosigned, { dispenseRecordId: first });
    await checkDispense(checker, { dispenseRecordId: second });
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.action, "production.dispense_record.checked"));
    const of = (id: string) => ev.find((x) => x.entityId === id)!.after as { signedOn: string };
    expect(of(first).signedOn).toBe("operator_device");
    expect(of(second).signedOn).toBe("own_session");
    // The operator can never check her own weighing in her own session.
    const third = (await weighAllUnchecked(batchId))[0];
    if (third) await expectCode(checkDispense(operator, { dispenseRecordId: third }), "separation_of_duties");
  });
});

describe("one checker flow: 'Waiting for you to check'", () => {
  let batchId: string;
  let batchNumber: string;
  let ids: string[];
  let steps: Awaited<ReturnType<typeof startedBatch>>["steps"];
  beforeAll(async () => {
    ({ batchId, batchNumber, steps } = await startedBatch());
    ids = await weighAllUnchecked(batchId);
  }, 120_000);

  it("the checker sees ONE card listing every weighing of the batch; the weigher sees none; counts match (B13)", async () => {
    expect(ids.length).toBeGreaterThan(1);
    const q = await checkerQueue(checker);
    const cards = q.cards.filter((c) => c.batchId === batchId);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.kind).toBe("weighings");
    if (c.kind !== "weighings") return;
    expect(c.batchNumber).toBe(batchNumber);
    expect(c.weighings.map((w) => w.id).sort()).toEqual([...ids].sort());
    expect(c.operatorNames).toEqual(["Rhea"]);
    // Plain amounts: no trailing zeros, the unit the operator weighed in.
    for (const w of c.weighings) expect(w.amount).not.toMatch(/\.\d*0 /);
    expect(await checksWaitingCount(checker)).toBeGreaterThanOrEqual(ids.length);
    expect((await checkerQueue(operator)).cards.filter((x) => x.batchId === batchId)).toHaveLength(0);
    const counts = floorTaskCounts(await myFloorTasks(checker));
    expect(counts.checking).toBeGreaterThanOrEqual(1);
    const t = (await myFloorTasks(checker)).find((x) => x.batchId === batchId)!;
    expect(t.href).toBe("/production/checks");
  });

  it("negatives: the weigher, another site, the warehouse cannot confirm; a weighing of another batch is refused", async () => {
    await expectCode(checkDispenses(operator, { batchId, dispenseRecordIds: ids }), "separation_of_duties");
    await expectCode(checkDispenses(operatorRvs, { batchId, dispenseRecordIds: ids }), "not_found");
    await expectCode(checkDispenses(warehouse, { batchId, dispenseRecordIds: ids }), "forbidden");
    const other = await startedBatch();
    const otherIds = await weighAllUnchecked(other.batchId);
    await expectCode(checkDispenses(checker, { batchId, dispenseRecordIds: [...ids, otherIds[0]] }), "not_found");
    // Nothing was checked by the refused calls (all or nothing).
    const rows = await db.select().from(dispenseRecords).where(eq(dispenseRecords.checkerId, checker.userId));
    expect(rows.filter((r) => ids.includes(r.id))).toHaveLength(0);
  });

  it("with 'check together' off, several at once is refused and the list shows one card per weighing", async () => {
    await setSetting("production.weighing.check_together", false);
    try {
      await expectCode(checkDispenses(checker, { batchId, dispenseRecordIds: ids }), "validation");
      const cards = (await checkerQueue(checker)).cards.filter((c) => c.batchId === batchId);
      expect(cards).toHaveLength(ids.length);
    } finally {
      await clearSetting("production.weighing.check_together");
    }
  });

  it("one 'Looks right' checks all of them, each recorded; the card leaves the list; a second tap is refused", async () => {
    const r = await checkDispenses(checker, { batchId, dispenseRecordIds: ids, idempotencyKey: key() });
    expect(r.checked).toBe(ids.length);
    const rows = await db.select().from(dispenseRecords).where(eq(dispenseRecords.checkerId, checker.userId));
    expect(rows.filter((x) => ids.includes(x.id))).toHaveLength(ids.length);
    const ev = await db.select().from(auditEvents).where(eq(auditEvents.action, "production.dispense_record.checked"));
    expect(ev.filter((e) => ids.includes(e.entityId!) && (e.after as { together: number }).together === ids.length)).toHaveLength(ids.length);
    expect((await checkerQueue(checker)).cards.filter((c) => c.batchId === batchId && c.kind === "weighings")).toHaveLength(0);
    await expectCode(checkDispenses(checker, { batchId, dispenseRecordIds: ids, idempotencyKey: key() }), "state");
  });

  it("a step waiting for its check is a card with what was typed; checking it from the list completes it", async () => {
    const weigh = steps.find((s) => s.stepKind === "dispensing")!;
    const r = await completeStep(operator, { batchId, stepNo: weigh.stepNo }, { checker: null });
    expect(r.status).toBe("awaiting_check");
    const card = (await checkerQueue(checker)).cards.find((c) => c.kind === "step" && c.batchId === batchId);
    expect(card).toMatchObject({ kind: "step", stepNo: weigh.stepNo, doneBy: "Rhea Mendoza" });
    expect((await checkerQueue(operator)).cards.find((c) => c.kind === "step" && c.batchId === batchId)).toBeUndefined();
    await checkStep(checker, { batchId, stepNo: weigh.stepNo, idempotencyKey: key() });
    expect((await checkerQueue(checker)).cards.find((c) => c.kind === "step" && c.batchId === batchId)).toBeUndefined();
  });

  it("B4: Step done with a required value empty is refused and writes nothing; B3: out of range says it plainly", async () => {
    const mix = steps.find((s) => s.stepKind === "process" && (s.parameters ?? []).some((p) => p.isRequired && p.valueKind === "numeric"))!;
    for (const s of steps.filter((x) => x.stepKind === "line_clearance" && x.stepNo < mix.stepNo).slice(1)) await signChecklist(operator, checker, batchId, s);
    if (mix.requiresEquipment) await selectEquipment(operator, { batchId, stepNo: mix.stepNo, equipmentRef: "MIX-01" });
    const before = await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, mix.stepNo)));
    const e = await expectCode(stepDone(operator, { batchId, stepNo: mix.stepNo, readings: [], idempotencyKey: key() }), "validation");
    expect((e as Error).message).toMatch(/^Type the .+ first\. Nothing was saved\.$/);
    expect((e as Error).message).not.toMatch(/Saved\./);
    const after = await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, mix.stepNo)));
    expect(after.map((x) => x.status)).toEqual(before.map((x) => x.status));
    // The out-of-range sentence (B3) is asserted in execution-controls.test.ts (a step with limits).
    const req = mix.parameters!.filter((x) => x.isRequired);
    const fill = (x: (typeof req)[number]) => ({ parameterId: x.id, value: x.valueKind === "numeric" ? (x.targetValue ?? x.minValue ?? x.maxValue ?? "45") : x.valueKind === "boolean" ? "yes" : "ok" });
    const ok = await stepDone(operator, { batchId, stepNo: mix.stepNo, readings: req.map(fill), idempotencyKey: key() });
    expect(ok.blocked).toBe(false);
    // Changing a saved value needs a reason (tapped on the card: "I typed it wrong", "I measured again", "Other").
    if (ok.status === "awaiting_check") await checkStep(checker, { batchId, stepNo: mix.stepNo, idempotencyKey: key() });
  });
});

describe("B2: Finish refuses empty packaging counts", () => {
  it("empty left over or empty damaged is refused with a plain question; 0 typed on purpose is accepted", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const base = { batchId: b.batchId, goodUnits: "60", samplesKept: "0" };
    const e1 = await expectCode(finishBatch(operator, { ...base, packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "" }], idempotencyKey: key() }, { checker }), "validation");
    expect((e1 as Error).message).toMatch(/how many are left over\? Type 0 if none\./);
    const e2 = await expectCode(finishBatch(operator, { ...base, packaging: [{ materialId: b.wrapperMaterialId, damaged: null, leftOver: "10" }], idempotencyKey: key() }, { checker }), "validation");
    expect((e2 as Error).message).toMatch(/how many are damaged\? Type 0 if none\./);
    const [still] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    expect(still.status).toBe("in_process");
    const r = await finishBatch(operator, { ...base, packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "10" }], idempotencyKey: key() }, { checker });
    expect(r.batchNumber).toBe(b.batchNumber);
  });
});
