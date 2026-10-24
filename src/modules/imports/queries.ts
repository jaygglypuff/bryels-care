import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { IMPORT_ROW_RESULTS, fileAttachments, goodsReceipts, importJobRows, importJobs, importMappings, openingBalanceLines, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { UUID_RE } from "./files";
import { getImportKind, importKinds } from "./kinds";
import type { MappingDefinition } from "./kinds/values";
import { resultCsv } from "./outputs";

/** Read side of the import area (scoped to the reader's sites; platform.import_job.view). */
const uploader = alias(users, "imp_uploader");
const approver = alias(users, "imp_approver");
const poster = alias(users, "imp_poster");
const submitter = alias(users, "imp_submitter");

export type ImportJobFilter = { status?: string; kind?: string; limit?: number };

export async function listImportJobs(ctx: AuthContext, f: ImportJobFilter = {}) {
  ctx.require("platform.import_job.view");
  return db
    .select({
      id: importJobs.id,
      importNumber: importJobs.importNumber,
      importKind: importJobs.importKind,
      status: importJobs.status,
      source: importJobs.source,
      fileName: importJobs.fileName,
      rowsTotal: importJobs.rowsTotal,
      rowsAccepted: importJobs.rowsAccepted,
      rowsHold: importJobs.rowsHold,
      rowsRejected: importJobs.rowsRejected,
      rowsDuplicate: importJobs.rowsDuplicate,
      rowsPossibleDuplicate: importJobs.rowsPossibleDuplicate,
      rowsCreated: importJobs.rowsCreated,
      uploadedAt: importJobs.uploadedAt,
      uploadedBy: uploader.displayName,
      siteCode: sites.code,
    })
    .from(importJobs)
    .innerJoin(uploader, eq(uploader.id, importJobs.uploadedBy))
    .innerJoin(sites, eq(sites.id, importJobs.siteId))
    .where(
      and(
        eq(importJobs.organizationId, ctx.organizationId),
        inArray(importJobs.siteId, ctx.allowedSiteIds),
        f.status ? eq(importJobs.status, f.status) : undefined,
        f.kind ? eq(importJobs.importKind, f.kind) : undefined,
      ),
    )
    .orderBy(desc(importJobs.createdAt))
    .limit(Math.min(f.limit ?? 200, 500));
}

export async function getImportJob(ctx: AuthContext, jobId: string) {
  ctx.require("platform.import_job.view");
  if (!UUID_RE.test(jobId)) throw new DomainError("not_found", "Import not found in your sites.");
  const [r] = await db
    .select({ job: importJobs, uploadedByName: uploader.displayName, approvedByName: approver.displayName, postedByName: poster.displayName, submittedByName: submitter.displayName, siteCode: sites.code })
    .from(importJobs)
    .innerJoin(uploader, eq(uploader.id, importJobs.uploadedBy))
    .innerJoin(sites, eq(sites.id, importJobs.siteId))
    .leftJoin(approver, eq(approver.id, importJobs.approvedBy))
    .leftJoin(poster, eq(poster.id, importJobs.postedBy))
    .leftJoin(submitter, eq(submitter.id, importJobs.submittedBy))
    .where(and(eq(importJobs.id, jobId), eq(importJobs.organizationId, ctx.organizationId)))
    .limit(1);
  if (!r || !ctx.allowedSiteIds.includes(r.job.siteId)) throw new DomainError("not_found", "Import not found in your sites.");
  const handler = getImportKind(r.job.importKind);
  const [profile] = r.job.importMappingId ? await db.select().from(importMappings).where(eq(importMappings.id, r.job.importMappingId)).limit(1) : [];
  const scans = handler.needsScans
    ? await db
        .select({ id: fileAttachments.id, fileName: fileAttachments.fileName, sizeBytes: fileAttachments.sizeBytes, entityType: fileAttachments.entityType })
        .from(fileAttachments)
        .where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.attachmentKind, "legacy_document"), isNull(fileAttachments.deletedAt), sql`${fileAttachments.id} in (select a.id from file_attachments a where a.entity_id = ${r.job.id} union select l.file_attachment_id from legacy_documents l where l.import_job_id = ${r.job.id})`))
        .orderBy(asc(fileAttachments.fileName))
    : [];
  const receipts =
    r.job.importKind === "opening_stock"
      ? await db
          .select({ id: goodsReceipts.id, receiptNumber: goodsReceipts.receiptNumber, status: goodsReceipts.status, lines: count(openingBalanceLines.id) })
          .from(openingBalanceLines)
          .innerJoin(goodsReceipts, eq(goodsReceipts.id, openingBalanceLines.goodsReceiptId))
          .where(eq(openingBalanceLines.importJobId, r.job.id))
          .groupBy(goodsReceipts.id, goodsReceipts.receiptNumber, goodsReceipts.status)
      : [];
  const profiles = await db
    .select({ id: importMappings.id, code: importMappings.code, name: importMappings.name, version: importMappings.version })
    .from(importMappings)
    .where(and(eq(importMappings.organizationId, ctx.organizationId), eq(importMappings.importKind, r.job.importKind), eq(importMappings.isCurrent, true)))
    .orderBy(asc(importMappings.code));
  return { ...r, handler: { kind: handler.kind, label: handler.label, columns: handler.columns, needsScans: !!handler.needsScans, canVoid: !!handler.voidPosted, entityPermissions: handler.entityPermissions, requiresMigrationWindow: !!handler.requiresMigrationWindow }, mapping: r.job.mapping as MappingDefinition | null, profile: profile ?? null, profiles, scans, receipts };
}

export type ImportJobDetail = Awaited<ReturnType<typeof getImportJob>>;

/** First rows of the file for the mapping preview (§9.1 step 2: 20 rows). */
export async function previewRows(ctx: AuthContext, jobId: string, limit = 20) {
  const d = await getImportJob(ctx, jobId);
  return db.select({ rowNo: importJobRows.rowNo, raw: importJobRows.raw }).from(importJobRows).where(eq(importJobRows.importJobId, d.job.id)).orderBy(asc(importJobRows.rowNo)).limit(limit);
}

export async function listImportRows(ctx: AuthContext, jobId: string, f: { result?: string; page?: number; pageSize?: number } = {}) {
  const d = await getImportJob(ctx, jobId);
  const size = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const result = f.result && (IMPORT_ROW_RESULTS as readonly string[]).includes(f.result) ? f.result : undefined;
  const where = and(eq(importJobRows.importJobId, d.job.id), result ? eq(importJobRows.result, result) : f.result === "warned" ? sql`${importJobRows.warnings} is not null` : undefined);
  const [{ total }] = await db.select({ total: count() }).from(importJobRows).where(where);
  const rows = await db
    .select()
    .from(importJobRows)
    .where(where)
    .orderBy(asc(importJobRows.rowNo))
    .limit(size)
    .offset((page - 1) * size);
  return { rows, total, page, pageSize: size };
}

/** Results (error file) or crosswalk (row → created record, §6 rule 4) as CSV, neutralised and audited. */
export async function exportImportRows(ctx: AuthContext, jobId: string, what: "results" | "crosswalk") {
  ctx.require("platform.import_job.view");
  const d = await getImportJob(ctx, jobId);
  const rows = await db.select().from(importJobRows).where(eq(importJobRows.importJobId, d.job.id)).orderBy(asc(importJobRows.rowNo));
  const chosen = what === "crosswalk" ? rows.filter((r) => r.createdEntityId) : rows.filter((r) => r.result !== "accepted" || r.warnings);
  const body = resultCsv(
    d.job.headers as string[],
    chosen.map((r) => ({ rowNo: r.rowNo, raw: r.raw as Record<string, string>, result: r.createdEntityId ? `${r.result} → ${r.createdEntityType}` : r.result, errorMessage: r.errorMessage, warnings: r.warnings as string[] | null, matchLabel: r.matchLabel, createdEntityLabel: r.createdEntityLabel })),
  );
  await audit(db, ctx, { action: "platform.export.created", entityType: "export", entityNumber: `imports.${what}`, siteId: d.job.siteId, after: { code: `imports.${what}`, importJob: d.job.importNumber, rowCount: chosen.length, format: "csv" } });
  return { fileName: `${d.job.importNumber}-${what}.csv`, body };
}

export async function listMappingProfiles(ctx: AuthContext, kind?: string) {
  ctx.require("platform.import_job.view");
  return db
    .select({ id: importMappings.id, code: importMappings.code, name: importMappings.name, importKind: importMappings.importKind, version: importMappings.version, createdAt: importMappings.createdAt, createdBy: users.displayName, definition: importMappings.definition })
    .from(importMappings)
    .innerJoin(users, eq(users.id, importMappings.createdBy))
    .where(and(eq(importMappings.organizationId, ctx.organizationId), eq(importMappings.isCurrent, true), kind ? eq(importMappings.importKind, kind) : undefined))
    .orderBy(asc(importMappings.importKind), asc(importMappings.code));
}

/** Kinds for the wizard and the templates page (no permission needed beyond view). */
export function importKindCatalogue(ctx: AuthContext) {
  ctx.require("platform.import_job.view");
  return importKinds().map((k) => ({ kind: k.kind, label: k.label, description: k.description, columns: k.columns, available: k.availability.available, unavailableReason: k.availability.available ? null : k.availability.reason, needsScans: !!k.needsScans, entityPermissions: k.entityPermissions }));
}
