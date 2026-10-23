import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batchStateTransitions,
  batches,
  dispenseRecords,
  formulaRevisions,
  formulas,
  inventoryBalances,
  inventoryLots,
  locations,
  organizations,
  sites,
  stockMovements,
  users,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { completeBatch, completeStep, createBatch, getBatchRecord, recordDispense, startBatch } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let manager: AuthContext;
let operator: AuthContext;
let operatorRvsOnly: AuthContext;
let auditor: AuthContext;
let checkerId: string;
let warehouseId: string;
let acsRevisionId: string;

async function ctxFor(email: string, role: keyof typeof ROLE_BUNDLES, siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, [role], new Set(ROLE_BUNDLES[role].permissions), siteList, siteList[0].id);
}
/** Seed lots looked up by supplier lot number (internal lot numbers depend on the seed month). */
const lot = async (supplierLot: string) => (await db.select().from(inventoryLots).where(eq(inventoryLots.supplierLotNumber, supplierLot)))[0];
const loc = async (code: string, siteId = nfd.id) => (await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code))))[0];
const lines = async (batchId: string) => db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}

/** Released FEFO lot per material code, with its location, from the seed. */
const SOAP_LOTS: Record<string, [string, string]> = {
  "MAT-0012": ["LOS-24871", "A-01"],
  "MAT-0013": ["MPC-7731", "A-02"],
  "MAT-0021": ["LYE-1009", "B-01"],
  "MAT-0043": ["LB-7712", "B-01"],
  "MAT-0051": ["GRN-0311", "B-01"],
};

async function weighAll(batchId: string, opts: { outOfToleranceLine?: number } = {}) {
  const rec = await getBatchRecord(operator, batchId);
  for (const ing of rec.ingredients) {
    if (ing.status !== "pending") continue;
    const [lotNo, locCode] = SOAP_LOTS[ing.materialCode];
    const l = await lot(lotNo);
    const where = await loc(locCode);
    const off = opts.outOfToleranceLine === ing.lineNo;
    await recordDispense(operator, {
      batchId,
      batchMaterialId: ing.id,
      lotId: l.id,
      fromLocationId: where.id,
      actualQtyG: off ? new Decimal(ing.theoreticalQtyG).mul("1.02").toDecimalPlaces(1).toString() : new Decimal(ing.theoreticalQtyG).toDecimalPlaces(1).toString(),
      checkerId,
      exceptionReason: off ? "Test exception" : null,
    });
  }
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  manager = await ctxFor("manager.nfd@bryels-care.test", "site_manager", [nfd]);
  operator = await ctxFor("operator.nfd@bryels-care.test", "production_operator", [nfd]);
  operatorRvsOnly = await ctxFor("operator.nfd@bryels-care.test", "production_operator", [rvs]);
  auditor = await ctxFor("auditor@bryels-care.test", "auditor", [nfd, rvs]);
  checkerId = (await db.select().from(users).where(eq(users.email, "checker.nfd@bryels-care.test")))[0].id;
  warehouseId = (await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test")))[0].id;
  const [rev] = await db
    .select({ id: formulaRevisions.id })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .where(and(eq(formulas.code, "F-ACS-01"), eq(formulaRevisions.status, "approved")));
  acsRevisionId = rev.id;
}, 120_000);

describe("batch creation (snapshot, scaling, numbering)", () => {
  it("creates a planned batch with a frozen snapshot, scaled lines, transition and audit", async () => {
    const { batchId, batchNumber } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "8.8", plannedStartOn: "2026-10-30" });
    expect(batchNumber).toMatch(/^B-\d{2}-\d{4}$/);
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(b.status).toBe("planned");
    expect(b.plannedSizeG).toBe("8800.000000");
    expect(new Decimal(b.theoreticalYieldG!).eq(8360)).toBe(true); // 95 % of 8.8 kg
    const snap = b.formulaSnapshot as { formulaCode: string; revisionNo: number; lines: unknown[]; steps: unknown[] };
    expect(snap.formulaCode).toBe("F-ACS-01");
    expect(snap.lines).toHaveLength(5);
    expect(snap.steps).toHaveLength(7);
    const ls = await lines(batchId);
    expect(new Decimal(ls[0].theoreticalQtyG).eq("1861.6")).toBe(true); // 3723.2 × 0.5
    const tr = await db.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, batchId));
    expect(tr.map((t) => t.toState)).toEqual(["planned"]);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, batchId), eq(auditEvents.action, "production.batch.created")));
    expect(au).toHaveLength(1);
  });

  it("replays the same result for a repeated idempotency key", async () => {
    const key = "test-create-key-0001";
    const a = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: "2026-10-30", idempotencyKey: key });
    const b = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: "2026-10-30", idempotencyKey: key });
    expect(b.batchId).toBe(a.batchId);
    expect(await db.select().from(batches).where(eq(batches.batchNumber, a.batchNumber))).toHaveLength(1);
  });

  it("refuses role escalation: an operator cannot create batches", async () => {
    await expectCode(createBatch(operator, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: "2026-10-30" }), "forbidden");
  });

  it("rejects a non-positive size", async () => {
    await expectCode(createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "0", plannedStartOn: "2026-10-30" }), "validation");
  });
});

describe("dispensing rules", () => {
  let batchId: string;
  beforeAll(async () => {
    ({ batchId } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: "2026-10-30" }));
  });

  it("blocks weighing before the batch is started", async () => {
    const [l1] = await lines(batchId);
    await expectCode(
      recordDispense(operator, { batchId, batchMaterialId: l1.id, lotId: (await lot("LOS-24871")).id, fromLocationId: (await loc("A-01")).id, actualQtyG: "3723.2", checkerId }),
      "state",
    );
  });

  it("starts with two recorded transitions", async () => {
    await startBatch(operator, batchId);
    const tr = await db.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, batchId)).orderBy(batchStateTransitions.at);
    expect(tr.map((t) => `${t.fromState}>${t.toState}`)).toEqual(["null>planned", "planned>materials_staged", "materials_staged>in_process"]);
    await expectCode(startBatch(operator, batchId), "state");
  });

  it("enforces separation of duties (checker ≠ operator) and checker eligibility", async () => {
    const [l1] = await lines(batchId);
    const base = { batchId, batchMaterialId: l1.id, lotId: (await lot("LOS-24871")).id, fromLocationId: (await loc("A-01")).id, actualQtyG: "3723.2" };
    await expectCode(recordDispense(operator, { ...base, checkerId: operator.userId }), "separation_of_duties");
    await expectCode(recordDispense(operator, { ...base, checkerId: warehouseId }), "validation"); // no approve permission
  });

  it("blocks quarantined, expired and wrong-material lots", async () => {
    const ls = await lines(batchId);
    const coconut = ls[0];
    const extract = ls[3];
    const e1 = await expectCode(
      recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotId: (await lot("LOS-25013")).id, fromLocationId: (await loc("QUA-01")).id, actualQtyG: "3723.2", checkerId }),
      "blocked_lot",
    );
    expect(e1.message).toMatch(/quarantine/);
    const e2 = await expectCode(
      recordDispense(operator, { batchId, batchMaterialId: extract.id, lotId: (await lot("LB-6620")).id, fromLocationId: (await loc("B-01")).id, actualQtyG: "190.9", checkerId }),
      "blocked_lot",
    );
    expect(e2.message).toMatch(/expired/);
    await expectCode(
      recordDispense(operator, { batchId, batchMaterialId: coconut.id, lotId: (await lot("MPC-7731")).id, fromLocationId: (await loc("A-02")).id, actualQtyG: "3723.2", checkerId }),
      "blocked_lot",
    );
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, coconut.id))).toHaveLength(0);
  });

  it("requires a reason outside tolerance and flags the exception", async () => {
    const extract = (await lines(batchId))[3];
    const base = { batchId, batchMaterialId: extract.id, lotId: (await lot("LB-7712")).id, fromLocationId: (await loc("B-01")).id, actualQtyG: "195", checkerId };
    await expectCode(recordDispense(operator, base), "out_of_tolerance");
    await recordDispense(operator, { ...base, exceptionReason: "Over-poured; supervisor informed" });
    const [bm] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, extract.id));
    expect(bm.status).toBe("exception");
    const [rec] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, extract.id));
    expect(rec.isWithinTolerance).toBe(false);
    expect(rec.exceptionReason).toMatch(/Over-poured/);
  });

  it("posts one consumption movement per weighing and is idempotent", async () => {
    const coconut = (await lines(batchId))[0];
    const l = await lot("LOS-24871");
    const a01 = await loc("A-01");
    const before = (await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, l.id), eq(inventoryBalances.locationId, a01.id))))[0].qtyBase;
    const input = { batchId, batchMaterialId: coconut.id, lotId: l.id, fromLocationId: a01.id, actualQtyG: "3723.2", checkerId, idempotencyKey: "test-dispense-key-1" };
    const r1 = await recordDispense(operator, input);
    const r2 = await recordDispense(operator, input);
    expect(r2.dispenseRecordId).toBe(r1.dispenseRecordId);
    const after = (await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, l.id), eq(inventoryBalances.locationId, a01.id))))[0].qtyBase;
    expect(new Decimal(before).minus(after).eq("3723.2")).toBe(true);
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceDocumentId, batchId), eq(stockMovements.lotId, l.id)));
    expect(mv).toHaveLength(1);
    expect(mv[0].movementType).toBe("consumption");
    // A second weighing of the same ingredient (new key) is refused.
    await expectCode(recordDispense(operator, { ...input, idempotencyKey: "test-dispense-key-2" }), "state");
  });

  it("serializes concurrent weighings of the same ingredient: exactly one succeeds", async () => {
    const palm = (await lines(batchId))[1];
    const base = { batchId, batchMaterialId: palm.id, lotId: (await lot("MPC-7731")).id, fromLocationId: (await loc("A-02")).id, actualQtyG: "8687.4", checkerId };
    const results = await Promise.allSettled([recordDispense(operator, { ...base, idempotencyKey: "conc-a" }), recordDispense(operator, { ...base, idempotencyKey: "conc-b" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, palm.id))).toHaveLength(1);
  });

  it("denies cross-site access (operator scoped to RVS only)", async () => {
    const lye = (await lines(batchId))[2];
    await expectCode(getBatchRecord(operatorRvsOnly, batchId), "not_found");
    await expectCode(startBatch(operatorRvsOnly, batchId), "not_found");
    await expectCode(
      recordDispense(operatorRvsOnly, { batchId, batchMaterialId: lye.id, lotId: (await lot("LYE-1009")).id, fromLocationId: (await loc("B-01")).id, actualQtyG: "4964.2", checkerId }),
      "not_found",
    );
    await expectCode(completeStep(operatorRvsOnly, { batchId, stepNo: 1, checkerId }), "not_found");
  });

  it("denies role escalation: the read-only auditor cannot weigh, complete steps or complete batches", async () => {
    const lye = (await lines(batchId))[2];
    await expectCode(
      recordDispense(auditor, { batchId, batchMaterialId: lye.id, lotId: (await lot("LYE-1009")).id, fromLocationId: (await loc("B-01")).id, actualQtyG: "4964.2", checkerId }),
      "forbidden",
    );
    await expectCode(completeStep(auditor, { batchId, stepNo: 1, checkerId }), "forbidden");
    await expectCode(completeBatch(auditor, { batchId, actualUnits: "10" }), "forbidden");
  });
});

describe("checklist steps and completion", () => {
  let batchId: string;
  beforeAll(async () => {
    ({ batchId } = await createBatch(manager, { formulaRevisionId: acsRevisionId, plannedSizeKg: "17.6", plannedStartOn: "2026-10-30" }));
    await startBatch(operator, batchId);
  });

  it("completes steps strictly in order with a distinct checker", async () => {
    await expectCode(completeStep(operator, { batchId, stepNo: 2, checkerId }), "state");
    await expectCode(completeStep(operator, { batchId, stepNo: 1, checkerId: operator.userId }), "separation_of_duties");
    await completeStep(operator, { batchId, stepNo: 1, checkerId });
    await expectCode(completeStep(operator, { batchId, stepNo: 1, checkerId }), "state");
  });

  it("blocks the Weighing step until every ingredient is weighed", async () => {
    await expectCode(completeStep(operator, { batchId, stepNo: 2, checkerId }), "state");
    await expectCode(completeBatch(operator, { batchId, actualUnits: "124" }), "state");
    await weighAll(batchId, { outOfToleranceLine: 5 });
    await completeStep(operator, { batchId, stepNo: 2, checkerId });
  });

  it("completes the batch: quarantined output lot, output movement, yield, awaiting_qc, idempotent", async () => {
    for (let n = 3; n <= 7; n++) await completeStep(operator, { batchId, stepNo: n, checkerId, readings: n === 4 ? "48 °C" : null });
    const key = "test-complete-key";
    const r1 = await completeBatch(operator, { batchId, actualUnits: "124", remarks: "ok", idempotencyKey: key });
    const r2 = await completeBatch(operator, { batchId, actualUnits: "124", remarks: "ok", idempotencyKey: key });
    expect(r2.lotNumber).toBe(r1.lotNumber);
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(b.status).toBe("awaiting_qc");
    expect(new Decimal(b.actualOutputG!).eq(16740)).toBe(true); // 124 × 135 g
    expect(new Decimal(b.yieldPct!).eq("100.12")).toBe(true); // 16740 / 16720
    const [out] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, b.outputLotId!));
    expect(out.qualityStatus).toBe("quarantine");
    expect(out.itemKind).toBe("product");
    expect(out.sourceBatchId).toBe(batchId);
    const qua = await loc("QUA-01");
    const mv = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, out.id), eq(stockMovements.movementType, "output")));
    expect(mv).toHaveLength(1);
    expect(mv[0].toLocationId).toBe(qua.id);
    expect(new Decimal(mv[0].qtyBase).eq(124)).toBe(true);
    await expectCode(completeBatch(operator, { batchId, actualUnits: "124" }), "state");
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityNumber, b.batchNumber), eq(auditEvents.action, "production.process_step.completed")));
    expect(au).toHaveLength(7);
  });

  it("rejects non-integer unit counts", async () => {
    await expectCode(completeBatch(operator, { batchId, actualUnits: "12.5" }), "validation");
  });
});
