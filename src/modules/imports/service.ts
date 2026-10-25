import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { IMPORT_ROW_DECISIONS, fileAttachments, importJobRows, importJobs, importMappings } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { validateUpload } from "@/lib/storage";
import { enqueueJob, runJob } from "@/modules/platform/jobs";
import { UUID_RE, insertAttachment, storeObject } from "./files";
import { wizardPostGuard, type GuardEnv } from "./guard";
import { importJobProcessJob } from "./jobs/process";
import { getImportKind, type ImportJobRow, type ImportKindHandler } from "./kinds";
import { DATE_FORMATS, DECIMAL_SEPARATORS, DEFAULT_FORMATS, THOUSANDS_SEPARATORS, autoMap, type MappingDefinition } from "./kinds/values";
import { ParseError, parseImportFile } from "./parse";
import { assertImportTransition } from "./state";

/**
 * Import job commands (US-5-08, docs/data-migration-plan.md §9.1): upload → mapping → validation →
 * review (duplicate decisions) → submit → approve (a second person, setting
 * `platform.imports.require_second_person`) → post → (void). Every command takes the AuthContext first,
 * checks the permission at the job's site, runs in one transaction and writes one audit event.
 * Validation and posting run as the background job `platform.import_job.process`; files up to
 * `platform.imports.inline_row_limit` rows are processed immediately in the request with the same code.
 */
const MIN_REASON = 5;
const ACTIVE_RUN = ["validating", "posting"] as const;

function reason(v: string | null | undefined, field = "reason") {
  const r = (v ?? "").trim();
  if (r.length < MIN_REASON) throw new DomainError("validation", `Give a reason of at least ${MIN_REASON} characters.`, { field });
  if (r.length > 1000) throw new DomainError("validation", "The reason is too long (max 1,000 characters).", { field });
  return r;
}

async function lockJob(tx: Tx, ctx: AuthContext, jobId: string) {
  if (!UUID_RE.test(jobId)) throw new DomainError("not_found", "Import not found in your sites.");
  const [job] = await tx.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!job || !ctx.allowedSiteIds.includes(job.siteId)) throw new DomainError("not_found", "Import not found in your sites.");
  return job;
}

function assertAvailable(k: ImportKindHandler) {
  if (!k.availability.available) throw new DomainError("setup_required", k.availability.reason);
}

/** One validation or posting run per person at a time (docs/security.md §2.6). */
async function assertNoRunningJob(tx: Tx, ctx: AuthContext, exceptJobId: string) {
  const [busy] = await tx
    .select({ number: importJobs.importNumber })
    .from(importJobs)
    .where(and(eq(importJobs.organizationId, ctx.organizationId), inArray(importJobs.status, [...ACTIVE_RUN]), ne(importJobs.id, exceptJobId), sql`(${importJobs.uploadedBy} = ${ctx.userId} or ${importJobs.postedBy} = ${ctx.userId})`))
    .limit(1);
  if (busy) throw new DomainError("conflict", `Import ${busy.number} of yours is still running. Wait until it finishes, then try again.`);
}

/* ------------------------------------------------------------------ upload */

export type UploadInput = {
  kind: string;
  siteId?: string | null;
  fileName: string;
  bytes: Uint8Array;
  idempotencyKey: string;
  reuploadReason?: string | null;
  /** Saved mapping profile code to apply (its current version). */
  mappingCode?: string | null;
  source?: "wizard" | "loader";
};

export async function uploadImport(ctx: AuthContext, input: UploadInput) {
  const siteId = input.siteId || ctx.currentSiteId;
  ctx.requireAt("platform.import_job.create", siteId);
  ctx.require("platform.import_job.create");
  const handler = getImportKind(input.kind);
  assertAvailable(handler);
  const key = (input.idempotencyKey ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(key)) throw new DomainError("validation", "The upload is missing its key. Reload the page and try again.");
  const [replay] = await db.select({ id: importJobs.id, importNumber: importJobs.importNumber }).from(importJobs).where(and(eq(importJobs.organizationId, ctx.organizationId), eq(importJobs.idempotencyKey, key))).limit(1);
  if (replay) return { jobId: replay.id, importNumber: replay.importNumber, replayed: true };

  const maxMb = await getSetting(db, ctx.organizationId, "platform.imports.max_file_mb");
  if (!input.bytes?.length) throw new DomainError("validation", "The file is empty.", { field: "file" });
  if (input.bytes.length > maxMb * 1024 * 1024) throw new DomainError("too_large", `The file is ${(input.bytes.length / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB. Split it into smaller files.`, { field: "file" });
  const fileName = (input.fileName || "").replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(-200);
  const maxRows = await getSetting(db, ctx.organizationId, "platform.imports.max_rows");
  let sheet;
  try {
    sheet = parseImportFile(fileName, input.bytes, { maxRows });
  } catch (e) {
    if (e instanceof ParseError) throw new DomainError(e.kind === "too_large" ? "too_large" : "validation", e.message, { field: "file" });
    throw e;
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const [same] = await db
    .select({ number: importJobs.importNumber })
    .from(importJobs)
    .where(and(eq(importJobs.organizationId, ctx.organizationId), eq(importJobs.importKind, handler.kind), eq(importJobs.siteId, siteId), eq(importJobs.checksumSha256, sha256), notInArray(importJobs.status, ["rejected"])))
    .orderBy(desc(importJobs.createdAt))
    .limit(1);
  if (same && !(input.reuploadReason ?? "").trim()) throw new DomainError("conflict", `This exact file was already uploaded as ${same.number}. Give a reason to load it again.`, { field: "reuploadReason" });
  const reuploadReason = same ? reason(input.reuploadReason, "reuploadReason") : null;

  let mappingId: string | null = null;
  let mapping: MappingDefinition = { columns: autoMap(handler.columns, sheet.headers), ...DEFAULT_FORMATS };
  if (input.mappingCode) {
    const [m] = await db
      .select()
      .from(importMappings)
      .where(and(eq(importMappings.organizationId, ctx.organizationId), eq(importMappings.code, input.mappingCode.trim().toUpperCase()), eq(importMappings.isCurrent, true)))
      .limit(1);
    if (!m || m.importKind !== handler.kind) throw new DomainError("validation", `No saved ${handler.label.toLowerCase()} mapping with code ${input.mappingCode}.`, { field: "mappingCode" });
    mappingId = m.id;
    mapping = applyProfile(m.definition as MappingDefinition, sheet.headers, handler);
  }

  const obj = await storeObject(ctx, input.bytes, sheet.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const jobId = uuidv7();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"imp:" + key}))`);
    const [again] = await tx.select({ id: importJobs.id, importNumber: importJobs.importNumber }).from(importJobs).where(and(eq(importJobs.organizationId, ctx.organizationId), eq(importJobs.idempotencyKey, key))).limit(1);
    if (again) return { jobId: again.id, importNumber: again.importNumber, replayed: true };
    await insertAttachment(tx, ctx, { ...obj, siteId, fileName, contentType: sheet.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: input.bytes.length, sha256, entityType: "import_job", entityId: jobId, kind: "import" });
    const importNumber = await nextNumber(tx, ctx.organizationId, "IMP");
    await tx.insert(importJobs).values({
      id: jobId,
      organizationId: ctx.organizationId,
      siteId,
      importNumber,
      importKind: handler.kind,
      status: "uploaded",
      source: input.source ?? "wizard",
      fileAttachmentId: obj.id,
      fileName,
      fileFormat: sheet.format,
      checksumSha256: sha256,
      sizeBytes: input.bytes.length,
      headers: sheet.headers,
      fileNotes: sheet.notes.length ? sheet.notes : null,
      importMappingId: mappingId,
      mapping,
      rowsTotal: sheet.rows.length,
      reuploadReason,
      uploadedBy: ctx.userId,
      idempotencyKey: key,
      correlationId: ctx.correlationId ?? uuidv7(),
    });
    for (let i = 0; i < sheet.rows.length; i += 1000) {
      await tx.insert(importJobRows).values(
        sheet.rows.slice(i, i + 1000).map((cells, j) => ({
          organizationId: ctx.organizationId,
          siteId,
          importJobId: jobId,
          rowNo: sheet.sourceRowNumbers[i + j],
          raw: Object.fromEntries(sheet.headers.map((h, c) => [h, cells[c]])),
        })),
      );
    }
    await audit(tx, ctx, {
      action: "documents.file_attachment.uploaded",
      entityType: "file_attachment",
      entityId: obj.id,
      entityNumber: importNumber,
      siteId,
      after: { parent: "import_job", parentId: jobId, kind: "import", fileName, sizeBytes: input.bytes.length, sha256 },
    });
    await audit(tx, ctx, {
      action: "platform.import_job.uploaded",
      entityType: "import_job",
      entityId: jobId,
      entityNumber: importNumber,
      siteId,
      reason: reuploadReason,
      after: { status: "uploaded", kind: handler.kind, fileName, sha256, rows: sheet.rows.length, format: sheet.format, mappingId, source: input.source ?? "wizard", formulaCells: sheet.formulaCells },
    });
    return { jobId, importNumber, replayed: false };
  });
}

/** Applies a saved profile to a file: headers missing from the file fall back to automatic matching. */
function applyProfile(def: MappingDefinition, headers: string[], handler: ImportKindHandler): MappingDefinition {
  const auto = autoMap(handler.columns, headers);
  const columns: Record<string, string | null> = {};
  for (const c of handler.columns) {
    const h = def.columns?.[c.key];
    columns[c.key] = h && headers.includes(h) ? h : auto[c.key];
  }
  return { columns, dateFormat: def.dateFormat ?? DEFAULT_FORMATS.dateFormat, decimalSeparator: def.decimalSeparator ?? DEFAULT_FORMATS.decimalSeparator, thousandsSeparator: def.thousandsSeparator ?? DEFAULT_FORMATS.thousandsSeparator };
}

/* ------------------------------------------------------------------ mapping */

const MappingInput = z
  .object({
    columns: z.record(z.string(), z.string().nullable()),
    dateFormat: z.enum(DATE_FORMATS),
    decimalSeparator: z.enum(DECIMAL_SEPARATORS),
    thousandsSeparator: z.enum(THOUSANDS_SEPARATORS),
    profile: z
      .object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, "Profile code: capital letters, digits, dot, dash or underscore."),
        name: z.string().trim().min(3, "Give the profile a name.").max(120),
      })
      .nullable()
      .optional(),
  })
  .strict();
export type MappingInput = z.input<typeof MappingInput>;

/**
 * Saves the column mapping of an import (and optionally as a new version of a named profile, reused by
 * later files). A change after validation sends the job back to `uploaded` (results are recomputed).
 */
export async function saveJobMapping(ctx: AuthContext, jobId: string, raw: MappingInput) {
  const parsed = MappingInput.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new DomainError("validation", i.message, { field: i.path.join(".") || "mapping" });
  }
  const v = parsed.data;
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.create", job.siteId);
    if (!["uploaded", "validated", "under_review", "failed"].includes(job.status) || job.approvedAt) throw new DomainError("state", `Import ${job.importNumber} is ${job.status}; its mapping can no longer change.`);
    const handler = getImportKind(job.importKind);
    const headers = job.headers as string[];
    const columns: Record<string, string | null> = {};
    const used = new Map<string, string>();
    const fieldErrors: Record<string, string> = {};
    for (const c of handler.columns) {
      const h = v.columns[c.key] || null;
      if (h && !headers.includes(h)) fieldErrors[`col_${c.key}`] = `The file has no column "${h}".`;
      else if (h && used.has(h)) fieldErrors[`col_${c.key}`] = `"${h}" is already mapped to ${used.get(h)}.`;
      else if (!h && c.required) fieldErrors[`col_${c.key}`] = `${c.label} is required: choose the file column that holds it.`;
      if (h) used.set(h, c.label);
      columns[c.key] = h;
    }
    if (Object.keys(fieldErrors).length) throw new DomainError("validation", "Check the highlighted columns.", { fieldErrors });
    const mapping: MappingDefinition = { columns, dateFormat: v.dateFormat, decimalSeparator: v.decimalSeparator, thousandsSeparator: v.thousandsSeparator };
    if (mapping.decimalSeparator === mapping.thousandsSeparator) throw new DomainError("validation", "The decimal and thousands separators must differ.", { field: "thousandsSeparator" });
    let mappingId = job.importMappingId;
    if (v.profile) {
      ctx.require("platform.import_job.create");
      const [cur] = await tx.select().from(importMappings).where(and(eq(importMappings.organizationId, ctx.organizationId), eq(importMappings.code, v.profile.code), eq(importMappings.isCurrent, true))).for("update").limit(1);
      if (cur && cur.importKind !== job.importKind) throw new DomainError("conflict", `Profile ${v.profile.code} belongs to another import kind (${cur.importKind}).`, { field: "profileCode" });
      if (cur) await tx.update(importMappings).set({ isCurrent: false }).where(eq(importMappings.id, cur.id));
      const [m] = await tx
        .insert(importMappings)
        .values({ organizationId: ctx.organizationId, siteId: job.siteId, code: v.profile.code, name: v.profile.name, importKind: job.importKind, version: (cur?.version ?? 0) + 1, definition: mapping, createdBy: ctx.userId })
        .returning();
      mappingId = m.id;
      await audit(tx, ctx, { action: "platform.import_mapping.saved", entityType: "import_mapping", entityId: m.id, entityNumber: `${m.code} v${m.version}`, siteId: job.siteId, before: cur ? { version: cur.version, definition: cur.definition } : null, after: { version: m.version, kind: m.importKind, definition: mapping } });
    } else if (mappingId) {
      const [m] = await tx.select({ definition: importMappings.definition }).from(importMappings).where(eq(importMappings.id, mappingId)).limit(1);
      if (!m || JSON.stringify(m.definition) !== JSON.stringify(mapping)) mappingId = null;
    }
    const to = "uploaded" as const;
    if (job.status !== "uploaded") assertImportTransition(job.status, to, job.importNumber);
    await tx.update(importJobs).set({ mapping, importMappingId: mappingId, status: to, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.mapped", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, before: { status: job.status, mapping: job.mapping }, after: { status: to, mapping, mappingId } });
    return { jobId: job.id, mappingId };
  });
}

/* ------------------------------------------------------------------ runs */

async function inlineLimit(ctx: AuthContext) {
  return getSetting(db, ctx.organizationId, "platform.imports.inline_row_limit");
}

/** Starts validation (dry run). Small files run at once; larger ones in the worker (result notified in-app). */
export async function startValidation(ctx: AuthContext, jobId: string, opts: { inline?: boolean } = {}) {
  const r = await db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.create", job.siteId);
    assertImportTransition(job.status, "validating", job.importNumber);
    if (job.approvedAt) throw new DomainError("state", `Import ${job.importNumber} was already approved; post it or reject it.`);
    const handler = getImportKind(job.importKind);
    assertAvailable(handler);
    const mapping = job.mapping as MappingDefinition | null;
    const missing = handler.columns.filter((c) => c.required && !mapping?.columns?.[c.key]);
    if (missing.length) throw new DomainError("validation", `Map the required columns first: ${missing.map((c) => c.label).join(", ")}.`, { field: "mapping" });
    await assertNoRunningJob(tx, ctx, job.id);
    const runNo = job.runNo + 1;
    await tx.update(importJobs).set({ status: "validating", runNo, failureMessage: null, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    const { job: bg } = await enqueueJob(tx, ctx, importJobProcessJob, { importJobId: job.id, phase: "validate" as const, runNo }, { siteId: job.siteId });
    await audit(tx, ctx, { action: "platform.import_job.validation_started", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, before: { status: job.status }, after: { status: "validating", runNo, backgroundJobId: bg.id } });
    return { backgroundJobId: bg.id, rows: job.rowsTotal };
  });
  if (opts.inline ?? r.rows <= (await inlineLimit(ctx))) await runJob(r.backgroundJobId);
  return r;
}

const DecisionInput = z.object({ rowId: z.string().uuid(), decision: z.enum(IMPORT_ROW_DECISIONS), note: z.string().trim().max(500).optional().nullable() }).strict();

/** Custodian decision on a tier 2/3 candidate (§8): same as existing, new record or reject. Audited. */
export async function decideRow(ctx: AuthContext, jobId: string, raw: z.input<typeof DecisionInput>) {
  const v = DecisionInput.parse(raw);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.create", job.siteId);
    if (job.status !== "under_review" && job.status !== "validated") throw new DomainError("state", `Import ${job.importNumber} is ${job.status}; duplicate decisions are made after validation.`);
    const [row] = await tx.select().from(importJobRows).where(and(eq(importJobRows.id, v.rowId), eq(importJobRows.importJobId, job.id))).for("update").limit(1);
    if (!row) throw new DomainError("not_found", "Row not found.");
    if (!row.duplicateTier || row.duplicateTier === 1 || !row.matchEntityId) throw new DomainError("state", `Row ${row.rowNo} is not a possible duplicate.`);
    if (v.decision === "reject" && (v.note ?? "").length < MIN_REASON) throw new DomainError("validation", `Say why the row is rejected (at least ${MIN_REASON} characters).`, { field: "note" });
    const result = v.decision === "same_as_existing" ? "duplicate" : v.decision === "reject" ? "rejected" : row.holdOnPost ? "hold" : "accepted";
    await tx
      .update(importJobRows)
      .set({
        decision: v.decision,
        decisionNote: v.note ?? null,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        result,
        errorMessage: v.decision === "reject" ? `Rejected by ${ctx.displayName}: ${v.note}` : row.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(importJobRows.id, row.id));
    const [{ undecided }] = await tx.execute<{ undecided: number }>(sql`select count(*)::int as undecided from import_job_rows where import_job_id = ${job.id} and result = 'possible_duplicate'`);
    const to = undecided === 0 ? "validated" : "under_review";
    const counts = await tx.execute<Record<string, number>>(sql`
      select count(*) filter (where result = 'accepted')::int as accepted, count(*) filter (where result = 'hold')::int as hold,
        count(*) filter (where result = 'duplicate')::int as duplicate, count(*) filter (where result = 'possible_duplicate')::int as possible,
        count(*) filter (where result = 'rejected')::int as rejected
      from import_job_rows where import_job_id = ${job.id}`);
    const c = counts[0];
    await tx.update(importJobs).set({ status: to, rowsAccepted: c.accepted, rowsHold: c.hold, rowsDuplicate: c.duplicate, rowsPossibleDuplicate: c.possible, rowsRejected: c.rejected, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, {
      action: "platform.import_job.row_decided",
      entityType: "import_job",
      entityId: job.id,
      entityNumber: job.importNumber,
      siteId: job.siteId,
      reason: v.note ?? null,
      before: { rowNo: row.rowNo, result: row.result, decision: row.decision },
      after: { rowNo: row.rowNo, result, decision: v.decision, match: { type: row.matchEntityType, id: row.matchEntityId, label: row.matchLabel }, status: to },
    });
    return { result, status: to };
  });
}

export async function submitImport(ctx: AuthContext, jobId: string) {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.submit", job.siteId);
    assertImportTransition(job.status, "submitted", job.importNumber);
    if (job.rowsAccepted + job.rowsHold === 0) throw new DomainError("state", `Import ${job.importNumber} has no row to post.`);
    await tx.update(importJobs).set({ status: "submitted", submittedBy: ctx.userId, submittedAt: new Date(), updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.submitted", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, before: { status: job.status }, after: { status: "submitted", toPost: job.rowsAccepted + job.rowsHold } });
    return { status: "submitted" as const };
  });
}

/** Second-person approval (§9.1, §9.4 `migrate:approve`). The approver must differ from the uploader and the submitter when the setting says so. */
export async function approveImport(ctx: AuthContext, jobId: string, note?: string | null) {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.approve", job.siteId);
    assertImportTransition(job.status, "approved", job.importNumber);
    const sod = await getSetting(tx, ctx.organizationId, "platform.imports.require_second_person");
    if (ctx.sodBlocks(sod && (ctx.userId === job.uploadedBy || ctx.userId === job.submittedBy), "You uploaded or submitted this import, so a different person must approve it (second-person check).")) {
      throw new DomainError("separation_of_duties", "You uploaded or submitted this import, so a different person must approve it (second-person check).", ctx.refusalDetails());
    }
    const n = (note ?? "").trim() || null;
    await tx.update(importJobs).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), approvalNote: n, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.approved", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, reason: n, before: { status: job.status }, after: { status: "approved", uploadedBy: job.uploadedBy, submittedBy: job.submittedBy } });
    return { status: "approved" as const };
  });
}

/** Sends a submitted import back for changes (approver), with a reason. */
export async function returnImport(ctx: AuthContext, jobId: string, why: string) {
  const r = reason(why);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.approve", job.siteId);
    assertImportTransition(job.status, "validated", job.importNumber);
    if (job.status !== "submitted") throw new DomainError("state", `Import ${job.importNumber} is not waiting for approval.`);
    await tx.update(importJobs).set({ status: "validated", submittedBy: null, submittedAt: null, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.returned", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, reason: r, before: { status: job.status }, after: { status: "validated" } });
    return { status: "validated" as const };
  });
}

/** Rejects (closes) an import that was not posted. The uploader may withdraw their own; others need approve. */
export async function rejectImport(ctx: AuthContext, jobId: string, why: string) {
  const r = reason(why);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    if (ctx.userId === job.uploadedBy) ctx.requireAt("platform.import_job.create", job.siteId);
    else ctx.requireAt("platform.import_job.approve", job.siteId);
    assertImportTransition(job.status, "rejected", job.importNumber);
    if (job.rowsCreated > 0) throw new DomainError("state", `Import ${job.importNumber} already created records; void it instead.`);
    await tx.update(importJobs).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: new Date(), rejectReason: r, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.rejected", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, reason: r, before: { status: job.status }, after: { status: "rejected" } });
    return { status: "rejected" as const };
  });
}

/**
 * Posts an approved import (or resumes a failed posting run). The poster needs platform.import_job.post and
 * every entity permission of the kind; the worker rebuilds the poster's context when it runs.
 */
export async function postImport(ctx: AuthContext, jobId: string, opts: { inline?: boolean; env?: GuardEnv } = {}) {
  const r = await db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.post", job.siteId);
    const handler = getImportKind(job.importKind);
    assertAvailable(handler);
    for (const p of handler.entityPermissions) ctx.requireAt(p, job.siteId);
    assertImportTransition(job.status, "posting", job.importNumber);
    if (!job.approvedAt) throw new DomainError("state", `Import ${job.importNumber} needs approval before posting.`);
    const env: GuardEnv = opts.env ?? { APP_ENV: process.env.APP_ENV, MIGRATION_WINDOW_OPEN: process.env.MIGRATION_WINDOW_OPEN };
    const g = wizardPostGuard(env, !!handler.requiresMigrationWindow);
    if (!g.ok) throw new DomainError("forbidden", g.reason, { code: "MIGRATION_WINDOW_CLOSED" });
    await assertNoRunningJob(tx, ctx, job.id);
    const runNo = job.runNo + 1;
    await tx.update(importJobs).set({ status: "posting", runNo, postedBy: job.postedBy ?? null, failureMessage: null, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    const { job: bg } = await enqueueJob(tx, ctx, importJobProcessJob, { importJobId: job.id, phase: "post" as const, runNo }, { siteId: job.siteId });
    await audit(tx, ctx, { action: "platform.import_job.post_started", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, before: { status: job.status }, after: { status: "posting", runNo, backgroundJobId: bg.id } });
    return { backgroundJobId: bg.id, rows: job.rowsAccepted + job.rowsHold };
  });
  if (opts.inline ?? r.rows <= (await inlineLimit(ctx))) await runJob(r.backgroundJobId);
  return r;
}

/**
 * Voids a posted import (§9.3): opening stock is reversed by reversal movements (reason import_voided),
 * legacy documents are marked void. Master-data kinds cannot be voided here: their records are corrected
 * on the master-data screens (the crosswalk lists them).
 */
export async function voidImport(ctx: AuthContext, jobId: string, why: string) {
  const r = reason(why);
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    ctx.requireAt("platform.import_job.void", job.siteId);
    assertImportTransition(job.status, "voided", job.importNumber);
    const handler = getImportKind(job.importKind);
    if (!handler.voidPosted) throw new DomainError("state", `${handler.label} imports cannot be voided as a whole. Deactivate or discontinue the created records on their screens (see the crosswalk of ${job.importNumber}).`);
    const result = await handler.voidPosted({ ctx, tx, job, reason: r });
    const now = new Date();
    await tx.update(importJobs).set({ status: "voided", voidedBy: ctx.userId, voidedAt: now, voidReason: r, updatedAt: now }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.reversed", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, reason: r, before: { status: job.status }, after: { status: "voided", ...result } });
    return { status: "voided" as const, ...result };
  });
}

/* ------------------------------------------------------------------ legacy scans */

/** Uploads scans for a `legacy_documents` import (PDF/JPEG/PNG/WebP, validated like every upload). */
export async function uploadLegacyScans(ctx: AuthContext, jobId: string, files: { fileName: string; declaredType: string; bytes: Uint8Array }[]) {
  if (!files.length) throw new DomainError("validation", "Choose at least one scan.", { field: "files" });
  if (files.length > 200) throw new DomainError("validation", "Upload at most 200 scans at a time.", { field: "files" });
  const [peek] = await db.select().from(importJobs).where(and(eq(importJobs.id, UUID_RE.test(jobId) ? jobId : "00000000-0000-0000-0000-000000000000"), eq(importJobs.organizationId, ctx.organizationId))).limit(1);
  if (!peek || !ctx.allowedSiteIds.includes(peek.siteId)) throw new DomainError("not_found", "Import not found in your sites.");
  ctx.requireAt("platform.import_job.create", peek.siteId);
  ctx.requireAt("documents.file_attachment.create", peek.siteId);
  if (!getImportKind(peek.importKind).needsScans) throw new DomainError("validation", "This import kind takes no scans.");
  if (!["uploaded", "validated", "under_review", "failed"].includes(peek.status)) throw new DomainError("state", `Import ${peek.importNumber} is ${peek.status}; scans can no longer be added.`);
  const checked = files.map((f) => validateUpload(f));
  const names = new Set<string>();
  for (const f of checked) {
    const n = f.fileName.toLowerCase();
    if (names.has(n)) throw new DomainError("validation", `Two scans are named ${f.fileName}.`, { field: "files" });
    names.add(n);
  }
  const existing = await db
    .select({ name: fileAttachments.fileName })
    .from(fileAttachments)
    .where(and(eq(fileAttachments.entityType, "import_job"), eq(fileAttachments.entityId, peek.id), eq(fileAttachments.attachmentKind, "legacy_document"), isNull(fileAttachments.deletedAt)));
  const clash = existing.find((e) => names.has(e.name.toLowerCase()));
  if (clash) throw new DomainError("conflict", `A scan named ${clash.name} is already uploaded to this import.`, { field: "files" });
  const stored: { f: (typeof checked)[number]; obj: Awaited<ReturnType<typeof storeObject>> }[] = [];
  for (const f of checked) stored.push({ f, obj: await storeObject(ctx, f.bytes, f.contentType) });
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, ctx, jobId);
    for (const { f, obj } of stored) {
      await insertAttachment(tx, ctx, { ...obj, siteId: job.siteId, fileName: f.fileName, contentType: f.contentType, size: f.bytes.length, sha256: obj.sha256, entityType: "import_job", entityId: job.id, kind: "legacy_document" });
      await audit(tx, ctx, { action: "documents.file_attachment.uploaded", entityType: "file_attachment", entityId: obj.id, entityNumber: job.importNumber, siteId: job.siteId, after: { parent: "import_job", parentId: job.id, kind: "legacy_document", fileName: f.fileName, contentType: f.contentType, sizeBytes: f.bytes.length, sha256: obj.sha256 } });
    }
    return { uploaded: stored.length };
  });
}

export type { ImportJobRow };
