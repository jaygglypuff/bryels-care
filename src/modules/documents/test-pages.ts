import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documentTemplateVersions, documentTemplates, generatedDocuments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { sampleLabelEntity } from "./datasets";
import { insertAndRender } from "./generated";
import { labelFace } from "./label-face";
import { fieldKeys, getLabelTemplate } from "./label-templates";
import { type LabelData } from "./renderers/label-v1";
import { labelRendererV2 } from "./renderers/label-v2";
import { checkDefinition, findRenderer } from "./renderers/registry";
import { shortHash } from "./renderers/shared";
import { isUuid } from "./templates";

/**
 * Test pages (docs/reports-and-templates.md §11.1 item 6, §12 T-01):
 * - A4/Letter templates of kind `test_page`: a recorded generated document (DOC number, hash,
 *   reprintable) rendered from sample data with the version's definition; drafts print "DRAFT".
 * - Label templates: a live, unrecorded preview at the label's media size with the 50 mm ruler,
 *   sample data marked TEST PAGE, for scaling and scan-back checks before approval.
 */

const WATERMARK: Record<string, string | null> = { draft: "DRAFT", pending_approval: "DRAFT", approved: null, retired: "SUPERSEDED" };

export async function generateTemplateTestPage(ctx: AuthContext, versionId: string, idempotencyKey: string) {
  ctx.require("documents.generated_document.create");
  ctx.require("documents.template.view");
  if (!isUuid(versionId)) throw new DomainError("not_found", "Template version not found.");
  if (!idempotencyKey || idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `testpage:${idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { id: replay.id, documentNumber: replay.documentNumber, replayed: true };
    const [row] = await tx
      .select({ v: documentTemplateVersions, t: documentTemplates })
      .from(documentTemplateVersions)
      .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
      .where(and(eq(documentTemplateVersions.id, versionId), eq(documentTemplates.organizationId, ctx.organizationId)))
      .limit(1);
    if (!row) throw new DomainError("not_found", "Template version not found.");
    if (row.t.siteId) ctx.requireSite(row.t.siteId);
    if (row.t.templateKind !== "test_page") throw new DomainError("validation", "Recorded test pages exist for A4 test-page templates; label templates use the label test page preview.");
    const check = checkDefinition(row.v.definition, row.t.templateKind);
    if (!check.ok) throw new DomainError("validation", check.errors.join(" "));
    const doc = await insertAndRender(tx, ctx, {
      version: row.v,
      template: row.t,
      documentKind: "test_page",
      source: { type: "document_template_version", id: row.v.id, revisionAt: row.v.updatedAt, state: row.v.status },
      siteId: null,
      data: {
        purpose: `Printer test page for template ${row.t.code} v${row.v.versionNo} (sample data, not a business record). Check scale, symbols and type before approving the template or using a new printer.`,
        samplePayloads: ["BC:LOT:TEST-0001", `BC:DOC:TEST-0001`],
      },
      watermark: WATERMARK[row.v.status] ?? null,
      idempotencyKey: key,
    });
    if (doc.status !== "ready") throw new DomainError("state", `The test page could not be rendered: ${doc.errorMessage ?? "unknown error"}.`);
    return { id: doc.id, documentNumber: doc.documentNumber, replayed: false };
  });
}

/** Live label test page for a label template (not recorded; sample data; ruler). */
export async function labelTestPage(ctx: AuthContext, labelTemplateId: string) {
  const t = await getLabelTemplate(ctx, labelTemplateId);
  const data: LabelData = {
    label: { code: t.code, appliesTo: t.appliesTo, symbology: t.symbology as LabelData["label"]["symbology"], mediaWidthMm: Number(t.mediaWidthMm), mediaHeightMm: Number(t.mediaHeightMm), dpi: t.dpi, fields: fieldKeys(t.fields) },
    copies: 1,
    entity: sampleLabelEntity(t.appliesTo),
    testPage: true,
  };
  // ADR-099: the test label uses the template's own layout version (v1 or v2), so it is what will print.
  const [layout] = t.layoutVersion ? await db.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, t.layoutVersion.id)).limit(1) : [];
  const pinned = (layout?.definition as { renderer?: { id: string; version: number } } | undefined)?.renderer;
  const renderer = (pinned && findRenderer(pinned.id, pinned.version)) || labelRendererV2;
  const def = layout ? (layout.definition as ReturnType<typeof labelRendererV2.defaultDefinition>) : labelRendererV2.defaultDefinition("label");
  const out = renderer.render(def, {
    meta: {
      documentNumber: "TEST",
      documentKind: "label",
      templateCode: t.code,
      templateName: t.name,
      templateVersionNo: t.layoutVersion?.versionNo ?? 0,
      definitionChecksum: "",
      watermark: null,
      recordRevisionNo: 0,
      reprintNo: 0,
      reprintOfNumber: null,
      sourceRevisionAt: "",
      sourceState: null,
      generatedAt: "",
      generatedByName: ctx.displayName,
      siteCode: null,
      organizationName: "",
      traceRef: `TEST-${shortHash(t.id)}`,
    },
    data,
  });
  return { template: t, css: out.css, body: out.body.value, face: labelFace(data, out.body.value, out.css) };
}
