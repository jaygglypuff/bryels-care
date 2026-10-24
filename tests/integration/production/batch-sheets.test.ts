import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, documentTemplates, generatedDocuments } from "@/db/schema";
import { getGeneratedDocument, renderForDisplay, reprintDocument } from "@/modules/documents";
import { createBatchFromWorkOrder, createWorkOrder, generateBatchSheet, planWorkOrder, releaseWorkOrder, stageMaterial } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { day, expectCode, loadWorld, lotBySupplier, productId, type World } from "./w2a-fixtures";

let w: World;
let batchId: string;

const html = async (id: string) => {
  const d = await getGeneratedDocument(w.warehouse, id);
  const r = await renderForDisplay(d);
  expect(r.integrity).toBe("ok");
  return { d, html: r.html! };
};

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  const wo = await createWorkOrder(w.planner, { productId: await productId("ACS-135"), batchCount: 1, plannedStart: day(1), plannedEnd: day(2) });
  await planWorkOrder(w.planner, wo.workOrderId);
  await releaseWorkOrder(w.manager, wo.workOrderId);
  ({ batchId } = await createBatchFromWorkOrder(w.planner, { workOrderId: wo.workOrderId }));
  await stageMaterial(w.warehouse, { batchId, lotCode: `BC:LOT:${(await lotBySupplier("LOS-24871")).lotNumber}`, toLocationCode: "BC:LOC:PRD-01" });
}, 120_000);

describe("dispensing sheet (US-3-08, FR-documents-09)", () => {
  it("prints expected lots, targets, tolerances and scales, never a lot barcode; NOT STAGED until all staged", async () => {
    const r = await generateBatchSheet(w.warehouse, { batchId, kind: "dispensing_sheet", idempotencyKey: "sheet-key-00000001" });
    expect(r.documentNumber).toMatch(/^DOC-/);
    const { d, html: out } = await html(r.id);
    expect(d.sourceEntityType).toBe("batch");
    expect(d.watermark).toBe("NOT STAGED");
    for (const name of ["Coconut Oil", "Palm Oil", "33.33% Lye Solution", "Acapulco Extract", "6% Green in Oil"]) expect(out).toContain(name);
    expect(out).toContain((await lotBySupplier("LOS-24871")).lotNumber); // staged lot
    expect(out).toContain((await lotBySupplier("LOS-24872")).lotNumber); // reserved lot, not yet staged
    expect(out).toContain("3,723.2 g");
    expect(out).toMatch(/± \d/);
    expect(out).not.toContain("BC:LOT:");
    expect(out).toContain(`BC:DOC:${r.documentNumber}`);
    expect(out).not.toMatch(/\d+(\.\d+)?\s?% of batch/i); // never formula percentages
    const replay = await generateBatchSheet(w.warehouse, { batchId, kind: "dispensing_sheet", idempotencyKey: "sheet-key-00000001" });
    expect(replay.id).toBe(r.id);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.id), eq(auditEvents.action, "documents.generated_document.generated")));
    expect(au).toHaveLength(1);
  });

  it("reprints through the documents module with a reason", async () => {
    const r = await generateBatchSheet(w.warehouse, { batchId, kind: "dispensing_sheet", idempotencyKey: "sheet-key-00000002" });
    const re = await reprintDocument(w.warehouse, r.id, { reasonCode: "lost_copy", note: null, idempotencyKey: "reprint-sheet-0001" });
    const [row] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, re.id));
    expect(row.reprintNo).toBe(1);
    expect(row.watermark).toBe("REPRINT 1");
  });

  it("traveler lists the routing steps of the frozen snapshot", async () => {
    const r = await generateBatchSheet(w.planner, { batchId, kind: "traveler", idempotencyKey: "traveler-key-0001" });
    const { html: out } = await html(r.id);
    expect(out).toMatch(/Line clearance/);
    expect(out).toContain("Weighing");
    expect(out).not.toContain("BC:LOT:");
  });

  it("is scoped to the batch's site and permissions; refuses without an approved template", async () => {
    await expectCode(generateBatchSheet(w.warehouseRvs, { batchId, kind: "dispensing_sheet", idempotencyKey: "sheet-key-rvs-0001" }), "not_found");
    await expectCode(generateBatchSheet(w.sales, { batchId, kind: "dispensing_sheet", idempotencyKey: "sheet-key-sales-001" }), "forbidden");
    await db.update(documentTemplates).set({ isActive: false }).where(eq(documentTemplates.code, "TRAVELER"));
    await expectCode(generateBatchSheet(w.planner, { batchId, kind: "traveler", idempotencyKey: "traveler-key-0002" }), "setup_required");
    await db.update(documentTemplates).set({ isActive: true }).where(eq(documentTemplates.code, "TRAVELER"));
  });
});
