/**
 * Wave 3 W3E boxing (US-4-07) and customer repack (US-4-08): packs from a batch output, box labels,
 * checker verification with SoD and sampling, the T-14 reconciliation block, the boxing note and its
 * v2 after a repack with lineage, voided labels of repacked boxes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { batchOutputs, containerLineage, containers, generatedDocuments, inventoryLots, labelJobs, packBoxes, packs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { containerLineageGraph } from "@/modules/inventory";
import { addBox, approvePack, getPack, printPackLabels, removeBox, repackForCustomer, startPack, submitPack, verifyPackScan } from "@/modules/sales";
import { markLabelJobPrinted } from "@/modules/documents";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { runSoapBatchToQuarantine } from "../../support/w2b";
import { key } from "../../support/w3e";

let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let wh: AuthContext;
let operatorRvs: AuthContext;
let outputId: string;
let lotId: string;
let packId: string;
let outputQty: number;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  const r = await runSoapBatchToQuarantine(kit, { manager, operator, checker, units: "124" });
  const [out] = await db.select().from(batchOutputs).where(and(eq(batchOutputs.batchId, r.batchId), eq(batchOutputs.outputKind, "finished"), isNotNull(batchOutputs.lotId)));
  outputId = out.id;
  lotId = out.lotId!;
  outputQty = Number(out.qtyBase);
}, 240_000);

describe("US-4-07 boxing from a batch output", () => {
  it("starts a pack only with inventory.pack.create at the output's site; units per box from the SKU default", async () => {
    await expectCode(startPack(qa, { sourceKind: "batch_output", batchOutputId: outputId, idempotencyKey: key() }), "forbidden");
    await expectCode(startPack(operatorRvs, { sourceKind: "batch_output", batchOutputId: outputId, idempotencyKey: key() }), "not_found");
    const r = await startPack(operator, { sourceKind: "batch_output", batchOutputId: outputId, idempotencyKey: key() });
    packId = r.packId;
    expect(r.packNumber).toMatch(/^PA-\d{2}-\d{6}$/);
    const [p] = await db.select().from(packs).where(eq(packs.id, packId));
    expect(Number(p.expectedUnitsBase)).toBe(outputQty);
    expect(p.configSnapshot).toMatchObject({ source: "sku_default" });
    await expectCode(startPack(operator, { sourceKind: "batch_output", batchOutputId: outputId, idempotencyKey: key() }), "conflict");
  });

  it("boxes the quarantined lot (status inherited), refuses more than a box holds, flags the last box PARTIAL", async () => {
    const [p] = await db.select().from(packs).where(eq(packs.id, packId));
    const full = Math.floor(outputQty / p.unitsPerBox);
    const rest = outputQty - full * p.unitsPerBox;
    await expectCode(addBox(operator, packId, { qty: String(p.unitsPerBox + 1), idempotencyKey: key() }), "validation");
    await expectCode(addBox(operator, packId, { lotPayload: "BC:LOT:L-NOT-THIS-ONE", idempotencyKey: key() }), "validation");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId));
    expect(lot.qualityStatus).toBe("quarantine");
    for (let i = 0; i < full; i++) await addBox(operator, packId, { lotPayload: `BC:LOT:${lot.lotNumber}`, idempotencyKey: key() });
    // T-14: boxes × units ≠ lot output blocks submission and verification.
    if (rest > 0) {
      await expect(submitPack(operator, packId)).rejects.toMatchObject({ code: "conflict", details: { code: "PACK_NOT_RECONCILED" } });
      const last = await addBox(operator, packId, { qty: String(rest), idempotencyKey: key() });
      expect(last.partial).toBe(true);
    }
    const boxes = await db.select().from(containers).innerJoin(packBoxes, eq(packBoxes.containerId, containers.id)).where(eq(packBoxes.packId, packId));
    expect(boxes.every((b) => b.containers.status === "sealed")).toBe(true);
    await expectCode(addBox(operator, packId, { qty: "1", idempotencyKey: key() }), "validation");
  });

  it("removes a wrongly packed box before verification (contents back to loose, box void)", async () => {
    const extra = await db.select().from(packBoxes).where(eq(packBoxes.packId, packId)).orderBy(asc(packBoxes.boxNo));
    const victim = extra[0];
    await removeBox(operator, packId, victim.containerId, "Carton torn while taping");
    expect((await db.select().from(containers).where(eq(containers.id, victim.containerId)))[0].status).toBe("void");
    await addBox(operator, packId, { qty: String(Number(victim.qtyBase)), idempotencyKey: key() });
  });

  it("prints a box label per box with BC:BOX, units, packer initials and Box n of N", async () => {
    const jobs = await printPackLabels(operator, packId, { keyBase: key() });
    const v = await getPack(operator, packId);
    expect(jobs.filter((j) => j.jobId)).toHaveLength(v.boxes.filter((b) => b.status === "packed").length);
    const first = jobs[0];
    const [job] = await db.select().from(labelJobs).where(eq(labelJobs.id, first.jobId!));
    const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, job.generatedDocumentId!));
    const entity = (doc.dataset as { data: { entity: Record<string, string> } }).data.entity;
    expect(entity).toMatchObject({ payloadType: "BOX", statusWord: "QUARANTINE" });
    expect(entity.boxOfText).toMatch(/ of /);
    expect(entity.packerInitials).toBeTruthy();
    for (const j of jobs) await markLabelJobPrinted(operator, j.jobId!);
  });

  it("sod.pack.checker_not_packer: the packer cannot verify; the checker scans every box of the first pack of a SKU", async () => {
    await expectCode(verifyPackScan(checker, packId, { payload: "BC:BOX:BX-00000001", idempotencyKey: key() }), "state"); // not submitted yet
    const s = await submitPack(operator, packId);
    expect(s.verificationMode).toBe("all");
    await expectCode(verifyPackScan(operator, packId, { payload: "BC:BOX:BX-00000001", idempotencyKey: key() }), "separation_of_duties");
    await expectCode(approvePack(operator, packId), "separation_of_duties");
    expect((await verifyPackScan(checker, packId, { payload: "BC:BOX:BX-00000001", idempotencyKey: key() })).result).toBe("not_in_pack");
    expect((await verifyPackScan(checker, packId, { payload: "BC:BOX:NOPE-1", idempotencyKey: key() })).result).toBe("unknown_box");
    const v = await getPack(checker, packId);
    const live = v.boxes.filter((b) => b.status === "packed");
    expect((await verifyPackScan(checker, packId, { payload: `BC:BOX:${live[0].number}`, labelOk: false, idempotencyKey: key() })).result).toBe("label_mismatch");
    for (const b of live.slice(1)) await verifyPackScan(checker, packId, { payload: `BC:BOX:${b.number}`, idempotencyKey: key() });
    await expect(approvePack(checker, packId)).rejects.toMatchObject({ code: "conflict", details: { code: "LABEL_MISMATCH" } });
    expect((await verifyPackScan(checker, packId, { payload: `BC:BOX:${live[0].number}`, idempotencyKey: key() })).result).toBe("ok");
    expect((await verifyPackScan(checker, packId, { payload: `BC:BOX:${live[0].number}`, idempotencyKey: key() })).result).toBe("duplicate");
    const r = await approvePack(checker, packId);
    expect(r.boxingNoteNumber).toMatch(/^DOC-/);
    const [p] = await db.select().from(packs).where(eq(packs.id, packId));
    expect(p).toMatchObject({ status: "verified", checkedBy: checker.userId, packedBy: operator.userId, verificationFailureCount: 3 });
  });

  it("boxing note lists box ids, quantities, PARTIAL and totals equal to the lot output", async () => {
    const [doc] = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityId, packId), eq(generatedDocuments.documentKind, "boxing_note"), eq(generatedDocuments.status, "ready")));
    const data = (doc.dataset as { data: { variant: string; boxes: { boxNumber: string; partial: boolean }[]; totals: { unitsText: string; differenceText: string } } }).data;
    expect(data.variant).toBe("batch");
    expect(Number(data.totals.unitsText)).toBe(outputQty);
    expect(data.totals.differenceText).toBe("0");
    if (outputQty % 24 !== 0) expect(data.boxes.some((b) => b.partial)).toBe(true);
  });
});

describe("US-4-08 repack for a customer carton count", () => {
  it("refuses boxes of a lot that is not released", async () => {
    const live = (await getPack(wh, packId)).boxes.filter((b) => b.status === "packed");
    await expectCode(repackForCustomer(wh, { containerIds: [live[0].containerId], unitsPerBox: 12, reason: "Customer wants 12s", idempotencyKey: key() }), "blocked_lot");
  });

  it("container.repack_preserves_history: new boxes, lineage edges, old labels voided, boxing note v2 supersedes v1", async () => {
    await db.update(inventoryLots).set({ qualityStatus: "released" }).where(eq(inventoryLots.id, lotId));
    const live = (await getPack(wh, packId)).boxes.filter((b) => b.status === "packed" && !b.isPartial);
    const src = live.slice(0, 2);
    const [v1] = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityId, packId), eq(generatedDocuments.documentKind, "boxing_note"), eq(generatedDocuments.status, "ready")));
    await expectCode(repackForCustomer(qa, { containerIds: src.map((b) => b.containerId), unitsPerBox: 12, reason: "Customer wants 12s", idempotencyKey: key() }), "forbidden");
    const r = await repackForCustomer(wh, { containerIds: src.map((b) => b.containerId), unitsPerBox: 12, reason: "Isla Spa carton count is 12", idempotencyKey: key() });
    const total = src.reduce((a, b) => a + Number(b.qtyBase), 0);
    expect(r.boxes.map((b) => Number(b.qty))).toEqual(Array.from({ length: total / 12 }, () => 12));
    for (const b of src) expect((await db.select().from(containers).where(eq(containers.id, b.containerId)))[0].status).toBe("empty");
    const edges = await db.select().from(containerLineage).where(eq(containerLineage.operation, "repack"));
    expect(edges.length).toBeGreaterThanOrEqual(r.boxes.length);
    const graph = await containerLineageGraph(db, r.boxes[0].id);
    expect(graph.some((g) => g.direction === "ancestor" && src.some((s) => s.containerId === g.parent_id))).toBe(true);
    const oldLabels = await db.select().from(labelJobs).where(and(eq(labelJobs.entityType, "container"), eq(labelJobs.entityId, src[0].containerId)));
    expect(oldLabels.every((j) => j.voidedAt !== null || j.status === "cancelled")).toBe(true);
    const [v1After] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, v1.id));
    expect(v1After.status).not.toBe("ready");
    const [v2] = await db.select().from(generatedDocuments).where(and(eq(generatedDocuments.sourceEntityId, packId), eq(generatedDocuments.documentKind, "boxing_note"), eq(generatedDocuments.status, "ready")));
    expect(v2.recordRevisionNo).toBe(2);
    const data = (v2.dataset as { data: { replaces: string; lineage: unknown[]; boxes: { statusText: string }[] } }).data;
    expect(data.replaces).toBe(v1.documentNumber);
    expect(data.lineage.length).toBeGreaterThan(0);
    expect(data.boxes.filter((b) => b.statusText === "Repacked")).toHaveLength(2);
    // The repack pack is verified by a checker like any pack.
    await expectCode(approvePack(wh, r.packId), "separation_of_duties");
    for (const b of r.boxes) await verifyPackScan(manager, r.packId, { payload: `BC:BOX:${b.number}`, idempotencyKey: key() });
    const ok = await approvePack(manager, r.packId);
    expect(ok.boxingNoteNumber).toMatch(/^DOC-/);
  });
});
