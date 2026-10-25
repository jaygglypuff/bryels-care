import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx } from "@/db/client";
import { documentTemplateVersions, documentTemplates, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { definitionChecksum } from "./checksum";
import { checkDefinition, renderersForKind, supportedKinds } from "./renderers/registry";
import { createTemplateInput } from "./schemas";

/**
 * Document templates and their versions (US-2-11; docs/reports-and-templates.md §1.1, §11.1).
 * Lifecycle draft → pending_approval → approved → retired; approver ≠ submitter; one approved
 * (effective) version per template; approving the next version retires the previous one.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

const submitter = alias(users, "submitter");
const approver = alias(users, "approver");
const author = alias(users, "author");

function siteVisible(ctx: AuthContext) {
  return or(isNull(documentTemplates.siteId), inArray(documentTemplates.siteId, ctx.allowedSiteIds))!;
}

export async function listTemplates(ctx: AuthContext) {
  ctx.require("documents.template.view");
  const rows = await db
    .select({
      id: documentTemplates.id,
      code: documentTemplates.code,
      name: documentTemplates.name,
      templateKind: documentTemplates.templateKind,
      pageSize: documentTemplates.pageSize,
      orientation: documentTemplates.orientation,
      siteId: documentTemplates.siteId,
      isActive: documentTemplates.isActive,
      approvedVersionNo: sql<number | null>`(select v.version_no from ${documentTemplateVersions} v where v.document_template_id = ${documentTemplates.id} and v.status = 'approved')`,
      latestVersionNo: sql<number | null>`(select max(v.version_no) from ${documentTemplateVersions} v where v.document_template_id = ${documentTemplates.id})`,
      pendingCount: sql<number>`(select count(*)::int from ${documentTemplateVersions} v where v.document_template_id = ${documentTemplates.id} and v.status = 'pending_approval')`,
    })
    .from(documentTemplates)
    .where(and(eq(documentTemplates.organizationId, ctx.organizationId), siteVisible(ctx)))
    .orderBy(asc(documentTemplates.templateKind), asc(documentTemplates.code));
  return rows;
}

async function loadTemplate(tx: DbOrTx, ctx: AuthContext, templateId: string, lock = false) {
  if (!isUuid(templateId)) throw new DomainError("not_found", "Template not found.");
  const q = tx
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.id, templateId), eq(documentTemplates.organizationId, ctx.organizationId)))
    .limit(1);
  const [t] = lock ? await q.for("update") : await q;
  if (!t) throw new DomainError("not_found", "Template not found.");
  if (t.siteId) ctx.requireSite(t.siteId);
  return t;
}

async function loadVersion(tx: DbOrTx, ctx: AuthContext, versionId: string) {
  if (!isUuid(versionId)) throw new DomainError("not_found", "Template version not found.");
  const [v] = await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, versionId)).limit(1).for("update");
  if (!v) throw new DomainError("not_found", "Template version not found.");
  const t = await loadTemplate(tx, ctx, v.documentTemplateId, true);
  return { v, t };
}

export async function getTemplate(ctx: AuthContext, templateId: string) {
  ctx.require("documents.template.view");
  const t = await loadTemplate(db, ctx, templateId);
  const versions = await db
    .select({
      v: documentTemplateVersions,
      authorName: author.displayName,
      submittedByName: submitter.displayName,
      approvedByName: approver.displayName,
    })
    .from(documentTemplateVersions)
    .innerJoin(author, eq(author.id, documentTemplateVersions.createdBy))
    .leftJoin(submitter, eq(submitter.id, documentTemplateVersions.submittedBy))
    .leftJoin(approver, eq(approver.id, documentTemplateVersions.approvedBy))
    .where(eq(documentTemplateVersions.documentTemplateId, t.id))
    .orderBy(desc(documentTemplateVersions.versionNo));
  return {
    ...t,
    versions: versions.map((r) => ({ ...r.v, authorName: r.authorName, submittedByName: r.submittedByName, approvedByName: r.approvedByName })),
    renderers: renderersForKind(t.templateKind).map((r) => ({ id: r.id, version: r.version, title: r.title, datasets: [...r.datasets] })),
  };
}

export type TemplateDetail = Awaited<ReturnType<typeof getTemplate>>;

/** Creates a template and its draft v1 from the renderer's default definition. */
export async function createTemplate(ctx: AuthContext, raw: unknown, opts: { dataset?: string } = {}) {
  ctx.require("documents.template.create");
  const input = createTemplateInput.parse(raw);
  const renderer = renderersForKind(input.templateKind)[0];
  if (!renderer || !supportedKinds().includes(input.templateKind)) {
    throw new DomainError("validation", `There is no renderer for ${input.templateKind.replace(/_/g, " ")} documents in this version yet.`);
  }
  const pageSize = input.templateKind === "label" ? "label" : input.pageSize === "label" ? "A4" : input.pageSize;
  const definition = renderer.defaultDefinition(input.templateKind, opts.dataset);
  if (definition.page.size !== "label") definition.page = { ...definition.page, size: pageSize as "A4" | "Letter", orientation: input.orientation };
  const check = checkDefinition(definition, input.templateKind);
  if (!check.ok) throw new DomainError("validation", check.errors.join(" "));
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: documentTemplates.id })
      .from(documentTemplates)
      .where(and(eq(documentTemplates.organizationId, ctx.organizationId), eq(documentTemplates.code, input.code)))
      .limit(1);
    if (dup) throw new DomainError("conflict", `A template with code ${input.code} already exists.`, { field: "code" });
    const [t] = await tx
      .insert(documentTemplates)
      .values({
        organizationId: ctx.organizationId,
        code: input.code,
        name: input.name,
        templateKind: input.templateKind,
        pageSize,
        orientation: input.orientation,
        createdBy: ctx.userId,
      })
      .returning();
    const [v] = await tx
      .insert(documentTemplateVersions)
      .values({
        documentTemplateId: t.id,
        versionNo: 1,
        status: "draft",
        definition: check.definition,
        definitionChecksum: definitionChecksum(check.definition),
        changeNote: "First version",
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "documents.template.created", entityType: "document_template", entityId: t.id, entityNumber: t.code, siteId: null, after: { code: t.code, kind: t.templateKind, versionId: v.id } });
    return { templateId: t.id, versionId: v.id };
  });
}

/** New draft version copied from the latest version. Only one open draft/pending version at a time. */
export async function createDraftVersion(ctx: AuthContext, templateId: string, changeNote?: string | null) {
  ctx.require("documents.template.edit");
  return db.transaction(async (tx) => {
    const t = await loadTemplate(tx, ctx, templateId, true);
    const versions = await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, t.id)).orderBy(desc(documentTemplateVersions.versionNo));
    const open = versions.find((v) => v.status === "draft" || v.status === "pending_approval");
    if (open) throw new DomainError("state", `Version ${open.versionNo} is still ${open.status.replace("_", " ")}. Finish or retire it first.`);
    const latest = versions[0];
    const [v] = await tx
      .insert(documentTemplateVersions)
      .values({
        documentTemplateId: t.id,
        versionNo: (latest?.versionNo ?? 0) + 1,
        status: "draft",
        definition: latest.definition,
        definitionChecksum: latest.definitionChecksum,
        changeNote: changeNote?.trim() || null,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "documents.template_version.created", entityType: "document_template_version", entityId: v.id, entityNumber: `${t.code} v${v.versionNo}`, siteId: null });
    return { versionId: v.id, versionNo: v.versionNo };
  });
}

/** Replaces a draft's definition after validating it against document_template/v1 and the renderer registry. */
export async function updateDraftDefinition(ctx: AuthContext, versionId: string, definitionJson: string, changeNote?: string | null) {
  ctx.require("documents.template.edit");
  let raw: unknown;
  try {
    raw = JSON.parse(definitionJson);
  } catch {
    throw new DomainError("validation", "The definition is not valid JSON.", { field: "definition" });
  }
  return db.transaction(async (tx) => {
    const { v, t } = await loadVersion(tx, ctx, versionId);
    if (v.status !== "draft") throw new DomainError("state", `Only a draft can be edited; version ${v.versionNo} is ${v.status.replace("_", " ")}. Create a new version instead.`);
    const check = checkDefinition(raw, t.templateKind);
    if (!check.ok) throw new DomainError("validation", check.errors.join(" "), { field: "definition" });
    const checksum = definitionChecksum(check.definition);
    await tx
      .update(documentTemplateVersions)
      .set({ definition: check.definition, definitionChecksum: checksum, changeNote: changeNote?.trim() || v.changeNote, updatedAt: new Date() })
      .where(eq(documentTemplateVersions.id, v.id));
    await audit(tx, ctx, {
      action: "documents.template_version.updated",
      entityType: "document_template_version",
      entityId: v.id,
      entityNumber: `${t.code} v${v.versionNo}`,
      siteId: null,
      before: { checksum: v.definitionChecksum },
      after: { checksum },
    });
    return { checksum };
  });
}

export async function submitVersion(ctx: AuthContext, versionId: string) {
  ctx.require("documents.template.submit");
  return db.transaction(async (tx) => {
    const { v, t } = await loadVersion(tx, ctx, versionId);
    if (v.status !== "draft") throw new DomainError("state", `Version ${v.versionNo} is ${v.status.replace("_", " ")}; only a draft can be submitted.`);
    const check = checkDefinition(v.definition, t.templateKind);
    if (!check.ok) throw new DomainError("validation", check.errors.join(" "));
    await tx.update(documentTemplateVersions).set({ status: "pending_approval", submittedBy: ctx.userId, submittedAt: new Date(), updatedAt: new Date() }).where(eq(documentTemplateVersions.id, v.id));
    await audit(tx, ctx, { action: "documents.template_version.submitted", entityType: "document_template_version", entityId: v.id, entityNumber: `${t.code} v${v.versionNo}`, siteId: null });
  });
}

/** Approves a pending version (approver ≠ submitter); the previous approved version is retired. */
export async function approveVersion(ctx: AuthContext, versionId: string) {
  ctx.require("documents.template.approve");
  return db.transaction(async (tx) => {
    const { v, t } = await loadVersion(tx, ctx, versionId);
    if (v.status !== "pending_approval") throw new DomainError("state", `Version ${v.versionNo} is ${v.status.replace("_", " ")}; only a submitted version can be approved.`);
    ctx.assertSeparation(v.submittedBy === ctx.userId, "You submitted this version, so someone else must approve it.");
    const check = checkDefinition(v.definition, t.templateKind);
    if (!check.ok) throw new DomainError("validation", check.errors.join(" "));
    const now = new Date();
    const [prev] = await tx
      .select()
      .from(documentTemplateVersions)
      .where(and(eq(documentTemplateVersions.documentTemplateId, t.id), eq(documentTemplateVersions.status, "approved")))
      .for("update");
    if (prev) {
      await tx
        .update(documentTemplateVersions)
        .set({ status: "retired", effectiveTo: now, retiredBy: ctx.userId, retiredAt: now, retireReason: `Superseded by v${v.versionNo}`, updatedAt: now })
        .where(eq(documentTemplateVersions.id, prev.id));
    }
    await tx
      .update(documentTemplateVersions)
      .set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, effectiveFrom: now, updatedAt: now })
      .where(eq(documentTemplateVersions.id, v.id));
    await audit(tx, ctx, {
      action: "documents.template_version.approved",
      entityType: "document_template_version",
      entityId: v.id,
      entityNumber: `${t.code} v${v.versionNo}`,
      siteId: null,
      after: { checksum: v.definitionChecksum, supersedes: prev ? `v${prev.versionNo}` : null },
    });
  });
}

/** Sends a submitted version back to draft with a reason (the approver's "request changes"). */
export async function returnVersionToDraft(ctx: AuthContext, versionId: string, reason: string) {
  ctx.require("documents.template.approve");
  if (!reason?.trim() || reason.trim().length < 5) throw new DomainError("validation", "Say what needs to change (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const { v, t } = await loadVersion(tx, ctx, versionId);
    if (v.status !== "pending_approval") throw new DomainError("state", "Only a submitted version can be sent back.");
    await tx.update(documentTemplateVersions).set({ status: "draft", submittedBy: null, submittedAt: null, updatedAt: new Date() }).where(eq(documentTemplateVersions.id, v.id));
    await audit(tx, ctx, { action: "documents.template_version.returned", entityType: "document_template_version", entityId: v.id, entityNumber: `${t.code} v${v.versionNo}`, siteId: null, reason: reason.trim() });
  });
}

/** Retires a version. Retiring the approved version leaves the template without an effective version. */
export async function retireVersion(ctx: AuthContext, versionId: string, reason: string) {
  ctx.require("documents.template.void");
  if (!reason?.trim() || reason.trim().length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const { v, t } = await loadVersion(tx, ctx, versionId);
    if (v.status === "retired") throw new DomainError("state", "This version is already retired.");
    const now = new Date();
    await tx
      .update(documentTemplateVersions)
      .set({ status: "retired", retiredBy: ctx.userId, retiredAt: now, retireReason: reason.trim(), effectiveTo: v.status === "approved" ? now : v.effectiveTo, updatedAt: now })
      .where(eq(documentTemplateVersions.id, v.id));
    await audit(tx, ctx, { action: "documents.template_version.retired", entityType: "document_template_version", entityId: v.id, entityNumber: `${t.code} v${v.versionNo}`, siteId: null, reason: reason.trim(), before: { status: v.status } });
  });
}

/** The approved, effective version of a template (null when none). */
export async function effectiveVersion(tx: DbOrTx, templateId: string, at = new Date()) {
  const [v] = await tx
    .select()
    .from(documentTemplateVersions)
    .where(
      and(
        eq(documentTemplateVersions.documentTemplateId, templateId),
        eq(documentTemplateVersions.status, "approved"),
        lte(documentTemplateVersions.effectiveFrom, at),
        or(isNull(documentTemplateVersions.effectiveTo), gt(documentTemplateVersions.effectiveTo, at)),
      ),
    )
    .limit(1);
  return v ?? null;
}

/** Templates of kind `label` the user can pick as a label layout. */
export async function labelLayoutTemplates(ctx: AuthContext) {
  ctx.require("masterdata.label_template.view");
  return db
    .select({ id: documentTemplates.id, code: documentTemplates.code, name: documentTemplates.name })
    .from(documentTemplates)
    .where(and(eq(documentTemplates.organizationId, ctx.organizationId), eq(documentTemplates.templateKind, "label"), eq(documentTemplates.isActive, true), siteVisible(ctx)))
    .orderBy(asc(documentTemplates.code));
}
