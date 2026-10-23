import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, fileAttachments, goodsReceiptLines, supplierLotDocuments, suppliers } from "@/db/schema";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { verifyDownloadSignature } from "@/lib/storage";
import { createReceiptDraft, receiveAndPost, type ReceiptLineInput } from "@/modules/inventory/receiving";
import { issueDownloadUrl, listLotDocuments, redeemDownload, uploadReceiptDocument, voidAttachment } from "@/modules/inventory/receiving-documents";
import { lotReleaseBlockers } from "@/modules/inventory/receiving-queries";
import { decideLot } from "@/modules/quality/dispositions";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, expectDomain, future, loadSites, loc, mat } from "../../support/w1b";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let wh: AuthContext;
let whRvs: AuthContext;
let qa: AuthContext;
let auditor: AuthContext;
let lagunaId: string;
let storageDir: string;
const savedEnv = { FILE_STORAGE: process.env.FILE_STORAGE, FILE_STORAGE_DIR: process.env.FILE_STORAGE_DIR };

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const PDF = Uint8Array.from(ascii("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"));
function jpegWithExif(): Uint8Array {
  const exif = [...ascii("Exif\0\0"), ...ascii("II"), 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0, 0, 0, 0, ...ascii("GPS-SECRET-14.59N")];
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif];
  const jfif = [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const app0 = [0xff, 0xe0, 0x00, jfif.length + 2, ...jfif];
  const com = [0xff, 0xfe, 0x00, 0x10, ...ascii("secret comment")];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0xd9];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...com, ...sos]);
}
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle));

async function line(over: Partial<ReceiptLineInput> = {}): Promise<ReceiptLineInput> {
  return { materialId: (await mat("MAT-0012")).id, qty: "10", uom: "kg", supplierLotNumber: "LOS-A1", expiresOn: future(300), locationId: (await loc(nfd.id, "QUA-01")).id, ...over };
}
async function draftLine() {
  const d = await createReceiptDraft(wh, { idempotencyKey: randomUUID(), supplierId: lagunaId, supplierDocumentNumber: "DR-ATT", lines: [await line()] });
  const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, d.receiptId));
  return { receiptId: d.receiptId, lineId: l.id };
}
const upload = (ctx: AuthContext, entityId: string, over: Partial<Parameters<typeof uploadReceiptDocument>[1]> = {}) =>
  uploadReceiptDocument(ctx, { entityType: "goods_receipt_line", entityId, documentKind: "coa", documentNumber: "COA-77", fileName: "coa.pdf", declaredType: "application/pdf", bytes: PDF, idempotencyKey: randomUUID(), ...over });

beforeAll(async () => {
  await resetTestDatabase();
  ({ orgId, nfd, rvs } = await loadSites());
  storageDir = mkdtempSync(path.join(tmpdir(), "bc-files-"));
  process.env.FILE_STORAGE = "local";
  process.env.FILE_STORAGE_DIR = storageDir;
  wh = await ctxFor(orgId, "warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  whRvs = await ctxFor(orgId, "warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
  qa = await ctxFor(orgId, "qa.nfd@bryels-care.test", ROLE_BUNDLES.qa_qc.permissions, [nfd, rvs]);
  auditor = await ctxFor(orgId, "auditor@bryels-care.test", ROLE_BUNDLES.auditor.permissions, [nfd, rvs]);
  lagunaId = (await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply")))[0].id;
});
afterAll(() => {
  process.env.FILE_STORAGE = savedEnv.FILE_STORAGE;
  process.env.FILE_STORAGE_DIR = savedEnv.FILE_STORAGE_DIR;
});

describe("supplier lot documents and uploads (US-2-08)", () => {
  it("stores a CoA under an opaque key and links it to the receipt line; idempotent", async () => {
    const { lineId } = await draftLine();
    const key = randomUUID();
    const r = await upload(wh, lineId, { idempotencyKey: key });
    const again = await upload(wh, lineId, { idempotencyKey: key });
    expect(again).toEqual({ attachmentId: r.attachmentId, replayed: true });
    const [a] = await db.select().from(fileAttachments).where(eq(fileAttachments.id, r.attachmentId));
    expect(a.bucketKey).toBe(`org/${orgId}/${r.attachmentId}`); // files.no_direct_access: no name, no guessable path
    expect(a).toMatchObject({ storageDriver: "local", contentType: "application/pdf", sizeBytes: PDF.length, attachmentKind: "coa", entityType: "goods_receipt_line", entityId: lineId, virusScanStatus: "pending" });
    expect(a.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path.join(storageDir, "org", orgId, r.attachmentId))).toEqual(Buffer.from(PDF));
    expect(storageDir.includes(`${path.sep}public${path.sep}`)).toBe(false);
    const [doc] = await db.select().from(supplierLotDocuments).where(eq(supplierLotDocuments.fileAttachmentId, r.attachmentId));
    expect(doc).toMatchObject({ documentKind: "coa", documentNumber: "COA-77", goodsReceiptLineId: lineId, lotId: null });
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.attachmentId), eq(auditEvents.action, "documents.file_attachment.uploaded")))).toHaveLength(1);
  });

  it("upload.rejects_mismatch, upload.size_cap and HEIC refusal (422)", async () => {
    const { lineId } = await draftLine();
    await expectDomain(upload(wh, lineId, { fileName: "coa.pdf", declaredType: "application/pdf", bytes: jpegWithExif() }), "validation");
    await expectDomain(upload(wh, lineId, { fileName: "coa.pdf", declaredType: "image/png", bytes: PDF }), "validation");
    await expectDomain(upload(wh, lineId, { fileName: "coa.exe", declaredType: "application/pdf", bytes: PDF }), "validation");
    await expectDomain(upload(wh, lineId, { fileName: "script.html", declaredType: "text/html", bytes: Uint8Array.from(ascii("<script>alert(1)</script>")) }), "validation");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    await expectDomain(upload(wh, lineId, { fileName: "big.jpg", declaredType: "image/jpeg", bytes: big, documentKind: "photo" }), "validation");
    const heic = Uint8Array.from([0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0]);
    const e = await expectDomain(upload(wh, lineId, { fileName: "IMG_1.HEIC", declaredType: "image/heic", bytes: heic, documentKind: "photo" }), "validation");
    expect(e.message).toMatch(/HEIC/);
  });

  it("upload.exif_stripped: photo metadata is removed, orientation kept", async () => {
    const { lineId } = await draftLine();
    const r = await upload(wh, lineId, { fileName: "label.jpg", declaredType: "image/jpeg", bytes: jpegWithExif(), documentKind: "photo" });
    const stored = new Uint8Array(readFileSync(path.join(storageDir, "org", orgId, r.attachmentId)));
    expect(has(stored, "GPS-SECRET")).toBe(false);
    expect(has(stored, "secret comment")).toBe(false);
    expect(has(stored, "Exif")).toBe(true); // minimal orientation block
    expect(stored[0]).toBe(0xff);
    expect(stored[stored.length - 1]).toBe(0xd9);
  });

  it("authz: cross-site and permission-less uploads are refused; nothing is written", async () => {
    const { lineId } = await draftLine();
    await expectDomain(upload(whRvs, lineId), "not_found");
    await expectDomain(upload(auditor, lineId), "forbidden");
    expect(await db.select().from(supplierLotDocuments).where(eq(supplierLotDocuments.goodsReceiptLineId, lineId))).toHaveLength(0);
  });

  it("documents.signed_url_user_bound / signed_url_expires: links are per user and expire after 5 minutes", async () => {
    const { lineId } = await draftLine();
    const r = await upload(wh, lineId);
    const { url } = await issueDownloadUrl(wh, r.attachmentId);
    const u = new URL(url, "http://x");
    const params = { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") };
    const got = await redeemDownload(wh, r.attachmentId, params);
    expect(got.kind).toBe("bytes");
    if (got.kind === "bytes") expect(Buffer.from(got.bytes)).toEqual(Buffer.from(PDF));
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.attachmentId), eq(auditEvents.action, "documents.file_attachment.downloaded")))).toHaveLength(1);
    await expectDomain(redeemDownload(qa, r.attachmentId, params), "forbidden"); // another user
    await expectDomain(redeemDownload(wh, r.attachmentId, { ...params, sig: params.sig!.slice(0, -2) + "xx" }), "forbidden");
    expect(verifyDownloadSignature(r.attachmentId, wh.userId, params, Date.now() + 301_000)).toBe(false);
    await expectDomain(issueDownloadUrl(whRvs, r.attachmentId), "not_found");
  });

  it("requires_coa: a lot posted without CoA cannot be released until one is attached", async () => {
    const extract = await mat("MAT-0043"); // seeded with requires_coa = true
    const p = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Laguna Botanicals", supplierDocumentNumber: "LB-DR-1", lines: [await line({ materialId: extract.id, qty: "500", uom: "g", supplierLotNumber: "LB-9001" })] });
    const [l] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, p.receiptId));
    expect(l.documentMissing).toBe(true);
    expect((await lotReleaseBlockers(db, l.lotId!)).join(" ")).toMatch(/CoA/);
    await expectDomain(decideLot(qa, { lotId: l.lotId!, decision: "release", reason: "Appearance conforms" }), "state");
    const r = await upload(wh, l.id);
    const [after] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, l.id));
    expect(after.documentMissing).toBe(false);
    const docs = await listLotDocuments(qa, l.lotId!);
    expect(docs.map((d) => d.id)).toEqual([r.attachmentId]);
    await decideLot(qa, { lotId: l.lotId!, decision: "release", reason: "CoA LB-9001 reviewed, conforms" });

    // Voiding needs documents.file_attachment.void and a reason; the line is flagged again.
    await expectDomain(voidAttachment(wh, { attachmentId: r.attachmentId, reason: "wrong file" }), "forbidden");
    await expectDomain(voidAttachment(qa, { attachmentId: r.attachmentId, reason: "" }), "validation");
    await voidAttachment(qa, { attachmentId: r.attachmentId, reason: "Uploaded the wrong supplier's CoA" });
    const [flagged] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, l.id));
    expect(flagged.documentMissing).toBe(true);
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, r.attachmentId), eq(auditEvents.action, "documents.file_attachment.removed")))).toHaveLength(1);
    await expectDomain(issueDownloadUrl(wh, r.attachmentId), "not_found");
  });

  it("shows the setup-required state when storage is not configured", async () => {
    const { lineId } = await draftLine();
    delete process.env.FILE_STORAGE;
    try {
      await expectDomain(upload(wh, lineId), "setup_required");
    } finally {
      process.env.FILE_STORAGE = "local";
    }
    expect(existsSync(storageDir)).toBe(true);
  });
});
