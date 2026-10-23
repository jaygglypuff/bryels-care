import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  documentTemplateVersions,
  documentTemplates,
  generatedDocuments,
  inventoryLots,
  labelJobs,
  labelTemplates,
  locations,
  organizations,
  printStations,
  sites,
  users,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import {
  approveLabelTemplate,
  approveVersion,
  cancelLabelJob,
  createDraftVersion,
  createLabelJob,
  createLabelTemplate,
  createStation,
  createTemplate,
  generateTemplateTestPage,
  getGeneratedDocument,
  labelJobForPrint,
  markLabelJobFailed,
  markLabelJobPrinted,
  reprintDocument,
  reprintLabelJob,
  requestPdfDownload,
  retryLabelJob,
  stationQueue,
  submitVersion,
  updateDraftDefinition,
  voidLabelJob,
} from "@/modules/documents";
import { documentsRenderJob, renderGeneratedDocument } from "@/modules/documents/jobs/render";
import { enqueueJob, runJob } from "@/modules/platform/jobs";
import { decideLot } from "@/modules/quality";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let whNfd: AuthContext;
let whRvs: AuthContext;
let managerNfd: AuthContext;
let qaNfd: AuthContext;
let admin: AuthContext;
let auditor: AuthContext;
let operatorNfd: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function expectDomain(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}
async function lt(code: string) {
  const [t] = await db.select().from(labelTemplates).where(eq(labelTemplates.code, code));
  return t;
}
async function lotAt(siteId: string, status: string, kind = "material") {
  const rows = await db.select().from(inventoryLots).where(and(eq(inventoryLots.siteId, siteId), eq(inventoryLots.qualityStatus, status), eq(inventoryLots.itemKind, kind)));
  return rows;
}
async function lastAudit(action: string, entityId: string) {
  const [a] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId))).orderBy(desc(auditEvents.occurredAt)).limit(1);
  return a;
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  whNfd = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor("warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  managerNfd = await ctxFor("manager.nfd@bryels-care.test", ROLE_BUNDLES.site_manager.permissions, [nfd]);
  qaNfd = await ctxFor("qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  admin = await ctxFor("admin@bryels-care.test", ROLE_BUNDLES.system_admin.permissions, [nfd, rvs]);
  auditor = await ctxFor("auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
  operatorNfd = await ctxFor("operator.nfd@bryels-care.test", ROLE_BUNDLES.production_operator.permissions, [nfd]);
});

describe("document templates (US-2-11 AC1)", () => {
  it("creates a template with a draft v1 and rejects free HTML and unknown renderers", async () => {
    const r = await createTemplate(managerNfd, { code: "TEST-A4-QA", name: "QA test sheet", templateKind: "test_page" });
    const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, r.versionId));
    expect(v.status).toBe("draft");
    expect(v.definitionChecksum).toMatch(/^[0-9a-f]{64}$/);

    const def = v.definition as Record<string, unknown>;
    await expectDomain(updateDraftDefinition(managerNfd, v.id, JSON.stringify({ ...def, html: "<script>alert(1)</script>" })), "validation");
    await expectDomain(updateDraftDefinition(managerNfd, v.id, JSON.stringify({ ...def, header: { show_logo: false, title: "<img src=x onerror=alert(1)>", identity_fields: [] } })), "validation");
    await expectDomain(updateDraftDefinition(managerNfd, v.id, JSON.stringify({ ...def, renderer: { id: "free_html", version: 1 } })), "validation");
    await expectDomain(updateDraftDefinition(managerNfd, v.id, "{not json"), "validation");
    await expectDomain(createTemplate(managerNfd, { code: "BMR-X", name: "BMR", templateKind: "bmr" }), "validation");

    const ok = await updateDraftDefinition(managerNfd, v.id, JSON.stringify({ ...def, header: { show_logo: false, title: "QA PRINTER CHECK", identity_fields: [] } }));
    expect(ok.checksum).not.toBe(v.definitionChecksum);
  });

  it("approval: only a different user with documents.template.approve; the previous version retires", async () => {
    const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "TEST-A4-QA"));
    const [v1] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    await expectDomain(approveVersion(qaNfd, v1.id), "state"); // not submitted yet
    await submitVersion(managerNfd, v1.id);
    await expectDomain(approveVersion(managerNfd, v1.id), "forbidden"); // role escalation: site manager cannot approve
    await expectDomain(approveVersion(whNfd, v1.id), "forbidden");
    await approveVersion(qaNfd, v1.id);
    expect((await lastAudit("documents.template_version.approved", v1.id))?.actorId).toBe(qaNfd.userId);

    const { versionId: v2 } = await createDraftVersion(managerNfd, t.id, "Second version");
    await expectDomain(createDraftVersion(managerNfd, t.id), "state"); // one open draft at a time
    await submitVersion(managerNfd, v2);
    await approveVersion(qaNfd, v2);
    const versions = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    expect(versions.find((x) => x.id === v1.id)?.status).toBe("retired");
    expect(versions.find((x) => x.id === v2)?.status).toBe("approved");
  });

  it("a QA user who submitted a version cannot approve it (separation of duties)", async () => {
    const both = new AuthContext(qaNfd.userId, orgId, qaNfd.displayName, qaNfd.email, ["test"], new Set([...ROLE_BUNDLES.qa_qc.permissions, "documents.template.submit", "documents.template.edit", "documents.template.create"]), [nfd], nfd.id);
    const r = await createTemplate(both, { code: "TEST-A4-SOD", name: "SoD check", templateKind: "test_page" });
    await submitVersion(both, r.versionId);
    await expectDomain(approveVersion(both, r.versionId), "separation_of_duties");
  });
});

describe("generated documents (US-2-11)", () => {
  let docId: string;
  it("documents.hash_recorded: generation allocates DOC, renders from a frozen dataset and records sha256 + audit", async () => {
    const [t] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "TEST-A4"));
    const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id));
    const key = randomUUID();
    const r = await generateTemplateTestPage(managerNfd, v.id, key);
    expect(r.documentNumber).toMatch(/^DOC-\d{2}-\d{7}$/);
    expect((await generateTemplateTestPage(managerNfd, v.id, key)).id).toBe(r.id); // idempotent
    const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, r.id));
    expect(d.status).toBe("ready");
    expect(d.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.pageCount).toBe(1);
    expect(d.recordRevisionNo).toBe(1);
    expect(d.documentTemplateVersionId).toBe(v.id);
    expect((await lastAudit("documents.generated_document.generated", d.id))?.entityNumber).toBe(d.documentNumber);
    const detail = await getGeneratedDocument(managerNfd, d.id);
    expect(detail.chain).toHaveLength(1);
    docId = d.id;
  });

  it("documents.reprint_requires_reason and documents.reprint_audit", async () => {
    await expectDomain(reprintDocument(managerNfd, docId, { reasonCode: "", idempotencyKey: randomUUID() }), "validation");
    await expectDomain(reprintDocument(managerNfd, docId, { reasonCode: "because", idempotencyKey: randomUUID() }), "validation");
    await expectDomain(reprintDocument(managerNfd, docId, { reasonCode: "other", idempotencyKey: randomUUID() }), "validation");
    await expectDomain(reprintDocument(auditor, docId, { reasonCode: "lost_copy", idempotencyKey: randomUUID() }), "forbidden");
    const r = await reprintDocument(managerNfd, docId, { reasonCode: "lost_copy", idempotencyKey: randomUUID() });
    const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, r.id));
    expect(d.reprintOfId).toBe(docId);
    expect(d.reprintNo).toBe(1);
    expect(d.watermark).toBe("REPRINT 1");
    expect(d.reprintReasonCode).toBe("lost_copy");
    const a = await lastAudit("documents.generated_document.reprinted", d.id);
    expect(a?.reason).toContain("lost_copy");
    // Reprinting the reprint still points at the original and counts up.
    const r2 = await reprintDocument(managerNfd, r.id, { reasonCode: "other", note: "Second copy for the auditor", idempotencyKey: randomUUID() });
    const [d2] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, r2.id));
    expect(d2.reprintOfId).toBe(docId);
    expect(d2.reprintNo).toBe(2);
    // The check constraint backs the service: a reprint row without a reason is refused by the database.
    const e = await db
      .update(generatedDocuments)
      .set({ reprintReasonCode: null })
      .where(eq(generatedDocuments.id, d2.id))
      .then(() => null, (x) => x);
    expect(String(e?.cause ?? e)).toMatch(/generated_documents_reprint_ck/);
  });

  it("PDF_RENDERER disabled: download shows the setup-required state, never a fake file", async () => {
    const e = await expectDomain(requestPdfDownload(managerNfd, docId), "state");
    expect(e.details?.setup).toBe("pdf_renderer");
    expect(e.message).toMatch(/PDF rendering isn't set up/);
  });

  it("the documents.render job is registered, idempotent and renders a pending row", async () => {
    expect(documentsRenderJob.code).toBe("documents.render");
    const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, docId));
    // Through the job runner (on behalf of the requesting user): a ready row is left unchanged.
    const { job } = await enqueueJob(db, managerNfd, documentsRenderJob, { generatedDocumentId: docId });
    expect(job.idempotencyKey).toBe(`documents.render:${docId}`);
    expect(await runJob(job.id)).toMatchObject({ status: "succeeded", result: { status: "ready", changed: false } });
    // Simulate a row the worker has not rendered yet.
    await db.update(generatedDocuments).set({ status: "rendering", checksumSha256: null }).where(eq(generatedDocuments.id, docId));
    expect(await renderGeneratedDocument(managerNfd, { generatedDocumentId: docId })).toMatchObject({ status: "ready", changed: true });
    const [after] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, docId));
    expect(after.checksumSha256).toBe(d.checksumSha256); // deterministic render of the frozen dataset
    // An unknown (or out-of-scope) document fails permanently instead of retrying.
    await expectDomain(renderGeneratedDocument(managerNfd, { generatedDocumentId: randomUUID() }), "not_found");
  });
});

describe("label templates (US-2-12)", () => {
  it("approval needs masterdata.label_template.approve and a different user than the last editor", async () => {
    const [layout] = await db.select().from(documentTemplates).where(eq(documentTemplates.code, "LBL-RM"));
    const input = { code: "LT-RM-TEST", name: "Test raw material label", documentTemplateId: layout.id, appliesTo: "material", symbology: "qr", copiesDefault: 1, mediaWidthMm: 100, mediaHeightMm: 50, dpi: 203, fields: ["item_name", "expiry", "status_word"] };
    await expectDomain(createLabelTemplate(operatorNfd, input), "forbidden");
    const e = await createLabelTemplate(managerNfd, { ...input, symbology: "code128", mediaWidthMm: 50, mediaHeightMm: 30 }).then(() => null, (x) => x);
    expect(e && "issues" in e).toBe(true); // Code 128 on a 50 mm label is refused
    await expectDomain(createLabelTemplate(managerNfd, { ...input, code: "LT-LOC-WRONG", appliesTo: "location" }), "validation"); // layout is for material
    const { id } = await createLabelTemplate(managerNfd, input);
    await expectDomain(approveLabelTemplate(managerNfd, id), "forbidden");
    const qaEditor = new AuthContext(qaNfd.userId, orgId, qaNfd.displayName, qaNfd.email, ["test"], new Set([...ROLE_BUNDLES.qa_qc.permissions, "masterdata.label_template.create"]), [nfd], nfd.id);
    const { id: own } = await createLabelTemplate(qaEditor, { ...input, code: "LT-RM-QA" });
    await expectDomain(approveLabelTemplate(qaEditor, own), "separation_of_duties");
    await approveLabelTemplate(qaNfd, id);
    const t = await lt("LT-RM-TEST");
    expect(t.status).toBe("approved");
    expect((await lastAudit("masterdata.label_template.approved", id))?.actorId).toBe(qaNfd.userId);
  });
});

describe("label jobs, print station and reprint (US-2-12, T-06, T-07)", () => {
  let jobId: string;
  let lotId: string;
  let lotNumber: string;

  it("creates a job for a lot, renders a label document and queues it at the NFD station (idempotent)", async () => {
    const [lot] = await lotAt(nfd.id, "quarantine");
    lotId = lot.id;
    lotNumber = lot.lotNumber;
    const t = await lt("LT-RM-100X50");
    const key = randomUUID();
    const r = await createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lot.id, copies: 2, idempotencyKey: key });
    expect(r.status).toBe("ready");
    expect((await createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lot.id, copies: 2, idempotencyKey: key })).jobId).toBe(r.jobId);
    jobId = r.jobId;
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, jobId));
    expect(j.copies).toBe(2);
    expect(j.entityNumber).toBe(lot.lotNumber);
    const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, j.generatedDocumentId!));
    expect(d.documentKind).toBe("label");
    expect(d.pageCount).toBe(2);
    expect(d.sourceState).toBe("quarantine");
    const printable = await labelJobForPrint(whNfd, jobId);
    expect(printable.render?.integrity).toBe("ok");
    expect(printable.render?.body).toContain(`data-payload="BC:LOT:${lot.lotNumber}"`);
    expect(printable.render?.body).toContain("STATUS AT PRINT: QUARANTINE");
    expect(printable.render?.body).toContain("Scan to verify current status");
    expect(printable.render?.css).toContain("@page { size: 100mm 50mm; margin: 0; }");
    expect(printable.render?.body).not.toMatch(/https?:\/\//);
    const [station] = await db.select().from(printStations).where(eq(printStations.siteId, nfd.id));
    const q = await stationQueue(whNfd, station.id);
    expect(q.toPrint.map((x) => x.id)).toContain(jobId);
  });

  it("a second job with unchanged content must be a reprint", async () => {
    const t = await lt("LT-RM-100X50");
    const e = await expectDomain(createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lotId, copies: 1, idempotencyKey: randomUUID() }), "conflict");
    expect(e.details?.existingJobId).toBe(jobId);
  });

  it("cross-site: an RVS operator cannot print, see or mark an NFD label job", async () => {
    const t = await lt("LT-RM-100X50");
    await expectDomain(createLabelJob(whRvs, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lotId, copies: 1, idempotencyKey: randomUUID() }), "not_found");
    await expectDomain(markLabelJobPrinted(whRvs, jobId), "not_found");
    await expectDomain(labelJobForPrint(whRvs, jobId), "not_found");
    const [station] = await db.select().from(printStations).where(eq(printStations.siteId, nfd.id));
    await expectDomain(stationQueue(whRvs, station.id), "not_found");
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, jobId));
    await expectDomain(getGeneratedDocument(whRvs, j.generatedDocumentId!), "not_found"); // documents.generated_scoped_by_source_record
  });

  it("station flow: ready → failed → retry keeps the identity → printed with printed_by and audit", async () => {
    await expectDomain(markLabelJobFailed(whNfd, jobId, ""), "validation");
    await markLabelJobFailed(whNfd, jobId, "Printer out of labels");
    await retryLabelJob(whNfd, jobId);
    let [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, jobId));
    expect(j.status).toBe("ready");
    await expectDomain(markLabelJobPrinted(auditor, jobId), "forbidden");
    await markLabelJobPrinted(whNfd, jobId);
    [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, jobId));
    expect(j.status).toBe("printed");
    expect(j.printedBy).toBe(whNfd.userId);
    expect(j.printedAt).not.toBeNull();
    expect(await lastAudit("documents.label_job.printed", jobId)).toBeTruthy();
    expect((await markLabelJobPrinted(whNfd, jobId)).replayed).toBe(true);
    await expectDomain(cancelLabelJob(whNfd, jobId), "state");
  });

  it("T-06: reprint needs a reason, links the original, prints REPRINT n and is audited", async () => {
    await expectDomain(reprintLabelJob(whNfd, jobId, { reasonCode: "", idempotencyKey: randomUUID() }), "validation");
    await expectDomain(reprintLabelJob(auditor, jobId, { reasonCode: "damaged_label", idempotencyKey: randomUUID() }), "forbidden");
    await expectDomain(reprintLabelJob(whRvs, jobId, { reasonCode: "damaged_label", idempotencyKey: randomUUID() }), "not_found");
    const r = await reprintLabelJob(whNfd, jobId, { reasonCode: "damaged_label", copies: 1, idempotencyKey: randomUUID() });
    expect(r.reprintNo).toBe(1);
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, r.jobId));
    expect(j.reprintOfId).toBe(jobId);
    expect(j.reprintReasonCode).toBe("damaged_label");
    expect(j.copies).toBe(1);
    expect(await lastAudit("documents.label_job.reprinted", j.id)).toBeTruthy();
    const p = await labelJobForPrint(whNfd, j.id);
    expect(p.render?.body).toContain("REPRINT 1");
    expect(p.render?.integrity).toBe("ok");
    const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, j.generatedDocumentId!));
    expect(d.reprintNo).toBe(1);
    expect(d.watermark).toBe("REPRINT 1");
    await markLabelJobPrinted(whNfd, j.id);
  });

  it("after a status change a reprint is refused, a new label supersedes and voids the old ones", async () => {
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lotId));
    expect(lot.lotNumber).toBe(lotNumber);
    await decideLot(qaNfd, { lotId, decision: "release", reason: "Supplier CoA reviewed and tests acceptable" });
    await expectDomain(reprintLabelJob(whNfd, jobId, { reasonCode: "lost_copy", idempotencyKey: randomUUID() }), "state");
    const t = await lt("LT-RM-100X50");
    const r = await createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lotId, copies: 1, idempotencyKey: randomUUID() });
    const old = await db.select().from(labelJobs).where(and(eq(labelJobs.entityId, lotId), eq(labelJobs.status, "printed")));
    expect(old.length).toBe(2);
    for (const o of old) {
      expect(o.voidedAt).not.toBeNull();
      expect(o.voidReason).toMatch(/QUARANTINE to RELEASED/);
      expect(await lastAudit("documents.label_job.voided", o.id)).toBeTruthy();
    }
    const p = await labelJobForPrint(whNfd, r.jobId);
    expect(p.render?.body).toContain(">RELEASED<");
  });

  it("manual void needs documents.generated_document.void and a reason", async () => {
    const [printed] = await db.select().from(labelJobs).where(and(eq(labelJobs.entityId, lotId), eq(labelJobs.status, "ready")));
    await markLabelJobPrinted(whNfd, printed.id);
    await expectDomain(voidLabelJob(whNfd, printed.id, "Repacked into a new drum"), "forbidden");
    await expectDomain(voidLabelJob(managerNfd, printed.id, "no"), "validation");
    await voidLabelJob(managerNfd, printed.id, "Repacked into a new drum");
    const [j] = await db.select().from(labelJobs).where(eq(labelJobs.id, printed.id));
    expect(j.voidReason).toBe("Repacked into a new drum");
  });

  it("location labels encode BC:LOC and Code 128 templates render a linear symbol", async () => {
    const [loc] = await db.select().from(locations).where(and(eq(locations.siteId, nfd.id), eq(locations.code, "A-01")));
    const r = await createLabelJob(whNfd, { labelTemplateId: (await lt("LT-LOC-C128")).id, entityType: "location", entityId: loc.id, copies: 1, idempotencyKey: randomUUID() });
    const p = await labelJobForPrint(whNfd, r.jobId);
    expect(p.render?.body).toContain('data-payload="BC:LOC:A-01"');
    expect(p.render?.body).toContain('data-symbology="code128"');
    expect(p.render?.body).toContain("RELEASED"); // accepted statuses of a storage location
  });

  it("no print station at the site: setup-required state, and template/entity mismatch is refused", async () => {
    const [rvsLot] = await lotAt(rvs.id, "released", "product");
    const fg = await lt("LT-FG-100X50");
    const e = await expectDomain(createLabelJob(whRvs, { labelTemplateId: fg.id, entityType: "inventory_lot", entityId: rvsLot.id, copies: 1, idempotencyKey: randomUUID() }), "state");
    expect(e.details?.setup).toBe("print_station");
    expect(e.message).toMatch(/Label printing isn't set up for RVS/);
    // Admin configures a station at RVS (current site RVS), then the wrong template kind is refused.
    const adminRvs = new AuthContext(admin.userId, orgId, admin.displayName, admin.email, ["test"], admin.permissions, [nfd, rvs], rvs.id);
    await expectDomain(createStation(whRvs, { code: "RVS-DESK", name: "RVS desk", printerName: "Printer" }), "forbidden");
    await createStation(adminRvs, { code: "RVS-DESK", name: "RVS label desk", printerName: "Thermal printer RVS (demo)" });
    await expectDomain(createLabelJob(whRvs, { labelTemplateId: (await lt("LT-RM-100X50")).id, entityType: "inventory_lot", entityId: rvsLot.id, copies: 1, idempotencyKey: randomUUID() }), "validation");
    const ok = await createLabelJob(whRvs, { labelTemplateId: fg.id, entityType: "inventory_lot", entityId: rvsLot.id, copies: 1, idempotencyKey: randomUUID() });
    expect(ok.status).toBe("ready");
  });

  it("a draft label template cannot print", async () => {
    const t = await lt("LT-RM-QA");
    const [lot] = await lotAt(nfd.id, "quarantine");
    await expectDomain(createLabelJob(whNfd, { labelTemplateId: t.id, entityType: "inventory_lot", entityId: lot.id, copies: 1, idempotencyKey: randomUUID() }), "state");
  });
});
