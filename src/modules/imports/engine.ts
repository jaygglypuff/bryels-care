import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { importJobRows, importJobs } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { notifyUsers } from "@/modules/platform/notifications";
import { insertAttachment, storeObject } from "./files";
import { getImportKind, type ImportKindHandler, type ImportJobRow } from "./kinds";
import { FILE_KEYS } from "./kinds/common";
import type { ExistingMatch, KindRunState, RowIssue } from "./kinds/types";
import { RowReader, normalisedName, type MappingDefinition } from "./kinds/values";
import { resultCsv } from "./outputs";

/**
 * The import engine (US-5-08, US-5-09, US-2-25): one implementation for the wizard and the loader.
 *
 * Validation (job phase `validate`, runs as the preparer):
 *   1. map every raw row through the job's mapping snapshot and the kind's row checks (§7);
 *   2. tier 1 duplicates within the file and against existing records are `duplicate` (skipped, create-only
 *      A-MIG-16); tier 2/3 candidates are `possible_duplicate` until the custodian decides (§8);
 *   3. dry run: every remaining row is created through the owning module's service inside a transaction that
 *      is rolled back (one savepoint per row), so validation applies exactly the rules of posting;
 *   4. results, counters, the error file and `platform.import_job.validated` are written.
 * Posting (phase `post`, runs as the poster with their current permissions): the rows not yet posted are
 * created in chunks (setting `platform.imports.chunk_size`, default 500) inside transactions, one savepoint
 * per row; a row's created entity is recorded in the same transaction, so a restart skips posted rows.
 */
const ROLLBACK = new Error("import dry run rollback");

type RowRec = typeof importJobRows.$inferSelect;
type Work = {
  row: RowRec;
  values: unknown;
  errors: RowIssue[];
  warnings: string[];
  result: "accepted" | "hold" | "duplicate" | "possible_duplicate" | "rejected" | "failed";
  tier1Key: string | null;
  groupKey: string | null;
  matchName: string | null;
  match: ExistingMatch | null;
  hold: boolean;
};

export function mappedRecord(raw: Record<string, string>, mapping: MappingDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, header] of Object.entries(mapping.columns)) out[key] = header ? (raw[header] ?? "") : "";
  return out;
}

/** Packs rows into chunks of about `size` rows without splitting a group (same group key). Pure. */
export function chunkByGroup<T extends { groupKey: string | null }>(items: T[], size: number): T[][] {
  const groups = new Map<string, T[]>();
  let anon = 0;
  for (const it of items) {
    const k = it.groupKey ?? `__row${anon++}`;
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  const chunks: T[][] = [];
  let cur: T[] = [];
  for (const g of groups.values()) {
    if (cur.length && cur.length + g.length > size) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(...g);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Turns a refused row into a message; permission and setup problems of the dry run are not row errors. */
function classify(e: unknown): { kind: "reject" | "unchecked"; message: string; field?: string } {
  if (e instanceof DomainError) {
    if (e.code === "forbidden" || e.code === "read_only" || e.code === "setup_required") return { kind: "unchecked", message: e.message };
    const field = typeof e.details?.field === "string" ? e.details.field : undefined;
    const issues = Array.isArray(e.details?.issues) ? (e.details.issues as { message: string }[]) : [];
    return { kind: "reject", message: issues.length > 1 ? issues.map((i) => i.message).join(" ") : e.message, field };
  }
  const cause = (e as { cause?: { code?: string; constraint_name?: string } })?.cause ?? (e as { code?: string; constraint_name?: string });
  if (cause?.code && /^23/.test(cause.code)) return { kind: "reject", message: `Refused by a database rule${cause.constraint_name ? ` (${cause.constraint_name})` : ""}: the record conflicts with existing data.` };
  throw e;
}

async function loadJob(q: typeof db | Tx, id: string) {
  const [job] = await q.select().from(importJobs).where(eq(importJobs.id, id)).limit(1);
  if (!job) throw new DomainError("not_found", "Import not found.");
  return job;
}

async function saveRows(q: typeof db | Tx, works: Work[]) {
  for (let i = 0; i < works.length; i += 1000) {
    const batch = works.slice(i, i + 1000).map((w) => ({
      id: w.row.id,
      result: w.result,
      error_message: w.errors.length ? w.errors.map((x) => x.message).join(" ") : null,
      errors: w.errors.length ? w.errors : null,
      warnings: w.warnings.length ? w.warnings : null,
      values: w.values ?? null,
      group_key: w.groupKey,
      duplicate_tier: w.match?.tier ?? null,
      match_entity_type: w.match?.entityType ?? null,
      match_entity_id: w.match?.entityId ?? null,
      match_label: w.match?.label ?? null,
      hold: w.hold,
    }));
    await q.execute(sql`
      update import_job_rows r set
        result = x.result, error_message = x.error_message, errors = x.errors, warnings = x.warnings, "values" = x."values",
        group_key = x.group_key, duplicate_tier = x.duplicate_tier, match_entity_type = x.match_entity_type,
        match_entity_id = x.match_entity_id, match_label = x.match_label, hold_on_post = x.hold, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as x(
        id uuid, result text, error_message text, errors jsonb, warnings jsonb, "values" jsonb, group_key text,
        duplicate_tier int, match_entity_type text, match_entity_id uuid, match_label text, hold boolean)
      where r.id = x.id`);
  }
}

async function counters(q: typeof db | Tx, jobId: string) {
  const [c] = await q.execute<Record<string, number>>(sql`
    select count(*)::int as total,
      count(*) filter (where result = 'accepted')::int as accepted,
      count(*) filter (where result = 'hold')::int as hold,
      count(*) filter (where result = 'duplicate')::int as duplicate,
      count(*) filter (where result = 'possible_duplicate')::int as possible,
      count(*) filter (where result = 'possible_duplicate' and decision is null)::int as undecided,
      count(*) filter (where result = 'rejected')::int as rejected,
      count(*) filter (where result = 'failed')::int as failed,
      count(*) filter (where warnings is not null)::int as warned,
      count(*) filter (where created_entity_id is not null)::int as created
    from import_job_rows where import_job_id = ${jobId}`);
  return c;
}

function counterColumns(c: Record<string, number>) {
  return {
    rowsTotal: c.total,
    rowsAccepted: c.accepted,
    rowsHold: c.hold,
    rowsDuplicate: c.duplicate,
    rowsPossibleDuplicate: c.possible,
    rowsRejected: c.rejected,
    rowsFailed: c.failed,
    rowsWarned: c.warned,
    rowsCreated: c.created,
  };
}

/** Error file (§9.3): every row that is not a plain accepted row, raw values plus outcome. Stored with the job. */
async function writeErrorFile(ctx: AuthContext, job: ImportJobRow) {
  const rows = await db
    .select()
    .from(importJobRows)
    .where(and(eq(importJobRows.importJobId, job.id), sql`(${importJobRows.result} <> 'accepted' or ${importJobRows.warnings} is not null)`))
    .orderBy(asc(importJobRows.rowNo));
  const body = resultCsv(
    job.headers as string[],
    rows.map((r) => ({ rowNo: r.rowNo, raw: r.raw as Record<string, string>, result: r.result, errorMessage: r.errorMessage, warnings: r.warnings as string[] | null, matchLabel: r.matchLabel, createdEntityLabel: r.createdEntityLabel })),
  );
  const obj = await storeObject(ctx, body, "text/csv");
  await insertAttachment(db, ctx, { ...obj, siteId: job.siteId, fileName: `${job.importNumber}-results-run${job.runNo}.csv`, contentType: "text/csv", size: body.length, sha256: obj.sha256, entityType: "import_job", entityId: job.id, kind: "import" });
  return obj.id;
}

function readRows(handler: ImportKindHandler, job: ImportJobRow, rows: RowRec[]): Work[] {
  const mapping = job.mapping as MappingDefinition;
  const labels = Object.fromEntries(handler.columns.map((c) => [c.key, c.label]));
  return rows.map((row) => {
    const reader = new RowReader(mappedRecord(row.raw as Record<string, string>, mapping), mapping, labels);
    const n = handler.normalize(reader);
    const ok = n && reader.errors.length === 0;
    return {
      row,
      values: n?.values ?? null,
      errors: n ? reader.errors : reader.errors.length ? reader.errors : [{ field: "row", message: "The row could not be read." }],
      warnings: [...reader.warnings],
      result: ok ? "accepted" : "rejected",
      tier1Key: n?.tier1Key ?? null,
      groupKey: n?.groupKey ?? null,
      matchName: n?.matchName ?? null,
      match: null,
      hold: false,
    };
  });
}

/** Duplicate tiers within the file and against existing records (§8), honouring stored decisions. */
async function applyDuplicates(handler: ImportKindHandler, ctx: AuthContext, job: ImportJobRow, works: Work[]) {
  const live = works.filter((w) => w.result === "accepted");
  const seen = new Map<string, Work>();
  const names = new Map<string, Work>();
  for (const w of live) {
    if (w.tier1Key) {
      const first = seen.get(w.tier1Key);
      if (first) {
        w.result = "duplicate";
        w.match = { tier: 1, entityType: "import_job_row", entityId: first.row.id, label: `row ${first.row.rowNo}`, message: `Same record as row ${first.row.rowNo} of this file; skipped.` };
        w.warnings.push(w.match.message);
        continue;
      }
      seen.set(w.tier1Key, w);
    }
    if (w.matchName) {
      const n = normalisedName(w.matchName);
      const first = n ? names.get(n) : undefined;
      if (first) w.match = { tier: 2, entityType: "import_job_row", entityId: first.row.id, label: `row ${first.row.rowNo}`, message: `Possible duplicate of row ${first.row.rowNo} of this file (same name). Decide "new record" or "reject".` };
      else if (n) names.set(n, w);
    }
  }
  if (handler.fileChecks) {
    const extra = handler.fileChecks(live.filter((w) => w.result === "accepted").map((w) => ({ rowNo: w.row.rowNo, values: w.values as never })));
    for (const w of live) for (const m of extra.get(w.row.rowNo) ?? []) w.warnings.push(m);
  }
  if (handler.findExisting) {
    const cand = live.filter((w) => w.result === "accepted");
    const found = await handler.findExisting(db, ctx, job, cand.map((w) => ({ rowNo: w.row.rowNo, values: w.values as never })));
    for (const w of cand) {
      const m = found.get(w.row.rowNo);
      if (!m) continue;
      w.match = m;
      if (m.tier === 1) {
        w.result = "duplicate";
        w.warnings.push(m.message);
      }
    }
  }
  for (const w of live) {
    if (w.result !== "accepted" || !w.match || w.match.tier === 1) continue;
    const d = w.row.decision;
    const sameCandidate = w.row.matchEntityId === w.match.entityId;
    if (d && sameCandidate) {
      if (d === "same_as_existing") w.result = "duplicate";
      else if (d === "reject") w.result = "rejected";
      if (w.result === "rejected" && !w.errors.length) w.errors.push({ field: "row", message: `Rejected by the custodian's duplicate decision${w.row.decisionNote ? `: ${w.row.decisionNote}` : ""}.` });
    } else {
      w.result = "possible_duplicate";
      w.warnings.push(w.match.message);
    }
  }
}

async function runChunk(handler: ImportKindHandler, ctx: AuthContext, job: ImportJobRow, chunk: Work[], dryRun: boolean, fileKeys: Set<string>) {
  const state: KindRunState = new Map([[FILE_KEYS, fileKeys]]);
  const outcomes = new Map<string, { ok: true; entityType: string; entityId: string; label: string; hold: boolean; warnings: string[] } | { ok: false; kind: "reject" | "unchecked"; message: string; field?: string }>();
  const body = async (tx: Tx) => {
    for (const w of chunk) {
      try {
        const created = await tx.transaction((sp) => handler.create({ ctx, tx: sp, job, row: { id: w.row.id, rowNo: w.row.rowNo }, dryRun, state }, w.values as never));
        outcomes.set(w.row.id, { ok: true, entityType: created.entityType, entityId: created.entityId, label: created.label, hold: !!created.hold, warnings: created.warnings ?? [] });
        if (!dryRun) {
          await tx
            .update(importJobRows)
            .set({ createdEntityType: created.entityType, createdEntityId: created.entityId, createdEntityLabel: created.label, postedAt: new Date(), result: created.hold ? "hold" : "accepted", holdOnPost: !!created.hold, updatedAt: new Date() })
            .where(eq(importJobRows.id, w.row.id));
        }
      } catch (e) {
        const c = classify(e);
        outcomes.set(w.row.id, { ok: false, ...c });
        if (!dryRun) {
          await tx
            .update(importJobRows)
            .set({ result: "failed", errorMessage: c.message, errors: [{ field: c.field ?? "row", message: c.message }], updatedAt: new Date() })
            .where(eq(importJobRows.id, w.row.id));
        }
      }
    }
    if (dryRun) throw ROLLBACK;
  };
  try {
    await db.transaction(body);
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return outcomes;
}

export async function runValidation(ctx: AuthContext, importJobId: string, runNo: number) {
  const job = await loadJob(db, importJobId);
  if (job.status !== "validating" || job.runNo !== runNo) return { skipped: true, reason: `job is ${job.status} (run ${job.runNo})` };
  ctx.requireSite(job.siteId);
  const handler = getImportKind(job.importKind);
  if (!job.mapping) throw new DomainError("validation", "Map the columns before validating.");
  const rows = await db.select().from(importJobRows).where(eq(importJobRows.importJobId, job.id)).orderBy(asc(importJobRows.rowNo));
  const works = readRows(handler, job, rows);
  await applyDuplicates(handler, ctx, job, works);

  // Dry run of every row that would post (accepted and undecided possible duplicates).
  const chunkSize = await getSetting(db, ctx.organizationId, "platform.imports.chunk_size");
  const dry = works.filter((w) => w.result === "accepted" || w.result === "possible_duplicate");
  const fileKeys = new Set(works.map((w) => w.tier1Key).filter((k): k is string => !!k));
  let unchecked: string | null = null;
  for (const chunk of chunkByGroup(dry, chunkSize)) {
    const out = await runChunk(handler, ctx, job, chunk, true, fileKeys);
    for (const w of chunk) {
      const o = out.get(w.row.id);
      if (!o) continue;
      if (o.ok) {
        w.hold = o.hold;
        if (w.result === "accepted" && o.hold) w.result = "hold";
        w.warnings.push(...o.warnings);
      } else if (o.kind === "unchecked") {
        unchecked ??= o.message;
        w.warnings.push(`Posting rules not checked for you: ${o.message} The poster's permissions are checked when the import is posted.`);
      } else {
        w.result = "rejected";
        w.errors.push({ field: o.field ?? "row", message: o.message });
      }
    }
  }
  await saveRows(db, works);
  const fileId = await writeErrorFile(ctx, job);
  const c = await counters(db, job.id);
  const status = c.undecided > 0 ? "under_review" : "validated";
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(importJobs).where(eq(importJobs.id, job.id)).for("update");
    if (locked.status !== "validating" || locked.runNo !== runNo) return;
    await tx.update(importJobs).set({ ...counterColumns(c), status, validatedAt: new Date(), errorFileAttachmentId: fileId, failureMessage: null, updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, {
      action: "platform.import_job.validated",
      entityType: "import_job",
      entityId: job.id,
      entityNumber: job.importNumber,
      siteId: job.siteId,
      before: { status: "validating" },
      after: { status, runNo, kind: job.importKind, mappingId: job.importMappingId, counts: c, permissionNote: unchecked },
    });
    await notifyUsers(tx, [job.uploadedBy], {
      organizationId: job.organizationId,
      siteId: job.siteId,
      kind: "import_validated",
      severity: c.rejected > 0 || c.undecided > 0 ? "warning" : "info",
      title: `Import ${job.importNumber} validated`,
      body: `${c.accepted + c.hold} rows ready, ${c.duplicate} duplicates, ${c.possible} possible duplicates, ${c.rejected} rejected.`,
      entityType: "import_job",
      entityId: job.id,
      link: `/admin/imports/${job.id}`,
      dedupeKey: `import:${job.id}:validated:${runNo}`,
    });
  });
  return { status, counts: c };
}

export async function runPosting(ctx: AuthContext, importJobId: string, runNo: number) {
  const job = await loadJob(db, importJobId);
  if (job.status !== "posting" || job.runNo !== runNo) return { skipped: true, reason: `job is ${job.status} (run ${job.runNo})` };
  ctx.requireSite(job.siteId);
  const handler = getImportKind(job.importKind);
  ctx.require("platform.import_job.post");
  for (const p of handler.entityPermissions) ctx.require(p);
  const rows = await db.select().from(importJobRows).where(eq(importJobRows.importJobId, job.id)).orderBy(asc(importJobRows.rowNo));
  // Rows already posted are skipped (resumable); rows that failed before are tried again.
  const pending = rows.filter((r) => !r.createdEntityId && (r.result === "accepted" || r.result === "hold" || r.result === "failed"));
  const works: Work[] = readRows(handler, job, pending).map((w) => ({ ...w, result: w.errors.length ? "rejected" : "accepted" }));
  // Records created since validation (another import, a screen) turn a row into a duplicate instead of a failure.
  if (handler.findExisting) {
    const found = await handler.findExisting(db, ctx, job, works.filter((w) => w.result === "accepted").map((w) => ({ rowNo: w.row.rowNo, values: w.values as never })));
    for (const w of works) {
      const m = found.get(w.row.rowNo);
      if (m?.tier === 1) {
        w.result = "duplicate";
        w.match = m;
        w.warnings.push(m.message);
      }
    }
  }
  const fileKeys = new Set(readRows(handler, job, rows).map((w) => w.tier1Key).filter((k): k is string => !!k));
  const skipped = works.filter((w) => w.result !== "accepted");
  if (skipped.length) await saveRows(db, skipped);
  const chunkSize = await getSetting(db, ctx.organizationId, "platform.imports.chunk_size");
  for (const chunk of chunkByGroup(works.filter((w) => w.result === "accepted"), chunkSize)) {
    const [fresh] = await db.select({ status: importJobs.status, runNo: importJobs.runNo }).from(importJobs).where(eq(importJobs.id, job.id));
    if (fresh.status !== "posting" || fresh.runNo !== runNo) return { skipped: true, reason: "the posting run was superseded" };
    await runChunk(handler, ctx, job, chunk, false, fileKeys);
  }
  // "Same as existing" decisions: link the alias (materials) once.
  if (handler.linkToExisting) {
    const linked = rows.filter((r) => r.decision === "same_as_existing" && r.matchEntityId && r.matchEntityType !== "import_job_row" && !r.postedAt);
    for (const r of linked) {
      await db.transaction(async (tx) => {
        const w = readRows(handler, job, [r])[0];
        if (!w.values) return;
        await handler.linkToExisting!({ ctx, tx, job, row: { id: r.id, rowNo: r.rowNo }, dryRun: false, state: new Map() }, w.values as never, { entityType: r.matchEntityType!, entityId: r.matchEntityId! });
        await tx.update(importJobRows).set({ createdEntityType: r.matchEntityType, createdEntityId: r.matchEntityId, createdEntityLabel: r.matchLabel, postedAt: new Date(), updatedAt: new Date() }).where(eq(importJobRows.id, r.id));
      });
    }
  }
  const c = await counters(db, job.id);
  const fileId = await writeErrorFile(ctx, job);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(importJobs).where(eq(importJobs.id, job.id)).for("update");
    if (locked.status !== "posting" || locked.runNo !== runNo) return;
    const now = new Date();
    await tx.update(importJobs).set({ ...counterColumns(c), status: "posted", postedAt: now, postedBy: ctx.userId, errorFileAttachmentId: fileId, failureMessage: c.failed ? `${c.failed} row(s) failed at posting; see the results file.` : null, updatedAt: now }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, {
      action: "platform.import_job.posted",
      entityType: "import_job",
      entityId: job.id,
      entityNumber: job.importNumber,
      siteId: job.siteId,
      before: { status: "posting" },
      after: { status: "posted", runNo, kind: job.importKind, counts: c, checksum: job.checksumSha256, mappingId: job.importMappingId, source: job.source },
    });
    await notifyUsers(tx, [...new Set([job.uploadedBy, ctx.userId])], {
      organizationId: job.organizationId,
      siteId: job.siteId,
      kind: c.failed ? "failed_import" : "import_posted",
      severity: c.failed ? "warning" : "info",
      title: `Import ${job.importNumber} posted`,
      body: `${c.created} records created, ${c.duplicate} duplicates skipped, ${c.failed} failed.`,
      entityType: "import_job",
      entityId: job.id,
      link: `/admin/imports/${job.id}`,
      dedupeKey: `import:${job.id}:posted:${runNo}`,
    });
  });
  return { status: "posted", counts: c };
}

/** Marks a job failed after its background run gave up (called by the job handler). */
export async function markRunFailed(ctx: AuthContext, importJobId: string, runNo: number, message: string) {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, importJobId)).for("update");
    if (!job || job.runNo !== runNo || (job.status !== "validating" && job.status !== "posting")) return;
    await tx.update(importJobs).set({ status: "failed", failureMessage: message.slice(0, 1000), updatedAt: new Date() }).where(eq(importJobs.id, job.id));
    await audit(tx, ctx, { action: "platform.import_job.failed", entityType: "import_job", entityId: job.id, entityNumber: job.importNumber, siteId: job.siteId, reason: message.slice(0, 500), before: { status: job.status }, after: { status: "failed", runNo } });
    await notifyUsers(tx, [job.uploadedBy], {
      organizationId: job.organizationId,
      siteId: job.siteId,
      kind: "failed_import",
      severity: "critical",
      title: `Import ${job.importNumber} failed`,
      body: message.slice(0, 500),
      entityType: "import_job",
      entityId: job.id,
      link: `/admin/imports/${job.id}`,
      dedupeKey: `import:${job.id}:failed:${runNo}`,
    });
  });
}
