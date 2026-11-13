/**
 * ADR-134 — print the batch record with no internet, then type it in from paper.
 *
 * Slice 1: one "Paper batch record" pack per batch (one issued page per step, DOC number and QR per page; the weighing
 * page lists every ingredient with blank boxes; the last page lists the finish counts). The device copy is built on the
 * server for people who may see the batch and its documents, at their sites only.
 * Slice 2: "Enter from the paper record": the time written on paper, who did it and who checked it, the page's DOC.
 * Records are marked "from paper" in the row and the audit; stock moves still go through postMovement (posted time is
 * now, the paper time is kept in the movement's meta); tolerance and lot rules still apply; weighing on paper needs the
 * outage reason and the setting `production.paper.outage_entry_allowed`; the transcription review stays with a person
 * who typed none of the page. Fictional data only.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batchPaperRecords, batches, deviations, dispenseRecords, generatedDocuments, materials, processStepRecords, settings, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  attachPaperScan,
  createBatch,
  enterStepFromPaper,
  enterWeighingFromPaper,
  getBatchExecution,
  issuePaperPack,
  paperEntryView,
  paperPackForDevice,
  paperRecordBlockers,
  reviewPaperRecord,
  startBatch,
  upcomingPaperPacks,
  voidPaperPage,
  voidUnusedPackPages,
} from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";
import { SOAP_LOTS, acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, snapshotOf } from "../../support/w2b";

let kit: Kit;
let manager: AuthContext;
let managerRvs: AuthContext;
let operatorRvs: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let qa: AuthContext;
let warehouse: AuthContext;
let storageDir: string;
const savedEnv = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };
const PDF = Uint8Array.from(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"));
const key = () => randomUUID();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function setSetting(k: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, k), isNull(settings.siteId)));
  if (value !== undefined) await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: k, value });
}

/** A new Acapulco batch, materials confirmed (materials_staged), with its paper pack. */
async function batchWithPack() {
  const { batchId } = await createBatch(manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  await cleanEquipment(operator, "SC-01");
  const pack = await issuePaperPack(operator, { batchId, idempotencyKey: key() });
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const steps = [...snapshotOf(b).steps].sort((x, y) => x.stepNo - y.stepNo);
  const page = (stepNo: number) => pack.pages.find((p) => p.stepNo === stepNo)!.paperRecordId;
  const lines = await db.select({ bm: batchMaterials, code: materials.code, kind: materials.materialKind }).from(batchMaterials).innerJoin(materials, eq(materials.id, batchMaterials.materialId)).where(eq(batchMaterials.batchId, batchId)).orderBy(asc(batchMaterials.lineNo));
  return { batchId, b, steps, pack, page, lines: lines.filter((l) => SOAP_LOTS[l.code]) };
}

/** Step 1 (weighing-area clearance) typed from paper: the batch is then in process. */
async function clearanceFromPaper(w: Awaited<ReturnType<typeof batchWithPack>>) {
  const s1 = w.steps[0];
  return enterStepFromPaper(operator, {
    batchId: w.batchId,
    stepNo: s1.stepNo,
    paper: { paperRecordId: w.page(s1.stepNo), occurredAt: minutesAgo(3), doneById: operator.userId, checkedById: checker.userId },
    answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })),
    idempotencyKey: key(),
  });
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  storageDir = mkdtempSync(path.join(tmpdir(), "bc-adr134-"));
  process.env.FILE_STORAGE = "local";
  process.env.FILE_STORAGE_DIR = storageDir;
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  await allowDirectBatches(kit);
}, 240_000);

afterAll(() => {
  process.env.FILE_STORAGE = savedEnv.FILE_STORAGE;
  process.env.FILE_STORAGE_DIR = savedEnv.FILE_STORAGE_DIR;
});

describe("ADR-134 slice 1: the paper batch record pack", () => {
  it("issues one page per step with its own DOC number; the weighing page lists every ingredient; the last page the finish counts", async () => {
    const w = await batchWithPack();
    expect(w.pack.pages.map((p) => p.stepNo)).toEqual(w.steps.map((s) => s.stepNo));
    const rows = await db.select().from(batchPaperRecords).where(eq(batchPaperRecords.batchId, w.batchId));
    expect(rows).toHaveLength(w.steps.length);
    expect(new Set(rows.map((r) => r.packId))).toEqual(new Set([w.pack.packId]));
    expect(rows.every((r) => r.status === "issued")).toBe(true);
    const docs = await db.select().from(generatedDocuments).where(inArray(generatedDocuments.id, rows.map((r) => r.generatedDocumentId!)));
    expect(new Set(docs.map((d) => d.documentNumber)).size).toBe(w.steps.length);
    const weighStep = w.steps.find((s) => s.stepKind === "dispensing")!;
    const weighDoc = docs.find((d) => d.id === rows.find((r) => r.stepNo === weighStep.stepNo)!.generatedDocumentId)!;
    const wdata = (weighDoc.dataset as { data: { page: { weighings?: { materialName: string }[]; outageNote?: string } } }).data.page;
    expect(wdata.weighings?.length).toBe(w.lines.length);
    expect(wdata.outageNote).toMatch(/internet/i);
    const lastDoc = docs.find((d) => d.id === rows.find((r) => r.stepNo === w.steps.at(-1)!.stepNo)!.generatedDocumentId)!;
    expect((lastDoc.dataset as { data: { page: { finishCounts?: { label: string }[] } } }).data.page.finishCounts?.map((c) => c.label)).toContain("Good pieces made");
  });

  it("is one pack per batch: the same key or a second request returns the same pages", async () => {
    const w = await batchWithPack();
    const again = await issuePaperPack(operator, { batchId: w.batchId, idempotencyKey: key() });
    expect(again.packId).toBe(w.pack.packId);
    expect(again.pages.map((p) => p.paperRecordId)).toEqual(w.pack.pages.map((p) => p.paperRecordId));
    expect(await db.select().from(batchPaperRecords).where(eq(batchPaperRecords.batchId, w.batchId))).toHaveLength(w.steps.length);
  });

  it("respects permissions and sites", async () => {
    const { batchId } = await createBatch(manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
    await expectCode(issuePaperPack(warehouse, { batchId, idempotencyKey: key() }), "forbidden");
    await expectCode(issuePaperPack(managerRvs, { batchId, idempotencyKey: key() }), "not_found");
    await issuePaperPack(operator, { batchId, idempotencyKey: key() });
    await expectCode(paperPackForDevice(managerRvs, batchId), "not_found");
    await expectCode(paperPackForDevice(warehouse, batchId), "forbidden");
  });

  it("the device copy is one printable file with every page's DOC number and QR, and no script", async () => {
    const w = await batchWithPack();
    const dev = (await paperPackForDevice(operator, w.batchId))!;
    expect(dev.packId).toBe(w.pack.packId);
    expect(dev.pages).toHaveLength(w.steps.length);
    for (const p of w.pack.pages) expect(dev.html).toContain(`BC:DOC:${p.documentNumber}`);
    expect(dev.html).toContain('data-testid="paper-weighings"');
    expect(dev.html).not.toMatch(/<script/i);
  });

  it("today's and the next batches with a pack are listed for the device, only at the person's sites", async () => {
    const w = await batchWithPack();
    const mine = await upcomingPaperPacks(operator);
    expect(mine.find((b) => b.batchId === w.batchId)?.packId).toBe(w.pack.packId);
    expect((await upcomingPaperPacks(managerRvs)).some((b) => b.batchId === w.batchId)).toBe(false);
  });

  it("unused pages block the QA decision until a person says the paper record was not used; pages with entries stay", async () => {
    const w = await batchWithPack();
    await clearanceFromPaper(w);
    expect((await paperRecordBlockers(db, w.batchId)).length).toBe(w.steps.length);
    await expectCode(voidPaperPage(manager, { paperRecordId: w.page(1), reason: "Not needed after all" }), "state");
    await expectCode(voidUnusedPackPages(manager, { batchId: w.batchId, reason: "no" }), "validation");
    const r = await voidUnusedPackPages(manager, { batchId: w.batchId, reason: "The system worked; the paper record was not used." });
    expect(r.voided).toBe(w.steps.length - 1);
    const left = await paperRecordBlockers(db, w.batchId);
    expect(left).toHaveLength(1);
    expect(left[0].message).toContain(w.pack.pages[0].reference);
  });
});

describe("ADR-134 slice 2: enter from the paper record", () => {
  it("a step typed from paper keeps the paper time, who did it and who checked it, and is marked from paper", async () => {
    const w = await batchWithPack();
    const occurredAt = minutesAgo(3);
    const s1 = w.steps[0];
    // Wrong page: the page of another step.
    await expectCode(
      enterStepFromPaper(operator, { batchId: w.batchId, stepNo: s1.stepNo, paper: { paperRecordId: w.page(2), occurredAt, doneById: operator.userId, checkedById: checker.userId }, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: key() }),
      "validation",
    );
    // A time in the future, or long before the page was printed, is refused.
    for (const t of [new Date(Date.now() + 60 * 60_000).toISOString(), minutesAgo(120)]) {
      await expectCode(
        enterStepFromPaper(operator, { batchId: w.batchId, stepNo: s1.stepNo, paper: { paperRecordId: w.page(1), occurredAt: t, doneById: operator.userId, checkedById: checker.userId }, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: key() }),
        "validation",
      );
    }
    // The checker named on paper must be another person.
    await expectCode(
      enterStepFromPaper(operator, { batchId: w.batchId, stepNo: s1.stepNo, paper: { paperRecordId: w.page(1), occurredAt, doneById: operator.userId, checkedById: operator.userId }, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: key() }),
      "separation_of_duties",
    );
    // A person who may not do the step cannot be named as the one who did it.
    const whId = warehouse.userId;
    await expectCode(
      enterStepFromPaper(operator, { batchId: w.batchId, stepNo: s1.stepNo, paper: { paperRecordId: w.page(1), occurredAt, doneById: whId, checkedById: checker.userId }, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: key() }),
      "validation",
    );
    const k = key();
    const input = { batchId: w.batchId, stepNo: s1.stepNo, paper: { paperRecordId: w.page(1), occurredAt, doneById: operator.userId, checkedById: checker.userId }, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })), idempotencyKey: k };
    const r = await enterStepFromPaper(checker, input);
    expect(r.status).toBe("completed");
    expect((await enterStepFromPaper(checker, input)).status).toBe("completed"); // a repeat changes nothing
    const [rec] = await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, w.batchId), eq(processStepRecords.stepNo, s1.stepNo)));
    expect(rec).toMatchObject({ entrySource: "paper", paperRecordId: w.page(1), conductedBy: operator.userId, checkedBy: checker.userId, enteredBy: checker.userId, status: "completed" });
    expect(rec.occurredAt?.toISOString()).toBe(occurredAt);
    expect(rec.completedAt?.toISOString()).toBe(occurredAt);
    expect((await db.select().from(batches).where(eq(batches.id, w.batchId)))[0].status).toBe("in_process");
    const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rec.id), eq(auditEvents.action, "production.process_step_record.completed")));
    expect(au.after).toMatchObject({ fromPaper: true, paperReference: w.pack.pages[0].reference, occurredAt, doneBy: operator.displayName, checkedBy: checker.displayName });
    // The batch record shows it as from paper, with the paper's time and who typed it.
    const ex = await getBatchExecution(operator, w.batchId);
    expect(ex.steps.find((x) => x.stepNo === s1.stepNo)?.record).toMatchObject({ fromPaper: true, enteredBy: checker.displayName, conductedBy: operator.displayName });
  });

  it("weighing on paper needs the outage reason and the setting; the stock move keeps the paper time", async () => {
    const w = await batchWithPack();
    await clearanceFromPaper(w);
    await setSetting("production.post_consumption_at_dispense", true);
    try {
      const line = w.lines[0];
      const lot = await lotBySupplierLot(SOAP_LOTS[line.code]);
      const occurredAt = minutesAgo(2);
      const base = { batchId: w.batchId, batchMaterialId: line.bm.id, lotRef: lot.lotNumber, qty: new Decimal(line.bm.theoreticalQtyG).toDecimalPlaces(3).toString(), uom: "g", equipmentRef: "SC-01" };
      const paper = { paperRecordId: w.page(2), occurredAt, doneById: operator.userId, checkedById: checker.userId };
      // Weighing is never "paper only": typing it from paper needs the reason.
      const e = await expectCode(enterWeighingFromPaper(checker, { ...base, paper, idempotencyKey: key() }), "validation");
      expect(e.details?.field).toBe("outageReason");
      await setSetting("production.paper.outage_entry_allowed", false);
      await expectCode(enterWeighingFromPaper(checker, { ...base, paper: { ...paper, outageReason: "no_internet" }, idempotencyKey: key() }), "state");
      await setSetting("production.paper.outage_entry_allowed", undefined);
      // Other site, other role.
      await expectCode(enterWeighingFromPaper(operatorRvs, { ...base, paper: { ...paper, outageReason: "no_internet" }, idempotencyKey: key() }), "not_found");
      await expectCode(enterWeighingFromPaper(warehouse, { ...base, paper: { ...paper, outageReason: "no_internet" }, idempotencyKey: key() }), "forbidden");

      const k = key();
      const r = await enterWeighingFromPaper(checker, { ...base, paper: { ...paper, outageReason: "no_internet" }, idempotencyKey: k });
      const again = await enterWeighingFromPaper(checker, { ...base, paper: { ...paper, outageReason: "no_internet" }, idempotencyKey: k });
      expect(again.dispenseRecordId).toBe(r.dispenseRecordId);
      const [rec] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, line.bm.id));
      expect(rec).toMatchObject({ entrySource: "paper", operatorId: operator.userId, checkerId: checker.userId, enteredBy: checker.userId, paperRecordId: w.page(2), outageReason: "No internet at the time" });
      expect(rec.occurredAt?.toISOString()).toBe(occurredAt);
      expect(rec.checkedAt?.toISOString()).toBe(occurredAt);
      const [mv] = await db.select().from(stockMovements).where(eq(stockMovements.idempotencyKey, `dispense:${rec.id}`));
      expect(mv.movementType).toBe("consumption");
      expect(mv.meta).toMatchObject({ fromPaper: true, occurredAt, paperReference: w.pack.pages[1].reference });
      expect(mv.postedAt.getTime()).toBeGreaterThan(new Date(occurredAt).getTime());
      const [au] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rec.id), eq(auditEvents.action, "production.dispense_record.recorded")));
      expect(au.after).toMatchObject({ fromPaper: true, occurredAt, lotConfirmed: "paper", outageReason: "No internet at the time", doneBy: operator.displayName, checkedBy: checker.displayName });
    } finally {
      await setSetting("production.post_consumption_at_dispense", undefined);
      await setSetting("production.paper.outage_entry_allowed", undefined);
    }
  });

  it("an out-of-tolerance weight from paper is recorded as a problem for QA (deviation), never silently accepted", async () => {
    const w = await batchWithPack();
    await clearanceFromPaper(w);
    const line = w.lines[1];
    const lot = await lotBySupplierLot(SOAP_LOTS[line.code]);
    const far = new Decimal(line.bm.theoreticalQtyG).mul("1.5").toDecimalPlaces(3).toString();
    const r = await enterWeighingFromPaper(operator, {
      batchId: w.batchId,
      batchMaterialId: line.bm.id,
      lotRef: lot.lotNumber,
      qty: far,
      uom: "g",
      equipmentRef: "SC-01",
      paper: { paperRecordId: w.page(2), occurredAt: minutesAgo(1), doneById: operator.userId, checkedById: checker.userId, outageReason: "no_internet" },
      idempotencyKey: key(),
    });
    expect(r).toMatchObject({ withinTolerance: false, status: "exception" });
    const [rec] = await db.select().from(dispenseRecords).where(eq(dispenseRecords.id, r.dispenseRecordId));
    expect(rec.isWithinTolerance).toBe(false);
    expect(rec.deviationId).toBeTruthy();
    expect(rec.exceptionApprovedBy).toBeNull();
    const [dev] = await db.select().from(deviations).where(eq(deviations.id, rec.deviationId!));
    expect(dev.batchId).toBe(w.batchId);
    expect(dev.description).toMatch(/paper/i);
  });

  it("a lot that is not released is not used: the line is refused and QA is told", async () => {
    const w = await batchWithPack();
    await clearanceFromPaper(w);
    const line = w.lines[0];
    const held = await makeLot(manager, kit.nfd.id, (await loc(kit.nfd.id, "A-01")).id, "50000", { materialCode: line.code, status: "quarantine" });
    const e = await expectCode(
      enterWeighingFromPaper(operator, {
        batchId: w.batchId,
        batchMaterialId: line.bm.id,
        lotRef: held.lotNumber,
        qty: new Decimal(line.bm.theoreticalQtyG).toDecimalPlaces(3).toString(),
        uom: "g",
        equipmentRef: "SC-01",
        offPlanReasonCode: "other",
        offPlanNote: "Lot written on the paper record",
        paper: { paperRecordId: w.page(2), occurredAt: minutesAgo(1), doneById: operator.userId, checkedById: checker.userId, outageReason: "no_internet" },
        idempotencyKey: key(),
      }),
      "blocked_lot",
    );
    expect(e.details?.deviationNumber).toBeTruthy();
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, line.bm.id))).toHaveLength(0);
    const devs = await db.select().from(deviations).where(eq(deviations.batchId, w.batchId));
    expect(devs.some((d) => d.description.includes(held.lotNumber))).toBe(true);
  });

  it("the review of a paper page needs a person who typed none of it", async () => {
    const w = await batchWithPack();
    await enterStepFromPaper(checker, {
      batchId: w.batchId,
      stepNo: 1,
      paper: { paperRecordId: w.page(1), occurredAt: minutesAgo(3), doneById: operator.userId, checkedById: checker.userId },
      answers: (w.steps[0].checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })),
      idempotencyKey: key(),
    });
    // The operator scans and attaches the page; the checker typed it, so the checker may not review it.
    await attachPaperScan(operator, { paperRecordId: w.page(1), fileName: "p1.pdf", declaredType: "application/pdf", bytes: PDF, idempotencyKey: key() });
    await expectCode(reviewPaperRecord(checker, { paperRecordId: w.page(1), decision: "confirm" }), "separation_of_duties");
    await reviewPaperRecord(qa, { paperRecordId: w.page(1), decision: "confirm", note: "Matches the page" });
    // A reviewed page takes no more lines.
    await expectCode(
      enterStepFromPaper(checker, { batchId: w.batchId, stepNo: 1, paper: { paperRecordId: w.page(1), occurredAt: minutesAgo(1), doneById: operator.userId }, answers: [], idempotencyKey: key() }),
      "state",
    );
  });

  it("the entry screen lists the pack's pages in paper order with what is still to type", async () => {
    const w = await batchWithPack();
    const v = await paperEntryView(operator, w.batchId);
    expect(v.pages.map((p) => p.stepNo)).toEqual(w.steps.map((s) => s.stepNo));
    expect(v.pages[1].weighings.length).toBe(w.lines.length);
    expect(v.people.doers.some((p) => p.id === operator.userId)).toBe(true);
    expect(v.outageAllowed).toBe(true);
    await expectCode(paperEntryView(managerRvs, w.batchId), "not_found");
  });
});
