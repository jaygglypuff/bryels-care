import "server-only";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { documentTemplateVersions, documentTemplates, generatedDocuments, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { insertAndRender, markDocumentVoid, type GeneratedRow } from "./generated";
import { checkDefinition, renderFrozen } from "./renderers/registry";
import type { DocumentMeta, FrozenDataset } from "./renderers/types";

/**
 * Documents generated for a business record by another module (Wave 2 W2D: BMR, paper pages).
 * The owning module builds the dataset under the caller's AuthContext and checks its own
 * permissions; this module resolves the template version, numbers, renders, hashes and
 * supersedes (docs/reports-and-templates.md §1.4, §1.6, §11.1 item 4).
 */

type VersionRow = typeof documentTemplateVersions.$inferSelect;
type TemplateRow = typeof documentTemplates.$inferSelect;

export type SourceTemplate = { template: TemplateRow; version: VersionRow };

/** The template with `code` visible at `siteId` (site-specific first, then organization-wide). */
export async function templateByCode(tx: DbOrTx, organizationId: string, code: string, siteId: string | null): Promise<TemplateRow | null> {
  const rows = await tx
    .select()
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.organizationId, organizationId),
        eq(documentTemplates.code, code),
        eq(documentTemplates.isActive, true),
        siteId ? or(isNull(documentTemplates.siteId), eq(documentTemplates.siteId, siteId)) : isNull(documentTemplates.siteId),
      ),
    );
  return rows.find((r) => r.siteId) ?? rows[0] ?? null;
}

/**
 * Resolves the template version to render with:
 * 1. `pinnedVersionId` (a record keeps the version it was first rendered with, even when retired);
 * 2. else the approved version that was effective at `at` (e.g. batch creation);
 * 3. else the currently approved version.
 * Returns null when the template has no approved version (setup-required state).
 */
export async function resolveTemplateVersion(
  tx: DbOrTx,
  organizationId: string,
  p: { templateCode: string; siteId: string | null; pinnedVersionId?: string | null; at?: Date | null },
): Promise<SourceTemplate | null> {
  if (p.pinnedVersionId) {
    const [r] = await tx
      .select({ v: documentTemplateVersions, t: documentTemplates })
      .from(documentTemplateVersions)
      .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
      .where(and(eq(documentTemplateVersions.id, p.pinnedVersionId), eq(documentTemplates.organizationId, organizationId)))
      .limit(1);
    if (r && (r.v.status === "approved" || r.v.status === "retired")) return { template: r.t, version: r.v };
  }
  const t = await templateByCode(tx, organizationId, p.templateCode, p.siteId);
  if (!t) return null;
  if (p.at) {
    const [v] = await tx
      .select()
      .from(documentTemplateVersions)
      .where(
        and(
          eq(documentTemplateVersions.documentTemplateId, t.id),
          inArray(documentTemplateVersions.status, ["approved", "retired"]),
          lte(documentTemplateVersions.effectiveFrom, p.at),
          or(isNull(documentTemplateVersions.effectiveTo), gt(documentTemplateVersions.effectiveTo, p.at)),
        ),
      )
      .orderBy(desc(documentTemplateVersions.versionNo))
      .limit(1);
    if (v) return { template: t, version: v };
  }
  const [cur] = await tx
    .select()
    .from(documentTemplateVersions)
    .where(and(eq(documentTemplateVersions.documentTemplateId, t.id), eq(documentTemplateVersions.status, "approved")))
    .limit(1);
  return cur ? { template: t, version: cur } : null;
}

export type GenerateForSourceParams = {
  resolved: SourceTemplate;
  documentKind: string;
  source: { type: string; id: string; revisionAt: Date; state: string | null };
  siteId: string | null;
  data: unknown;
  watermark: string | null;
  idempotencyKey?: string | null;
  parameters?: Record<string, unknown> | null;
  /** Marks earlier ready documents of the same source and kind superseded (regeneration, §1.6). */
  supersedePrevious: boolean;
  supersedeReason?: string;
};

/** Generates (numbers, renders, hashes, audits) a document in the caller's transaction. */
export async function generateForSource(tx: DbOrTx, ctx: AuthContext, p: GenerateForSourceParams): Promise<GeneratedRow> {
  ctx.require("documents.generated_document.create");
  const { template, version } = p.resolved;
  const check = checkDefinition(version.definition, template.templateKind);
  if (!check.ok) throw new DomainError("setup_required", `Template ${template.code} v${version.versionNo} is not valid in this version: ${check.errors.join(" ")}`);
  const row = await insertAndRender(tx, ctx, {
    version,
    template,
    documentKind: p.documentKind,
    source: p.source,
    siteId: p.siteId,
    data: p.data,
    watermark: p.watermark,
    parameters: p.parameters ?? null,
    idempotencyKey: p.idempotencyKey ?? null,
  });
  if (row.status !== "ready") throw new DomainError("state", `The document could not be rendered: ${row.errorMessage ?? "unknown error"}.`);
  if (p.supersedePrevious) {
    const previous = await tx
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.organizationId, ctx.organizationId),
          eq(generatedDocuments.sourceEntityType, p.source.type),
          eq(generatedDocuments.sourceEntityId, p.source.id),
          eq(generatedDocuments.documentKind, p.documentKind),
          eq(generatedDocuments.status, "ready"),
          ne(generatedDocuments.id, row.id),
        ),
      )
      .for("update");
    for (const d of previous) await markDocumentVoid(tx, ctx, d, p.supersedeReason ?? `Superseded by ${row.documentNumber}`, row.id);
  }
  return row;
}

/** Every document of one kind for a source record (roots and reprints), newest first, with the generator's name. */
export async function documentsForSource(q: DbOrTx, organizationId: string, sourceType: string, sourceId: string, kinds: string[]) {
  return q
    .select({ d: generatedDocuments, generatedByName: users.displayName })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .where(
      and(
        eq(generatedDocuments.organizationId, organizationId),
        eq(generatedDocuments.sourceEntityType, sourceType),
        eq(generatedDocuments.sourceEntityId, sourceId),
        inArray(generatedDocuments.documentKind, kinds),
      ),
    )
    .orderBy(desc(generatedDocuments.generatedAt), desc(sql`${generatedDocuments.documentNumber}`));
}

/** For read paths outside a transaction. */
export async function documentsForSourceRead(organizationId: string, sourceType: string, sourceId: string, kinds: string[]) {
  return documentsForSource(db, organizationId, sourceType, sourceId, kinds);
}

/**
 * Live, unrecorded preview with the same renderer and definition (no number, no hash, no audit).
 * The caller must label it as a preview and must not offer printing it (A-RPT-27: the printed
 * artefact is always a recorded generation).
 */
export function renderPreview(
  resolved: SourceTemplate,
  data: unknown,
  p: { documentKind: string; watermark: string | null; siteCode: string | null; organizationName: string; generatedByName: string; generatedAt: string; sourceRevisionAt: Date; sourceState: string | null },
) {
  const meta: DocumentMeta = {
    documentNumber: "PREVIEW",
    documentKind: p.documentKind,
    templateCode: resolved.template.code,
    templateName: resolved.template.name,
    templateVersionNo: resolved.version.versionNo,
    definitionChecksum: resolved.version.definitionChecksum,
    watermark: p.watermark ? `PREVIEW · ${p.watermark}` : "PREVIEW",
    recordRevisionNo: 0,
    reprintNo: 0,
    reprintOfNumber: null,
    sourceRevisionAt: p.sourceRevisionAt.toISOString(),
    sourceState: p.sourceState,
    generatedAt: p.generatedAt,
    generatedByName: p.generatedByName,
    siteCode: p.siteCode,
    organizationName: p.organizationName,
    traceRef: "PREVIEW",
  };
  const out = renderFrozen(resolved.version.definition, resolved.template.templateKind, { meta, data } satisfies FrozenDataset);
  return { css: out.css, body: out.body.value };
}
