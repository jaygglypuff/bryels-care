/**
 * ADR-133 item 10 (ADR-124 open point): delivery receipt renderer v2, product name first with the code small after it,
 * on the renderer-versioning pattern of BMR v2 / label v2. Receipts issued on a v1 template version keep printing with
 * v1 and re-render byte-identical to their stored checksum; new receipts use v2 only once a v2 template version is
 * approved through the template approval (a draft is never used, and only QA approves it). Fictional data.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deliveryReceipts, documentTemplateVersions, documentTemplates, generatedDocuments } from "@/db/schema";
import { approveVersion, createDraftVersion, getTemplate, renderForDisplay, reprintDocument, submitVersion, updateDraftDefinition } from "@/modules/documents";
import { deliveryReceiptRendererV1 } from "@/modules/documents/renderers/delivery-receipt-v1";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { loadW4b, shipNfdOrder, stockUp, type W4b } from "../../support/w4b";

let w: W4b;
let templateId: string;

const drDoc = async (shipmentId: string) => {
  const [dr] = await db.select().from(deliveryReceipts).where(eq(deliveryReceipts.shipmentId, shipmentId));
  const [d] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, dr.generatedDocumentId!));
  return d;
};
const rendererOf = async (versionId: string) => {
  const [v] = await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, versionId));
  return (v.definition as { renderer: { version: number } }).renderer.version;
};
const approved = async () => (await db.select().from(documentTemplateVersions).where(and(eq(documentTemplateVersions.documentTemplateId, templateId), eq(documentTemplateVersions.status, "approved"))))[0];

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  await stockUp(w, ["ACS-135"]);
  [{ id: templateId }] = await db.select({ id: documentTemplates.id }).from(documentTemplates).where(eq(documentTemplates.code, "DR-STD"));
}, 180_000);

describe("delivery receipt v2 (name first) by template approval; v1 receipts keep v1", () => {
  let v1DocId: string;
  let v1Checksum: string;

  it("the demo data approved v2; a company still on v1 prints SKU first (set up here through the approval flow)", async () => {
    expect(await rendererOf((await approved()).id)).toBe(2);
    // A company that never approved v2: QA puts the v1 layout back through a new approved version.
    const d = await createDraftVersion(w.manager, templateId, "Back to the old layout (test)");
    await updateDraftDefinition(w.manager, d.versionId, JSON.stringify(deliveryReceiptRendererV1.defaultDefinition("delivery_receipt")));
    await submitVersion(w.manager, d.versionId);
    await approveVersion(w.qa, d.versionId);
    expect(await rendererOf((await approved()).id)).toBe(1);

    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "12", price: "68" }]);
    const doc = await drDoc(s.shipment.id);
    expect(await rendererOf(doc.documentTemplateVersionId)).toBe(1);
    const out = await renderForDisplay(doc);
    expect(out.integrity).toBe("ok");
    expect(out.body).toMatch(/<th>SKU<\/th><th>Product<\/th>/);
    v1DocId = doc.id;
    v1Checksum = doc.checksumSha256!;
  });

  it("a newer-layout draft is offered, is never used before approval, and only QA approves it", async () => {
    const t = await getTemplate(w.manager, templateId);
    expect(t.newerLayout).toMatchObject({ version: 2 });
    const d = await createDraftVersion(w.manager, templateId, null, { newerLayout: true });
    expect(await rendererOf(d.versionId)).toBe(2);
    // Still v1 for new receipts while it is a draft or waiting.
    const s1 = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "6", price: "68" }]);
    expect(await rendererOf((await drDoc(s1.shipment.id)).documentTemplateVersionId)).toBe(1);
    await submitVersion(w.manager, d.versionId);
    // The site manager may write and send a layout but not approve it (QA does; the approver is never the sender).
    await expectCode(approveVersion(w.manager, d.versionId), "forbidden");
    const s2 = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "6", price: "68" }]);
    expect(await rendererOf((await drDoc(s2.shipment.id)).documentTemplateVersionId)).toBe(1);
    await approveVersion(w.qa, d.versionId);
    expect(await rendererOf((await approved()).id)).toBe(2);
    expect((await getTemplate(w.manager, templateId)).newerLayout).toBeNull();
    await expectCode(createDraftVersion(w.manager, templateId, null, { newerLayout: true }), "state");
  });

  it("new receipts use v2: the product name first, the code small after it", async () => {
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "12", price: "68" }]);
    const doc = await drDoc(s.shipment.id);
    expect(await rendererOf(doc.documentTemplateVersionId)).toBe(2);
    const out = await renderForDisplay(doc);
    expect(out.integrity).toBe("ok");
    expect(out.body).not.toMatch(/<th>SKU<\/th>/);
    expect(out.body).toMatch(/<th>Product<\/th><th>Lot<\/th>/);
    const cell = /<td data-testid="dr-product"><strong>([^<]+)<\/strong> <span class="code">([^<]+)<\/span><\/td>/.exec(out.body!);
    expect(cell?.[2]).toBe("ACS-135");
    expect(cell?.[1]).not.toBe("ACS-135");
  });

  it("the receipt issued with v1 still re-renders byte-identical and reprints with v1", async () => {
    const [orig] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, v1DocId));
    expect(orig.checksumSha256).toBe(v1Checksum);
    const again = await renderForDisplay(orig);
    expect(again.integrity).toBe("ok");
    expect(again.body).toMatch(/<th>SKU<\/th><th>Product<\/th>/);
    const r = await reprintDocument(w.manager, v1DocId, { reasonCode: "lost_copy", idempotencyKey: randomUUID() });
    const [rp] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, r.id));
    expect(rp.documentTemplateVersionId).toBe(orig.documentTemplateVersionId);
    expect(await rendererOf(rp.documentTemplateVersionId)).toBe(1);
    const rpOut = await renderForDisplay(rp);
    expect(rpOut.integrity).toBe("ok");
    expect(rpOut.body).toMatch(/<th>SKU<\/th><th>Product<\/th>/);
    // The newest DR documents are on v2, the v1 receipt keeps its version.
    const newest = await db.select().from(generatedDocuments).where(eq(generatedDocuments.documentKind, "delivery_receipt")).orderBy(desc(generatedDocuments.generatedAt)).limit(1);
    expect(newest[0].id).not.toBe(v1DocId);
  });
});
