import "server-only";
import { and, asc, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx } from "@/db/client";
import { documentTemplateVersions, documentTemplates, generatedDocuments, organizations, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { fmtDateTime } from "@/lib/qty";
import { pdfFilesAvailable, pdfSetupMessage } from "./config";
import { reprintReason } from "./reasons";
import { renderFrozen } from "./renderers/registry";
import { shortHash } from "./renderers/shared";
import type { DocumentMeta, FrozenDataset } from "./renderers/types";
import { reprintInput } from "./schemas";
import { isUuid } from "./templates";

/**
 * Generated documents (US-2-11; docs/reports-and-templates.md §1.4–1.6).
 *
 * Generation freezes the dataset, allocates a DOC number, renders with the pinned template
 * version and records sha256 + page count + who/when in one transaction. The render step is the
 * same function the `documents.render` worker job runs (jobs/render.ts); in Phase 2 it runs
 * synchronously because HTML rendering takes milliseconds and needs no Chromium (ADR-016 note in
 * src/modules/documents/config.ts).
 */

export type GeneratedRow = typeof generatedDocuments.$inferSelect;
type VersionRow = typeof documentTemplateVersions.$inferSelect;
type TemplateRow = typeof documentTemplates.$inferSelect;

export type GenerateParams = {
  id?: string;
  version: VersionRow;
  template: TemplateRow;
  documentKind: string;
  source: { type: string; id: string; revisionAt: Date; state: string | null };
  siteId: string | null;
  data: unknown;
  watermark: string | null;
  parameters?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  traceRef?: string;
  reprint?: { root: GeneratedRow; reasonCode: string; note: string | null };
};

async function siteCode(tx: DbOrTx, siteId: string | null) {
  if (!siteId) return null;
  const [s] = await tx.select({ code: sites.code }).from(sites).where(eq(sites.id, siteId)).limit(1);
  return s?.code ?? null;
}

/** Inserts a generated_documents row and renders it in the caller's transaction. */
export async function insertAndRender(tx: DbOrTx, ctx: AuthContext, p: GenerateParams): Promise<GeneratedRow> {
  const id = p.id ?? uuidv7();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gdoc:${p.source.type}:${p.source.id}:${p.documentKind}`}))`);
  const number = await nextNumber(tx, ctx.organizationId, "DOC");
  let recordRevisionNo: number;
  let reprintNo = 0;
  if (p.reprint) {
    recordRevisionNo = p.reprint.root.recordRevisionNo;
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(generatedDocuments).where(eq(generatedDocuments.reprintOfId, p.reprint.root.id));
    reprintNo = (c?.n ?? 0) + 1;
  } else {
    const [m] = await tx
      .select({ n: max(generatedDocuments.recordRevisionNo) })
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.sourceEntityType, p.source.type),
          eq(generatedDocuments.sourceEntityId, p.source.id),
          eq(generatedDocuments.documentKind, p.documentKind),
          isNull(generatedDocuments.reprintOfId),
        ),
      );
    recordRevisionNo = (m?.n ?? 0) + 1;
  }
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const now = new Date();
  const meta: DocumentMeta = {
    documentNumber: number,
    documentKind: p.documentKind,
    templateCode: p.template.code,
    templateName: p.template.name,
    templateVersionNo: p.version.versionNo,
    definitionChecksum: p.version.definitionChecksum,
    watermark: p.reprint ? `REPRINT ${reprintNo}` : p.watermark,
    recordRevisionNo,
    reprintNo,
    reprintOfNumber: p.reprint?.root.documentNumber ?? null,
    sourceRevisionAt: p.source.revisionAt.toISOString(),
    sourceState: p.source.state,
    generatedAt: fmtDateTime(now),
    generatedByName: ctx.displayName,
    siteCode: await siteCode(tx, p.siteId),
    organizationName: org?.name ?? "",
    traceRef: p.traceRef ?? shortHash(id),
  };
  const dataset: FrozenDataset = { meta, data: p.data };
  await tx.insert(generatedDocuments).values({
    id,
    organizationId: ctx.organizationId,
    siteId: p.siteId,
    documentTemplateVersionId: p.version.id,
    documentKind: p.documentKind,
    sourceEntityType: p.source.type,
    sourceEntityId: p.source.id,
    sourceRevisionAt: p.source.revisionAt,
    documentNumber: number,
    status: "rendering",
    recordRevisionNo,
    sourceState: p.source.state,
    watermark: meta.watermark,
    outputFormat: "html",
    dataset,
    generatedBy: ctx.userId,
    generatedAt: now,
    reprintOfId: p.reprint?.root.id ?? null,
    reprintNo,
    reprintReasonCode: p.reprint?.reasonCode ?? null,
    reprintNote: p.reprint?.note ?? null,
    parameters: p.parameters ?? null,
    idempotencyKey: p.idempotencyKey ?? null,
  });
  return renderInTx(tx, ctx, id);
}

/**
 * Renders a stored row from its frozen dataset and pinned template version; idempotent (a ready
 * row is returned unchanged). On a render error the row becomes `failed` with the message, never
 * a fake success.
 */
export async function renderInTx(tx: DbOrTx, ctx: AuthContext, documentId: string): Promise<GeneratedRow> {
  const [row] = await tx
    .select({ d: generatedDocuments, definition: documentTemplateVersions.definition, kind: documentTemplates.templateKind })
    .from(generatedDocuments)
    .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.id, generatedDocuments.documentTemplateVersionId))
    .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
    .for("update", { of: generatedDocuments });
  if (!row) throw new DomainError("not_found", "Document not found.");
  if (row.d.status === "ready" || row.d.status === "void" || row.d.status === "superseded") return row.d;
  try {
    const out = renderFrozen(row.definition, row.kind, row.d.dataset as FrozenDataset);
    const [u] = await tx
      .update(generatedDocuments)
      .set({ status: "ready", checksumSha256: out.checksumSha256, pageCount: out.pageCount, renderedAt: new Date(), errorMessage: null })
      .where(eq(generatedDocuments.id, documentId))
      .returning();
    const isReprint = !!u.reprintOfId;
    await audit(tx, ctx, {
      action: isReprint ? "documents.generated_document.reprinted" : "documents.generated_document.generated",
      entityType: "generated_document",
      entityId: u.id,
      entityNumber: u.documentNumber,
      siteId: u.siteId,
      reason: isReprint ? [u.reprintReasonCode, u.reprintNote].filter(Boolean).join(": ") : null,
      after: {
        kind: u.documentKind,
        source: `${u.sourceEntityType}:${u.sourceEntityId}`,
        sourceRevisionAt: u.sourceRevisionAt,
        templateVersionId: u.documentTemplateVersionId,
        checksumSha256: u.checksumSha256,
        pageCount: u.pageCount,
        reprintNo: u.reprintNo || undefined,
      },
    });
    return u;
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const [u] = await tx.update(generatedDocuments).set({ status: "failed", errorMessage: message }).where(eq(generatedDocuments.id, documentId)).returning();
    return u;
  }
}

/** Source-record scoping (docs/permissions-matrix.md §3.7: documents follow the source record's permission and site). */
export function assertSourceVisible(ctx: AuthContext, d: { sourceEntityType: string; siteId: string | null }) {
  const hidden = () => new DomainError("not_found", "This document isn't available at your sites.");
  if (d.siteId && !ctx.allowedSiteIds.includes(d.siteId)) throw hidden();
  switch (d.sourceEntityType) {
    case "inventory_lot":
      if (!ctx.can("inventory.lot.view")) throw hidden();
      break;
    case "location":
      if (!ctx.can("masterdata.location.view")) throw hidden();
      break;
    case "document_template_version":
      if (!ctx.can("documents.template.view")) throw hidden();
      break;
    default:
      throw hidden();
  }
}

async function loadVisible(tx: DbOrTx, ctx: AuthContext, id: string, lock = false) {
  if (!isUuid(id)) throw new DomainError("not_found", "This document isn't available at your sites.");
  const q = tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.organizationId, ctx.organizationId))).limit(1);
  const [d] = lock ? await q.for("update") : await q;
  if (!d) throw new DomainError("not_found", "This document isn't available at your sites.");
  assertSourceVisible(ctx, d);
  return d;
}

/** Re-renders the stored dataset and compares the hash with the recorded one (print integrity). */
export async function renderForDisplay(d: GeneratedRow) {
  const [v] = await db
    .select({ definition: documentTemplateVersions.definition, kind: documentTemplates.templateKind, code: documentTemplates.code, versionNo: documentTemplateVersions.versionNo })
    .from(documentTemplateVersions)
    .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
    .where(eq(documentTemplateVersions.id, d.documentTemplateVersionId))
    .limit(1);
  try {
    const out = renderFrozen(v.definition, v.kind, d.dataset as FrozenDataset);
    return { html: out.html, css: out.css, body: out.body.value, integrity: out.checksumSha256 === d.checksumSha256 ? ("ok" as const) : ("mismatch" as const), error: null };
  } catch (e) {
    return { html: null, css: null, body: null, integrity: "error" as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getGeneratedDocument(ctx: AuthContext, id: string) {
  ctx.require("documents.generated_document.view");
  const d = await loadVisible(db, ctx, id);
  const rootId = d.reprintOfId ?? d.id;
  const chain = await db
    .select({ id: generatedDocuments.id, documentNumber: generatedDocuments.documentNumber, reprintNo: generatedDocuments.reprintNo, status: generatedDocuments.status, generatedAt: generatedDocuments.generatedAt, generatedByName: users.displayName, reprintReasonCode: generatedDocuments.reprintReasonCode, reprintNote: generatedDocuments.reprintNote })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .where(or(eq(generatedDocuments.id, rootId), eq(generatedDocuments.reprintOfId, rootId)))
    .orderBy(asc(generatedDocuments.reprintNo));
  const [info] = await db
    .select({ code: documentTemplates.code, name: documentTemplates.name, versionNo: documentTemplateVersions.versionNo, templateId: documentTemplates.id, generatedByName: users.displayName })
    .from(documentTemplateVersions)
    .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
    .innerJoin(users, eq(users.id, sql`${d.generatedBy}`))
    .where(eq(documentTemplateVersions.id, d.documentTemplateVersionId))
    .limit(1);
  return { ...d, template: info, chain, pdfAvailable: pdfFilesAvailable() };
}

export type GeneratedDocumentDetail = Awaited<ReturnType<typeof getGeneratedDocument>>;

/** Documents generated for a source record, newest first (record history; ux-system §9.12). */
export async function listDocumentsForSource(ctx: AuthContext, sourceType: string, sourceId: string) {
  ctx.require("documents.generated_document.view");
  if (!isUuid(sourceId)) return [];
  const rows = await db
    .select({ d: generatedDocuments, generatedByName: users.displayName })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.sourceEntityType, sourceType), eq(generatedDocuments.sourceEntityId, sourceId)))
    .orderBy(desc(generatedDocuments.generatedAt));
  return rows.filter((r) => {
    try {
      assertSourceVisible(ctx, r.d);
      return true;
    } catch {
      return false;
    }
  }).map((r) => ({ ...r.d, generatedByName: r.generatedByName }));
}

/** Resolves BC:DOC:<number> after authentication and source permission (docs/security.md §4.9). */
export async function findDocumentByNumber(ctx: AuthContext, documentNumber: string) {
  ctx.require("documents.generated_document.view");
  const [d] = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.documentNumber, documentNumber)))
    .limit(1);
  if (!d) return null;
  try {
    assertSourceVisible(ctx, d);
  } catch {
    return null;
  }
  return d;
}

/** Validates a reprint reason (422 without one; `other` needs a note). */
export function parseReprint(raw: unknown) {
  const r = reprintInput.safeParse(raw);
  if (!r.success) throw new DomainError("validation", r.error.issues[0]?.message ?? "Choose a reason for the reprint.", { field: "reasonCode" });
  const reason = reprintReason(r.data.reasonCode);
  if (!reason) throw new DomainError("validation", "Choose a reason for the reprint.", { field: "reasonCode" });
  const note = r.data.note?.trim() || null;
  if (reason.requiresNote && (!note || note.length < 5)) throw new DomainError("validation", "Explain the reason for this reprint (at least 5 characters).", { field: "note" });
  return { ...r.data, note, reason };
}

/** Controlled reprint of a non-label document (labels reprint through their label job). */
export async function reprintDocument(ctx: AuthContext, id: string, raw: unknown) {
  ctx.require("documents.reprint.create");
  const input = parseReprint(raw);
  return db.transaction(async (tx) => {
    const key = `reprint:${input.idempotencyKey}`;
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { id: replay.id, documentNumber: replay.documentNumber, replayed: true };
    const d = await loadVisible(tx, ctx, id, true);
    if (d.documentKind === "label") throw new DomainError("validation", "Labels are reprinted from their label job so the print station gets the job.");
    const root = d.reprintOfId ? await loadVisible(tx, ctx, d.reprintOfId, true) : d;
    if (root.status !== "ready") throw new DomainError("state", `Document ${root.documentNumber} is ${root.status}; only a current document can be reprinted. Generate a new one instead.`);
    const [v] = await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, root.documentTemplateVersionId)).limit(1);
    const [t] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, v.documentTemplateId)).limit(1);
    const frozen = root.dataset as FrozenDataset;
    const row = await insertAndRender(tx, ctx, {
      version: v,
      template: t,
      documentKind: root.documentKind,
      source: { type: root.sourceEntityType, id: root.sourceEntityId, revisionAt: root.sourceRevisionAt, state: root.sourceState },
      siteId: root.siteId,
      data: frozen.data,
      watermark: null,
      parameters: root.parameters as Record<string, unknown> | null,
      idempotencyKey: key,
      reprint: { root, reasonCode: input.reason.code, note: input.note },
    });
    if (row.status !== "ready") throw new DomainError("state", `The reprint could not be rendered: ${row.errorMessage ?? "unknown error"}.`);
    return { id: row.id, documentNumber: row.documentNumber, reprintNo: row.reprintNo, replayed: false };
  });
}

/** Void = generated in error (wrong template, wrong record). The row and its content are kept. */
export async function voidDocument(ctx: AuthContext, id: string, reason: string) {
  ctx.require("documents.generated_document.void");
  if (!reason?.trim() || reason.trim().length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const d = await loadVisible(tx, ctx, id, true);
    if (d.documentKind === "label") throw new DomainError("validation", "Void labels from their label job so the scan card lists them as superseded.");
    if (d.status === "void") throw new DomainError("state", "This document is already void.");
    await markDocumentVoid(tx, ctx, d, reason.trim());
  });
}

export async function markDocumentVoid(tx: DbOrTx, ctx: AuthContext, d: GeneratedRow, reason: string, supersededById?: string) {
  const now = new Date();
  await tx
    .update(generatedDocuments)
    .set(
      supersededById
        ? { status: "superseded", supersededById }
        : { status: "void", voidedBy: ctx.userId, voidedAt: now, voidReason: reason },
    )
    .where(eq(generatedDocuments.id, d.id));
  await audit(tx, ctx, {
    action: "documents.generated_document.superseded",
    entityType: "generated_document",
    entityId: d.id,
    entityNumber: d.documentNumber,
    siteId: d.siteId,
    reason: supersededById ? reason : `void: ${reason}`,
    before: { status: d.status },
    after: { status: supersededById ? "superseded" : "void", supersededById: supersededById ?? null },
  });
}

/** "Download PDF": refuses with the setup-required state until a PDF engine and storage exist (no fake file). */
export async function requestPdfDownload(ctx: AuthContext, id: string) {
  ctx.require("documents.generated_document.export");
  await loadVisible(db, ctx, id);
  if (!pdfFilesAvailable()) throw new DomainError("state", pdfSetupMessage(), { setup: "pdf_renderer" });
  throw new DomainError("state", "Stored PDF download is not available in this build.");
}

/** For lists: documents visible in the user's sites (admin overview). */
export async function recentDocuments(ctx: AuthContext, limit = 50) {
  ctx.require("documents.generated_document.view");
  const rows = await db
    .select({ d: generatedDocuments, generatedByName: users.displayName, templateCode: documentTemplates.code, versionNo: documentTemplateVersions.versionNo })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .innerJoin(documentTemplateVersions, eq(documentTemplateVersions.id, generatedDocuments.documentTemplateVersionId))
    .innerJoin(documentTemplates, eq(documentTemplates.id, documentTemplateVersions.documentTemplateId))
    .where(and(eq(generatedDocuments.organizationId, ctx.organizationId), or(isNull(generatedDocuments.siteId), inArray(generatedDocuments.siteId, ctx.allowedSiteIds))))
    .orderBy(desc(generatedDocuments.generatedAt))
    .limit(limit * 2);
  return rows
    .filter((r) => {
      try {
        assertSourceVisible(ctx, r.d);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, limit)
    .map((r) => ({ ...r.d, generatedByName: r.generatedByName, templateCode: r.templateCode, versionNo: r.versionNo }));
}
