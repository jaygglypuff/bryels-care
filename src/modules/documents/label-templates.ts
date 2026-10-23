import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx } from "@/db/client";
import { documentTemplateVersions, documentTemplates, labelTemplates, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelFieldsSchema, labelTemplateInput, type LabelFieldKey } from "./schemas";
import { effectiveVersion, isUuid } from "./templates";

/**
 * Label templates: the physical configuration (applies_to, symbology, media, dpi, fields) of a
 * label, bound to a document template of kind `label` for its layout (US-2-12;
 * docs/data-model.md §3.2). Approval (masterdata.label_template.approve, QA) is by someone other
 * than the last editor; any edit returns an approved template to draft.
 */

/** Datasets implemented in this build, by applies_to. Others arrive with their modules (containers, equipment, samples). */
export const LABEL_DATASET_FOR: Partial<Record<string, string>> = {
  material: "label/material/v1",
  wip: "label/wip/v1",
  finished_good: "label/finished_good/v1",
  location: "label/location/v1",
};

const editor = alias(users, "editor");
const approverU = alias(users, "label_approver");

function visible(ctx: AuthContext) {
  return or(isNull(labelTemplates.siteId), inArray(labelTemplates.siteId, ctx.allowedSiteIds))!;
}

export async function listLabelTemplates(ctx: AuthContext) {
  ctx.require("masterdata.label_template.view");
  return db
    .select({
      id: labelTemplates.id,
      code: labelTemplates.code,
      name: labelTemplates.name,
      appliesTo: labelTemplates.appliesTo,
      symbology: labelTemplates.symbology,
      mediaWidthMm: labelTemplates.mediaWidthMm,
      mediaHeightMm: labelTemplates.mediaHeightMm,
      dpi: labelTemplates.dpi,
      status: labelTemplates.status,
      layoutCode: documentTemplates.code,
    })
    .from(labelTemplates)
    .innerJoin(documentTemplates, eq(documentTemplates.id, labelTemplates.documentTemplateId))
    .where(and(eq(labelTemplates.organizationId, ctx.organizationId), visible(ctx)))
    .orderBy(asc(labelTemplates.appliesTo), asc(labelTemplates.code));
}

async function load(tx: DbOrTx, ctx: AuthContext, id: string, lock = false) {
  if (!isUuid(id)) throw new DomainError("not_found", "Label template not found.");
  const q = tx.select().from(labelTemplates).where(and(eq(labelTemplates.id, id), eq(labelTemplates.organizationId, ctx.organizationId))).limit(1);
  const [t] = lock ? await q.for("update") : await q;
  if (!t) throw new DomainError("not_found", "Label template not found.");
  if (t.siteId) ctx.requireSite(t.siteId);
  return t;
}

export async function getLabelTemplate(ctx: AuthContext, id: string) {
  ctx.require("masterdata.label_template.view");
  const [row] = await db
    .select({ t: labelTemplates, layoutCode: documentTemplates.code, layoutName: documentTemplates.name, editorName: editor.displayName, approverName: approverU.displayName })
    .from(labelTemplates)
    .innerJoin(documentTemplates, eq(documentTemplates.id, labelTemplates.documentTemplateId))
    .innerJoin(editor, eq(editor.id, labelTemplates.updatedBy))
    .leftJoin(approverU, eq(approverU.id, labelTemplates.approvedBy))
    .where(and(eq(labelTemplates.id, isUuid(id) ? id : "00000000-0000-0000-0000-000000000000"), eq(labelTemplates.organizationId, ctx.organizationId), visible(ctx)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Label template not found.");
  const layout = await effectiveVersion(db, row.t.documentTemplateId);
  return { ...row.t, layoutCode: row.layoutCode, layoutName: row.layoutName, editorName: row.editorName, approverName: row.approverName, fieldKeys: fieldKeys(row.t.fields), layoutVersion: layout ? { id: layout.id, versionNo: layout.versionNo, dataset: (layout.definition as { dataset?: string }).dataset ?? null } : null };
}

export function fieldKeys(fields: unknown): LabelFieldKey[] {
  const p = labelFieldsSchema.safeParse(fields);
  return p.success ? p.data.show : [];
}

/** Checks that the layout is a label template whose latest/effective version uses the dataset of `appliesTo`. */
async function checkLayout(tx: DbOrTx, ctx: AuthContext, documentTemplateId: string, appliesTo: string, requireApproved: boolean) {
  const [layout] = await tx
    .select()
    .from(documentTemplates)
    .where(and(eq(documentTemplates.id, documentTemplateId), eq(documentTemplates.organizationId, ctx.organizationId)))
    .limit(1);
  if (!layout || layout.templateKind !== "label") throw new DomainError("validation", "Choose a layout template of kind label.", { field: "documentTemplateId" });
  const dataset = LABEL_DATASET_FOR[appliesTo];
  if (!dataset) throw new DomainError("validation", `${appliesTo.replace("_", " ")} labels arrive with their module (boxes, pallets, equipment, samples); they cannot be configured yet.`, { field: "appliesTo" });
  const v = requireApproved
    ? await effectiveVersion(tx, layout.id)
    : (await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.documentTemplateId, layout.id)).orderBy(desc(documentTemplateVersions.versionNo)).limit(1))[0];
  if (!v) throw new DomainError("state", `Layout ${layout.code} has no approved version yet. QA must approve the layout first.`, { field: "documentTemplateId" });
  const ds = (v.definition as { dataset?: string }).dataset;
  if (ds !== dataset) throw new DomainError("validation", `Layout ${layout.code} v${v.versionNo} is for ${ds ?? "another dataset"}; ${appliesTo.replace("_", " ")} labels need ${dataset}.`, { field: "documentTemplateId" });
  return { layout, version: v };
}

export async function createLabelTemplate(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.label_template.create");
  const input = labelTemplateInput.parse(raw);
  if (input.siteId) ctx.requireSite(input.siteId);
  return db.transaction(async (tx) => {
    await checkLayout(tx, ctx, input.documentTemplateId, input.appliesTo, false);
    const [dup] = await tx.select({ id: labelTemplates.id }).from(labelTemplates).where(and(eq(labelTemplates.organizationId, ctx.organizationId), eq(labelTemplates.code, input.code))).limit(1);
    if (dup) throw new DomainError("conflict", `A label template with code ${input.code} already exists.`, { field: "code" });
    const [t] = await tx
      .insert(labelTemplates)
      .values({
        organizationId: ctx.organizationId,
        siteId: input.siteId ?? null,
        code: input.code,
        name: input.name,
        documentTemplateId: input.documentTemplateId,
        appliesTo: input.appliesTo,
        symbology: input.symbology,
        copiesDefault: input.copiesDefault,
        fields: { schema_version: "label_fields/v1", show: [...new Set(input.fields)] },
        mediaWidthMm: String(input.mediaWidthMm),
        mediaHeightMm: String(input.mediaHeightMm),
        dpi: input.dpi,
        status: "draft",
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "masterdata.label_template.created", entityType: "label_template", entityId: t.id, entityNumber: t.code, siteId: t.siteId, after: input });
    return { id: t.id };
  });
}

/** Any change returns the template to draft; it needs a new approval before labels print with it. */
export async function updateLabelTemplate(ctx: AuthContext, id: string, raw: unknown) {
  ctx.require("masterdata.label_template.edit");
  const input = labelTemplateInput.parse(raw);
  return db.transaction(async (tx) => {
    const t = await load(tx, ctx, id, true);
    if (t.status === "retired") throw new DomainError("state", "This label template is retired.");
    if (input.code !== t.code) throw new DomainError("validation", "The code cannot change; create a new template instead.", { field: "code" });
    await checkLayout(tx, ctx, input.documentTemplateId, input.appliesTo, false);
    const after = {
      name: input.name,
      documentTemplateId: input.documentTemplateId,
      appliesTo: input.appliesTo,
      symbology: input.symbology,
      copiesDefault: input.copiesDefault,
      fields: { schema_version: "label_fields/v1", show: [...new Set(input.fields)] },
      mediaWidthMm: String(Number(input.mediaWidthMm).toFixed(1)),
      mediaHeightMm: String(Number(input.mediaHeightMm).toFixed(1)),
      dpi: input.dpi,
    };
    await tx
      .update(labelTemplates)
      .set({ ...after, status: "draft", approvedBy: null, approvedAt: null, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(labelTemplates.id, t.id));
    await audit(tx, ctx, {
      action: "masterdata.label_template.updated",
      entityType: "label_template",
      entityId: t.id,
      entityNumber: t.code,
      siteId: t.siteId,
      before: { status: t.status, symbology: t.symbology, media: `${t.mediaWidthMm}x${t.mediaHeightMm}`, fields: t.fields },
      after: { status: "draft", symbology: after.symbology, media: `${after.mediaWidthMm}x${after.mediaHeightMm}`, fields: after.fields },
    });
  });
}

export async function approveLabelTemplate(ctx: AuthContext, id: string) {
  ctx.require("masterdata.label_template.approve");
  return db.transaction(async (tx) => {
    const t = await load(tx, ctx, id, true);
    if (t.status !== "draft") throw new DomainError("state", `This label template is ${t.status}; only a draft can be approved.`);
    if (t.updatedBy === ctx.userId) throw new DomainError("separation_of_duties", "You made the last change to this label template, so someone else must approve it.");
    const { version } = await checkLayout(tx, ctx, t.documentTemplateId, t.appliesTo, true);
    await tx.update(labelTemplates).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(labelTemplates.id, t.id));
    await audit(tx, ctx, { action: "masterdata.label_template.approved", entityType: "label_template", entityId: t.id, entityNumber: t.code, siteId: t.siteId, after: { layoutVersionId: version.id, symbology: t.symbology, media: `${t.mediaWidthMm}x${t.mediaHeightMm}` } });
  });
}

export async function retireLabelTemplate(ctx: AuthContext, id: string, reason: string) {
  ctx.require("masterdata.label_template.approve");
  if (!reason?.trim() || reason.trim().length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const t = await load(tx, ctx, id, true);
    if (t.status === "retired") throw new DomainError("state", "This label template is already retired.");
    await tx.update(labelTemplates).set({ status: "retired", isActive: false }).where(eq(labelTemplates.id, t.id));
    await audit(tx, ctx, { action: "masterdata.label_template.retired", entityType: "label_template", entityId: t.id, entityNumber: t.code, siteId: t.siteId, reason: reason.trim(), before: { status: t.status } });
  });
}

/** Approved label templates for an applies_to that the site may use (job form, scan card). */
export async function approvedLabelTemplatesFor(tx: DbOrTx, organizationId: string, siteId: string, appliesTo: string) {
  return tx
    .select()
    .from(labelTemplates)
    .where(
      and(
        eq(labelTemplates.organizationId, organizationId),
        eq(labelTemplates.appliesTo, appliesTo),
        eq(labelTemplates.status, "approved"),
        eq(labelTemplates.isActive, true),
        or(isNull(labelTemplates.siteId), eq(labelTemplates.siteId, siteId)),
      ),
    )
    .orderBy(asc(labelTemplates.code));
}

/** Internal: used by label jobs to validate a template choice and resolve its effective layout. */
export async function loadPrintableTemplate(tx: DbOrTx, ctx: AuthContext, id: string, appliesTo: string, siteId: string) {
  const t = await load(tx, ctx, id);
  if (t.status !== "approved" || !t.isActive) throw new DomainError("state", `Label template ${t.code} is not approved for printing.`, { field: "labelTemplateId" });
  if (t.siteId && t.siteId !== siteId) throw new DomainError("validation", `Label template ${t.code} belongs to another site.`, { field: "labelTemplateId" });
  if (t.appliesTo !== appliesTo) throw new DomainError("validation", `Label template ${t.code} is for ${t.appliesTo.replace("_", " ")} labels, not ${appliesTo.replace("_", " ")}.`, { field: "labelTemplateId" });
  const { layout, version } = await checkLayout(tx, ctx, t.documentTemplateId, t.appliesTo, true);
  return { template: t, layout, version };
}
