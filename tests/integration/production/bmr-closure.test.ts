import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  batchAmendments,
  batchClosures,
  batchPaperRecords,
  batchReopenRequests,
  batches,
  documentTemplateVersions,
  documentTemplates,
  generatedDocuments,
  inventoryLots,
  notifications,
  routingSteps,
  stockReservations,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import {
  approveVersion,
  bmrContentHash,
  createDraftVersion,
  createTemplate,
  defaultBmrDefinition,
  findDocumentByNumber,
  renderForDisplay,
  reprintDocument,
  submitVersion,
  updateDraftDefinition,
} from "@/modules/documents";
import {
  attachPaperScan,
  bmrPrintView,
  closeBatch,
  decideReopen,
  generateBmr,
  getClosureView,
  issuePaperPage,
  paperRecordBlockers,
  recordAmendment,
  requestReopen,
  reviewPaperRecord,
  voidPaperPage,
} from "@/modules/production";
import { decideBatch } from "@/modules/quality";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";

/**
 * Wave 2 W2D — BMR template engine, generation and controlled reprint, batch closure and
 * controlled reopen/amend, hybrid paper pages (US-3-17 … US-3-20).
 */

let kit: Kit;
let manager: AuthContext;
let managerRvs: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let warehouse: AuthContext;
let auditor: AuthContext;
let released1: typeof batches.$inferSelect;
let released2: typeof batches.$inferSelect;
let awaiting: typeof batches.$inferSelect;
let inProcess: typeof batches.$inferSelect;
let storageDir: string;
const savedEnv = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };
const PDF = Uint8Array.from(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"));

const key = () => randomUUID();
const doc = async (id: string) => (await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, id)))[0];
const batch = async (id: string) => (await db.select().from(batches).where(eq(batches.id, id)))[0];

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  storageDir = mkdtempSync(path.join(tmpdir(), "bc-w2d-"));
  process.env.FILE_STORAGE = "local";
  process.env.FILE_STORAGE_DIR = storageDir;
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  const all = await db.select().from(batches).orderBy(asc(batches.createdAt));
  [released1, released2] = all.filter((b) => b.status === "released");
  awaiting = all.find((b) => b.status === "awaiting_qc")!;
  inProcess = all.find((b) => b.status === "in_process")!;
}, 180_000);

afterAll(() => {
  process.env.FILE_STORAGE = savedEnv.FILE_STORAGE;
  process.env.FILE_STORAGE_DIR = savedEnv.FILE_STORAGE_DIR;
});

describe("US-3-17 BMR template engine", () => {
  it("creates a bmr template from the renderer default and refuses definitions without C, E, H or J", async () => {
    const r = await createTemplate(manager, { code: "BMR-LOTION-T", name: "Lotion BMR (test)", templateKind: "bmr" });
    const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, r.versionId));
    const def = v.definition as ReturnType<typeof defaultBmrDefinition>;
    expect(def.renderer).toEqual({ id: "bmr", version: 1 });
    for (const required of ["materials", "checklist", "qc", "disposition_signatures"]) {
      const bad = { ...def, sections: def.sections.map((s) => (s.id === required ? { ...s, enabled: false } : s)) };
      await expectCode(updateDraftDefinition(manager, v.id, JSON.stringify(bad)), "validation");
      const missing = { ...def, sections: def.sections.filter((s) => s.id !== required) };
      await expectCode(updateDraftDefinition(manager, v.id, JSON.stringify(missing)), "validation");
    }
    await expectCode(updateDraftDefinition(manager, v.id, JSON.stringify({ ...def, sections: [...def.sections, { id: "free_html", enabled: true }] })), "validation");
    await expectCode(updateDraftDefinition(manager, v.id, JSON.stringify({ ...def, renderer: { id: "bmr", version: 9 } })), "validation");
    // A-RPT-22: production documents never print formula percentages.
    await expectCode(updateDraftDefinition(manager, v.id, JSON.stringify({ ...def, options: { ...def.options, print_percentages: true } })), "validation");
    // A lotion route needs no code: switching optional sections off is fine.
    const lean = { ...def, sections: def.sections.map((s) => (s.id === "equipment" ? { ...s, enabled: false } : s)) };
    expect((await updateDraftDefinition(manager, v.id, JSON.stringify(lean))).checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses approval of a submitted definition that disables a required section", async () => {
    const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "BMR-LOTION-T"));
    const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    await submitVersion(manager, v.id);
    const def = v.definition as ReturnType<typeof defaultBmrDefinition>;
    const tampered = { ...def, sections: def.sections.map((s) => (s.id === "qc" ? { ...s, enabled: false } : s)) };
    await db.update(documentTemplateVersions).set({ definition: tampered }).where(eq(documentTemplateVersions.id, v.id));
    await expectCode(approveVersion(qa, v.id), "validation");
  });

  it("the renderer is pure: no database, ORM or clock access (batch.snapshot.renderer_reads_snapshot_only, static)", () => {
    for (const f of ["bmr-v1.ts", "bmr-data.ts", "bmr-paper-page-v1.ts", "bmr-logo.ts"]) {
      const src = readFileSync(path.join("src/modules/documents/renderers", f), "utf8");
      expect(src, f).not.toMatch(/from "@\/db|drizzle-orm|server-only|new Date\(|Date\.now/);
    }
    const builder = readFileSync("src/modules/production/bmr.ts", "utf8");
    // Material names, INCI and phases come from the batch snapshot, never the live materials table.
    expect(builder).not.toMatch(/\bmaterials\b,\n/);
    expect(builder).toMatch(/snap\.lines\.find/);
  });

  it("the logo markup matches the brand component geometry", () => {
    const brand = readFileSync("src/ui/brand.tsx", "utf8");
    const logo = readFileSync("src/modules/documents/renderers/bmr-logo.ts", "utf8");
    for (const frag of ['x="174" y="20" width="136" height="50" rx="25"', 'cx="20" cy="3.2" r="2.4"', "Beauty and Wellness From Nature"]) {
      expect(brand).toContain(frag);
      expect(logo).toContain(frag);
    }
  });
});

describe("US-3-18 BMR generation, watermarks, QR and controlled reprint", () => {
  let firstId: string;

  it("shows a live preview with the paper layout before anything is generated", async () => {
    const v = await bmrPrintView(manager, released1.id);
    expect(v.current).toBeNull();
    expect(v.stale).toBe(true);
    expect(v.template?.code).toBe("BMR-STD");
    expect(v.preview?.body).toContain("BATCH MANUFACTURING RECORD");
    expect(v.preview?.body).toContain("PREVIEW");
  });

  it("generates a numbered, hashed BMR with page identity, watermark, logo and BC:DOC QR", async () => {
    const r = await generateBmr(manager, { batchId: released1.id, idempotencyKey: key() });
    expect(r.generated).toBe(true);
    expect(r.documentNumber).toMatch(/^DOC-\d{2}-\d{7}$/);
    const d = await doc(r.documentId);
    firstId = d.id;
    expect(d.status).toBe("ready");
    expect(d.documentKind).toBe("bmr");
    expect(d.sourceEntityType).toBe("batch");
    expect(d.watermark).toBe("FINAL – PENDING CLOSURE");
    expect(d.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    const out = await renderForDisplay(d);
    expect(out.integrity).toBe("ok");
    expect(out.body).toContain(released1.batchNumber);
    expect(out.body).toContain(`data-payload="BC:DOC:${d.documentNumber}"`);
    expect(out.body).toContain("Dispensing and weighing");
    expect(out.body).toContain("Beauty and Wellness From Nature");
    expect(out.body).toContain("Final Disposition:");
    expect(out.body).toContain("Name and Signature of QA:");
    expect(out.css).toContain(`Batch ${released1.batchNumber} · page `);
    expect(out.css).toContain('counter(page) " of " counter(pages)');
    // A-RPT-22: quantities only; the formula's percentages never print.
    expect(out.body).not.toMatch(/% of formula|percent of batch/i);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, d.id), eq(auditEvents.action, "documents.generated_document.generated")));
    expect(au).toHaveLength(1);
  });

  it("returns the current document when nothing changed (no new number)", async () => {
    const r = await generateBmr(manager, { batchId: released1.id, idempotencyKey: key() });
    expect(r.generated).toBe(false);
    expect(r.documentId).toBe(firstId);
  });

  it("scopes generation by site and permission (cross-site and role escalation)", async () => {
    await expectCode(generateBmr(managerRvs, { batchId: released1.id, idempotencyKey: key() }), "not_found");
    await expectCode(generateBmr(auditor, { batchId: released1.id, idempotencyKey: key() }), "forbidden");
    await expectCode(bmrPrintView(managerRvs, released1.id), "not_found");
    const d = await doc(firstId);
    expect(await findDocumentByNumber(managerRvs, d.documentNumber)).toBeNull();
    expect((await findDocumentByNumber(auditor, d.documentNumber))?.id).toBe(d.id);
  });

  it("reprint: 422 without a reason; with a reason REPRINT n, same content hash, audit and QA notified", async () => {
    await expectCode(reprintDocument(manager, firstId, { reasonCode: "", idempotencyKey: key() }), "validation");
    await expectCode(reprintDocument(auditor, firstId, { reasonCode: "lost_copy", idempotencyKey: key() }), "forbidden");
    const r = await reprintDocument(manager, firstId, { reasonCode: "lost_copy", idempotencyKey: key() });
    const rp = await doc(r.id);
    const orig = await doc(firstId);
    expect(rp.reprintNo).toBe(1);
    expect(rp.watermark).toBe("REPRINT 1");
    expect(rp.recordRevisionNo).toBe(orig.recordRevisionNo);
    const contentOf = (x: typeof rp) => bmrContentHash((x.dataset as { data: unknown }).data);
    expect(contentOf(rp)).toBe(contentOf(orig));
    const out = await renderForDisplay(rp);
    expect(out.body).toContain(`REPRINT 1 of ${orig.documentNumber}`);
    expect(out.body).toContain(`content ${contentOf(orig)}`);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, rp.id), eq(auditEvents.action, "documents.generated_document.reprinted")));
    expect(au).toHaveLength(1);
    const n = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, qa.userId), eq(notifications.entityId, rp.id)));
    expect(n).toHaveLength(1);
  });

  it("keeps the template version of the batch's first BMR after a newer version is approved (T-10)", async () => {
    const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "BMR-STD"));
    const [v1] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    const d2 = await createDraftVersion(manager, t.id, "Wording change");
    const def = { ...(v1.definition as ReturnType<typeof defaultBmrDefinition>) };
    await updateDraftDefinition(manager, d2.versionId, JSON.stringify({ ...def, header: { ...def.header!, title: "BATCH MANUFACTURING RECORD (V2)" } }));
    await submitVersion(manager, d2.versionId);
    await approveVersion(qa, d2.versionId);
    // released1 is pinned to v1 by its first BMR; released2 has none yet and was created while v1 was effective.
    const view1 = await bmrPrintView(manager, released1.id);
    expect(view1.template?.versionNo).toBe(1);
    const view2 = await bmrPrintView(manager, released2.id);
    expect(view2.template?.versionNo).toBe(1);
  });
});

describe("US-3-19 batch closure and controlled reopen/amend", () => {
  let reopenId: string;

  it("refuses closure without production.batch.approve (role escalation) and outside the user's sites", async () => {
    await expectCode(closeBatch(operator, { batchId: released1.id, idempotencyKey: key() }), "forbidden");
    await expectCode(closeBatch(qa, { batchId: released1.id, idempotencyKey: key() }), "forbidden");
    await expectCode(closeBatch(managerRvs, { batchId: released1.id, idempotencyKey: key() }), "not_found");
  });

  it("409 with the blocking items listed for a batch that is not decided", async () => {
    const e = await expectCode(closeBatch(manager, { batchId: inProcess.id, idempotencyKey: key() }), "state");
    const blockers = (e.details?.blockers ?? []) as { code: string }[];
    expect(blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["state", "disposition"]));
  });

  it("an unreviewed paper page blocks closure; voiding it unblocks", async () => {
    const p = await issuePaperPage(operator, { batchId: released1.id, stepNo: 4, idempotencyKey: key() });
    const e = await expectCode(closeBatch(manager, { batchId: released1.id, idempotencyKey: key() }), "state");
    expect((e.details?.blockers as { code: string }[]).map((b) => b.code)).toContain("paper_records");
    await voidPaperPage(operator, { paperRecordId: p.paperRecordId, reason: "Printed twice by mistake" });
  });

  it("closes: CONTROLLED COPY generated, previous BMR superseded, reservations released, audit written", async () => {
    const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, kit.nfd.id), eq(inventoryLots.qualityStatus, "released"), eq(inventoryLots.itemKind, "material"))).limit(1);
    const where = await loc(kit.nfd.id, "A-01");
    await db.insert(stockReservations).values({ organizationId: kit.orgId, siteId: kit.nfd.id, reservationNumber: `RSV-T-${Date.now()}`, lotId: lot.id, locationId: where.id, qtyBase: "1", baseUom: lot.baseUom, demandType: "batch", demandId: released1.id, demandReference: released1.batchNumber, status: "active", createdBy: manager.userId });
    const before = (await bmrPrintView(manager, released1.id)).current!;
    const k = key();
    const r = await closeBatch(manager, { batchId: released1.id, note: "Record complete", idempotencyKey: k });
    expect(r.watermark).toBe("CONTROLLED COPY");
    expect(r.reservationsReleased).toBe(1);
    expect((await batch(released1.id)).status).toBe("closed");
    expect((await doc(before.id)).status).toBe("superseded");
    const closed = await doc(r.documentId);
    expect(closed.watermark).toBe("CONTROLLED COPY");
    expect(closed.recordRevisionNo).toBe(before.recordRevisionNo + 1);
    const [c] = await db.select().from(batchClosures).where(eq(batchClosures.batchId, released1.id));
    expect(c.closureNo).toBe(1);
    expect(c.generatedDocumentId).toBe(r.documentId);
    const rs = await db.select().from(stockReservations).where(eq(stockReservations.demandId, released1.id));
    expect(rs.every((x) => x.status === "released")).toBe(true);
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, released1.id), eq(auditEvents.action, "production.batch.closed")));
    expect(au).toHaveLength(1);
    // Replay with the same key returns the same result without a second closure.
    const again = await closeBatch(manager, { batchId: released1.id, note: "Record complete", idempotencyKey: k });
    expect(again.documentId).toBe(r.documentId);
    await expectCode(closeBatch(manager, { batchId: released1.id, idempotencyKey: key() }), "state");
  });

  it("closures are append-only in the database", async () => {
    await expect(db.update(batchClosures).set({ note: "edited" }).where(eq(batchClosures.batchId, released1.id))).rejects.toThrow();
  });

  it("amendments are refused while the batch is closed", async () => {
    await expectCode(recordAmendment(manager, { batchId: released1.id, section: "remarks", reference: "Remarks", previousValue: "—", correctedValue: "x", reason: "Typo fix", idempotencyKey: key() }), "state");
  });

  it("reopen needs production.batch.admin, a reason and two approvals by different people (production.reopen_requires_two_approvals)", async () => {
    await expectCode(requestReopen(operator, { batchId: released1.id, targetState: "released", reason: "Wrong reading recorded on step 4", amendmentScope: "Step 4 reading", idempotencyKey: key() }), "forbidden");
    await expectCode(requestReopen(qa, { batchId: released1.id, targetState: "released", reason: "Wrong reading recorded on step 4", amendmentScope: "Step 4 reading", idempotencyKey: key() }), "forbidden");
    await expectCode(requestReopen(managerRvs, { batchId: released1.id, targetState: "released", reason: "Wrong reading recorded on step 4", amendmentScope: "Step 4 reading", idempotencyKey: key() }), "not_found");
    await expectCode(requestReopen(manager, { batchId: released1.id, targetState: "released", reason: "short", amendmentScope: "Step 4 reading", idempotencyKey: key() }), "validation");
    await expectCode(requestReopen(manager, { batchId: released1.id, targetState: "rejected", reason: "Wrong reading recorded on step 4", amendmentScope: "Step 4 reading", idempotencyKey: key() }), "validation");

    const r = await requestReopen(manager, { batchId: released1.id, targetState: "released", reason: "Wrong reading recorded on step 4", amendmentScope: "Step 4 reading", idempotencyKey: key() });
    reopenId = r.requestId;
    expect(r.nextStep?.label).toBe("QA co-approval");
    expect((await batch(released1.id)).status).toBe("closed");
    await expectCode(requestReopen(manager, { batchId: released1.id, targetState: "released", reason: "Second request for the same batch", amendmentScope: "Anything", idempotencyKey: key() }), "conflict");
    // The requester cannot co-approve; an operator cannot either.
    await expectCode(decideReopen(manager, { requestId: reopenId, decision: "approved" }), "forbidden");
    await expectCode(decideReopen(operator, { requestId: reopenId, decision: "approved" }), "forbidden");
    expect((await batch(released1.id)).status).toBe("closed");
  });

  it("QA co-approval executes the reopen, keeps revision ids and the snapshot (batch.snapshot.reopen_keeps_revisions)", async () => {
    const before = await batch(released1.id);
    const r = await decideReopen(qa, { requestId: reopenId, decision: "approved", note: "Agreed" });
    expect(r).toMatchObject({ status: "reopened", reopenNo: 1, targetState: "released" });
    const after = await batch(released1.id);
    expect(after.status).toBe("released");
    expect(after.formulaRevisionId).toBe(before.formulaRevisionId);
    expect(after.routingRevisionId).toBe(before.routingRevisionId);
    expect(after.formulaSnapshot).toEqual(before.formulaSnapshot);
    const [req] = await db.select().from(batchReopenRequests).where(eq(batchReopenRequests.id, reopenId));
    expect(req.status).toBe("reopened");
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, released1.id), eq(auditEvents.action, "production.batch.reopened")));
    expect(au).toHaveLength(1);
    await expectCode(decideReopen(qa, { requestId: reopenId, decision: "approved" }), "state");
  });

  it("amendments are append-only with the previous value and a reason", async () => {
    await expectCode(recordAmendment(warehouse, { batchId: released1.id, section: "process_steps", reference: "Step 4 reading", previousValue: "48 °C", correctedValue: "46 °C", reason: "Transcription error", idempotencyKey: key() }), "forbidden");
    await expectCode(recordAmendment(manager, { batchId: released1.id, section: "process_steps", reference: "Step 4 reading", previousValue: "48 °C", correctedValue: "46 °C", reason: "x", idempotencyKey: key() }), "validation");
    const a1 = await recordAmendment(manager, { batchId: released1.id, section: "process_steps", reference: "Step 4 reading", previousValue: "Mix temp 48 °C", correctedValue: "Mix temp 46 °C", reason: "Transcription error from the thermometer log", idempotencyKey: key() });
    const a2 = await recordAmendment(qa, { batchId: released1.id, section: "process_steps", reference: "Step 4 reading", previousValue: "Mix temp 46 °C", correctedValue: "Mix temp 47 °C", reason: "Checked against the original log again", supersedesId: a1.amendmentId, idempotencyKey: key() });
    expect(a2.amendmentNo).toBe(a1.amendmentNo + 1);
    await expectCode(recordAmendment(manager, { batchId: released1.id, section: "process_steps", reference: "Step 4", previousValue: "a", correctedValue: "b", reason: "Second correction of A1", supersedesId: a1.amendmentId, idempotencyKey: key() }), "conflict");
    await expect(db.update(batchAmendments).set({ correctedValue: "tampered" }).where(eq(batchAmendments.id, a1.amendmentId))).rejects.toThrow();
    await expect(db.delete(batchAmendments).where(eq(batchAmendments.id, a1.amendmentId))).rejects.toThrow();
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, released1.id), eq(auditEvents.action, "production.batch.amended")));
    expect(au).toHaveLength(2);
  });

  it("closing again regenerates the BMR as AMENDED rev 1 with the amendments and supersedes the controlled copy", async () => {
    const [c1] = await db.select().from(batchClosures).where(eq(batchClosures.batchId, released1.id));
    const r = await closeBatch(manager, { batchId: released1.id, idempotencyKey: key() });
    expect(r.watermark).toBe("AMENDED rev 1");
    expect((await doc(c1.generatedDocumentId)).status).toBe("superseded");
    const d = await doc(r.documentId);
    const out = await renderForDisplay(d);
    expect(out.body).toContain("Mix temp 47 °C");
    expect(out.body).toContain("superseded by a later amendment");
    expect(out.body).toContain("Reopen 1");
    const closures = await db.select().from(batchClosures).where(eq(batchClosures.batchId, released1.id));
    expect(closures.map((c) => c.closureNo).sort()).toEqual([1, 2]);
    const view = await getClosureView(manager, released1.id);
    expect(view.reopenCount).toBe(1);
    expect(view.closures).toHaveLength(2);
  });

  it("a rejected reopen leaves the batch closed", async () => {
    const r = await requestReopen(manager, { batchId: released1.id, targetState: "quarantined", reason: "QA wants to re-check a result", amendmentScope: "QC results", idempotencyKey: key() });
    await expectCode(decideReopen(qa, { requestId: r.requestId, decision: "rejected" }), "validation");
    expect(await decideReopen(qa, { requestId: r.requestId, decision: "rejected", note: "Not needed; result is on file" })).toEqual({ status: "rejected" });
    expect((await batch(released1.id)).status).toBe("closed");
    await expect(db.update(batchReopenRequests).set({ reason: "tampered reason text" }).where(eq(batchReopenRequests.id, r.requestId))).rejects.toThrow();
  });
});

describe("US-3-20 hybrid paper record pages", () => {
  let pageId: string;

  it("issues a numbered blank page as a document for a step; outsiders and wrong roles are refused", async () => {
    await expectCode(issuePaperPage(warehouse, { batchId: awaiting.id, stepNo: 4, idempotencyKey: key() }), "forbidden");
    await expectCode(issuePaperPage(managerRvs, { batchId: awaiting.id, stepNo: 4, idempotencyKey: key() }), "not_found");
    await expectCode(issuePaperPage(operator, { batchId: awaiting.id, stepNo: 99, idempotencyKey: key() }), "validation");
    const k = key();
    const p = await issuePaperPage(operator, { batchId: awaiting.id, stepNo: 4, idempotencyKey: k });
    pageId = p.paperRecordId;
    expect(p.reference).toBe(`${awaiting.batchNumber}-P01`);
    expect((await issuePaperPage(operator, { batchId: awaiting.id, stepNo: 4, idempotencyKey: k })).paperRecordId).toBe(pageId);
    const d = await doc(p.documentId!);
    expect(d.documentKind).toBe("bmr_paper_page");
    const out = await renderForDisplay(d);
    expect(out.integrity).toBe("ok");
    expect(out.body).toContain(p.reference);
    expect(out.body).toContain("Transcription reviewed by");
  });

  it("the batch cannot leave awaiting_qc while the page is not reviewed (409)", async () => {
    const e = await expectCode(decideBatch(qa, { batchId: awaiting.id, decision: "release", reason: "All results within specification" }), "state");
    expect(e.message).toContain("-P01");
  });

  it("attach by the transcriber; the transcriber cannot review; a different checker confirms", async () => {
    await expectCode(attachPaperScan(warehouse, { paperRecordId: pageId, fileName: "p1.pdf", declaredType: "application/pdf", bytes: PDF, idempotencyKey: key() }), "forbidden");
    await attachPaperScan(operator, { paperRecordId: pageId, fileName: "page-1.pdf", declaredType: "application/pdf", bytes: PDF, transcriptionNote: "Readings entered on step 4", idempotencyKey: key() });
    const [p] = await db.select().from(batchPaperRecords).where(eq(batchPaperRecords.id, pageId));
    expect(p.status).toBe("attached");
    expect(p.transcribedBy).toBe(operator.userId);
    await expectCode(reviewPaperRecord(operator, { paperRecordId: pageId, decision: "confirm" }), "separation_of_duties");
    await expectCode(reviewPaperRecord(warehouse, { paperRecordId: pageId, decision: "confirm" }), "forbidden");
    await expectCode(reviewPaperRecord(checker, { paperRecordId: pageId, decision: "return" }), "validation");
    await reviewPaperRecord(checker, { paperRecordId: pageId, decision: "return", note: "Time of reading 2 differs" });
    await attachPaperScan(operator, { paperRecordId: pageId, fileName: "page-1b.pdf", declaredType: "application/pdf", bytes: PDF, idempotencyKey: key() });
    await reviewPaperRecord(checker, { paperRecordId: pageId, decision: "confirm", note: "Matches" });
    expect(await paperRecordBlockers(db, awaiting.id)).toEqual([]);
    await expect(db.update(batchPaperRecords).set({ reviewNote: "tampered" }).where(eq(batchPaperRecords.id, pageId))).rejects.toThrow();
    const au = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, pageId), eq(auditEvents.action, "production.batch_paper_record.reviewed")));
    expect(au).toHaveLength(1);
  });

  it("a paper_then_transcribe step without a reviewed page blocks; dispensing can never be paper_only", async () => {
    const snap = awaiting.formulaSnapshot as { steps: { routingStepId: string; stepNo: number; stepKind: string }[] };
    const step6 = snap.steps.find((s) => s.stepNo === 6)!;
    const dispensing = snap.steps.find((s) => s.stepKind === "dispensing" || s.stepKind === "weighing");
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`); // fixture only: bypass the W1D revision-freeze trigger
      await tx.update(routingSteps).set({ recordMode: "paper_then_transcribe" }).where(eq(routingSteps.id, step6.routingStepId));
    });
    const blockers = await paperRecordBlockers(db, awaiting.id);
    expect(blockers.map((b) => b.code)).toEqual(["paper_missing"]);
    if (dispensing) {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local session_replication_role = replica`);
          await tx.update(routingSteps).set({ recordMode: "paper_only" }).where(eq(routingSteps.id, dispensing.routingStepId));
        }),
      ).rejects.toThrow();
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.update(routingSteps).set({ recordMode: "electronic" }).where(eq(routingSteps.id, step6.routingStepId));
    });
  });

  it("the BMR lists the paper pages with their hashes (section L)", async () => {
    const r = await generateBmr(qa, { batchId: awaiting.id, idempotencyKey: key() });
    const d = await doc(r.documentId);
    expect(d.watermark).toBe("UNDER QA REVIEW");
    const out = await renderForDisplay(d);
    expect(out.body).toContain(`${awaiting.batchNumber}-P01`);
    expect(out.body).toContain("page-1b.pdf");
  });

  it("QA can release once every page is reviewed", async () => {
    await decideBatch(qa, { batchId: awaiting.id, decision: "release", reason: "All results within specification; BMR and paper page reviewed." });
    expect((await batch(awaiting.id)).status).toBe("released");
  });
});

describe("W2D custom SQL", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w2d.sql (no drift)", () => {
    expect(readFileSync("src/db/migrations/0004_w2d_custom_sql.sql", "utf8")).toBe(readFileSync("src/db/sql/w2d.sql", "utf8"));
  });
});

describe("contract sections from other Wave 2 streams", () => {
  it("prints 'not captured electronically' for sources whose tables are absent, never 'none'", async () => {
    const [d] = await db
      .select()
      .from(generatedDocuments)
      .where(and(eq(generatedDocuments.sourceEntityId, awaiting.id), eq(generatedDocuments.documentKind, "bmr")))
      .orderBy(desc(generatedDocuments.generatedAt))
      .limit(1);
    const data = (d.dataset as { data: { deviations: { available: boolean }; lineClearance: { available: boolean } } }).data;
    const hasTable = async (t: string) => ((await db.execute(sql`select to_regclass(${"public." + t}) as r`)) as unknown as { r: string | null }[])[0].r !== null;
    expect(data.deviations.available).toBe(await hasTable("deviations"));
    expect(data.lineClearance.available).toBe(await hasTable("process_step_checklist_results"));
    if (!data.deviations.available) {
      const out = await renderForDisplay(d);
      expect(out.body).toContain("The deviation register is not captured electronically");
    }
  });
});

void DomainError;
