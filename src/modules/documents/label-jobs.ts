import "server-only";
import { and, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx } from "@/db/client";
import { documentTemplateVersions, documentTemplates, generatedDocuments, labelJobs, labelTemplates, printStations, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelEntity, type LabelEntity } from "./datasets";
import { insertAndRender, markDocumentVoid, parseReprint, renderForDisplay, renderInTx } from "./generated";
import { approvedLabelTemplatesFor, fieldKeys, loadPrintableTemplate } from "./label-templates";
import type { LabelData } from "./renderers/label-v1";
import { shortHash, STATUS_WORD } from "./renderers/shared";
import type { FrozenDataset } from "./renderers/types";
import { createLabelJobInput } from "./schemas";
import { activeStationsAt } from "./stations";
import { isUuid } from "./templates";

/**
 * Label jobs, print station queue and controlled reprint (US-2-12; docs/reports-and-templates.md
 * §8.5). Lifecycle: queued → rendering → ready → printed; failed ↔ ready (retry keeps the same
 * job identity); queued/ready/failed → cancelled. A printed label that no longer matches its
 * record is voided (never deleted) and shown on the scan card as "superseded label — destroy".
 */

export type LabelJobRow = typeof labelJobs.$inferSelect;
const LIVE = ["queued", "rendering", "ready", "printed"] as const;

function setupRequired(siteCode: string) {
  return new DomainError("state", `Label printing isn't set up for ${siteCode} yet. Ask an administrator to add a print station.`, { setup: "print_station" });
}

async function siteCodeOf(tx: DbOrTx, siteId: string) {
  const [s] = await tx.select({ code: sites.code }).from(sites).where(eq(sites.id, siteId)).limit(1);
  return s?.code ?? "this site";
}

/** What the "Print label" form needs: the record, approved templates, stations and label history. */
export async function labelRequestOptions(ctx: AuthContext, entityType: string, entityId: string) {
  ctx.require("inventory.label_job.create");
  const e = await labelEntity(ctx, entityType, entityId);
  const [templates, stations, history] = await Promise.all([
    approvedLabelTemplatesFor(db, ctx.organizationId, e.siteId, e.appliesTo),
    activeStationsAt(db, ctx.organizationId, e.siteId),
    labelHistory(ctx, entityType, entityId),
  ]);
  return {
    entity: { type: e.entityType, id: e.entityId, number: e.number, appliesTo: e.appliesTo, state: e.state, siteId: e.siteId, siteCode: await siteCodeOf(db, e.siteId), caption: e.entity.caption, name: e.entity.itemName ?? e.entity.locationName ?? null },
    templates: templates.map((t) => ({ id: t.id, code: t.code, name: t.name, symbology: t.symbology, media: `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm`, copiesDefault: t.copiesDefault })),
    stations: stations.map((s) => ({ id: s.id, code: s.code, name: s.name, printerName: s.printerName })),
    history,
    isCurrentSite: e.siteId === ctx.currentSiteId,
  };
}

function buildLabelData(e: LabelEntity, t: typeof labelTemplates.$inferSelect, copies: number): LabelData {
  return {
    label: {
      code: t.code,
      appliesTo: t.appliesTo,
      symbology: t.symbology as LabelData["label"]["symbology"],
      mediaWidthMm: Number(t.mediaWidthMm),
      mediaHeightMm: Number(t.mediaHeightMm),
      dpi: t.dpi,
      fields: fieldKeys(t.fields),
    },
    copies,
    entity: e.entity,
  };
}

/**
 * Creates a label job for a lot or location and renders it for the station.
 * - Idempotent on `idempotencyKey` (a double tap returns the first job).
 * - A second label with unchanged content must be a reprint (reason + audit), not a new job.
 * - When the content changed (status at print differs), the previous labels are voided as superseded.
 */
export async function createLabelJob(ctx: AuthContext, raw: unknown) {
  ctx.require("inventory.label_job.create");
  const input = createLabelJobInput.parse(raw);
  const key = `label:${input.idempotencyKey}`;
  const [replay] = await db.select().from(labelJobs).where(and(eq(labelJobs.organizationId, ctx.organizationId), eq(labelJobs.idempotencyKey, key))).limit(1);
  if (replay) {
    ctx.requireSite(replay.siteId);
    return { jobId: replay.id, status: replay.status, replayed: true };
  }
  const e = await labelEntity(ctx, input.entityType, input.entityId);
  ctx.requireSite(e.siteId);
  if (e.siteId !== ctx.currentSiteId) throw new DomainError("state", "This record is at another of your sites. Switch site to print its label there.");

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`labeljob:${e.entityType}:${e.entityId}`}))`);
    const [again] = await tx.select().from(labelJobs).where(and(eq(labelJobs.organizationId, ctx.organizationId), eq(labelJobs.idempotencyKey, key))).limit(1);
    if (again) return { jobId: again.id, status: again.status, replayed: true };

    const stations = await activeStationsAt(tx, ctx.organizationId, e.siteId);
    if (stations.length === 0) throw setupRequired(await siteCodeOf(tx, e.siteId));
    const station = input.printStationId ? stations.find((s) => s.id === input.printStationId) : stations.length === 1 ? stations[0] : null;
    if (!station) throw new DomainError("validation", "Choose the print station that should print this label.", { field: "printStationId" });

    const { template, layout, version } = await loadPrintableTemplate(tx, ctx, input.labelTemplateId, e.appliesTo, e.siteId);

    // Existing live labels for the same record and template.
    const live = await tx
      .select({ j: labelJobs, state: generatedDocuments.sourceState, doc: generatedDocuments })
      .from(labelJobs)
      .leftJoin(generatedDocuments, eq(generatedDocuments.id, labelJobs.generatedDocumentId))
      .where(and(eq(labelJobs.entityType, e.entityType), eq(labelJobs.entityId, e.entityId), eq(labelJobs.labelTemplateId, template.id), inArray(labelJobs.status, [...LIVE]), isNull(labelJobs.voidedAt)))
      .for("update", { of: labelJobs });
    const same = live.find((r) => r.state === e.state);
    if (same) {
      throw new DomainError(
        "conflict",
        same.j.status === "printed"
          ? `A ${template.code} label for ${e.number} was already printed with the same content. Use Reprint and give a reason.`
          : `A ${template.code} label for ${e.number} is already waiting at the print station. Print that one, or cancel it first.`,
        { existingJobId: same.j.id },
      );
    }

    const jobId = uuidv7();
    await tx.insert(labelJobs).values({
      id: jobId,
      organizationId: ctx.organizationId,
      siteId: e.siteId,
      labelTemplateId: template.id,
      documentTemplateVersionId: version.id,
      printStationId: station.id,
      entityType: e.entityType,
      entityId: e.entityId,
      entityNumber: e.number,
      copies: input.copies,
      status: "rendering",
      printerName: station.printerName,
      idempotencyKey: key,
      requestedBy: ctx.userId,
      attempts: 1,
    });
    const doc = await insertAndRender(tx, ctx, {
      version,
      template: layout,
      documentKind: "label",
      source: { type: e.entityType, id: e.entityId, revisionAt: e.revisionAt, state: e.state },
      siteId: e.siteId,
      data: buildLabelData(e, template, input.copies),
      watermark: null,
      parameters: { labelJobId: jobId, labelTemplateCode: template.code, copies: input.copies },
      traceRef: shortHash(jobId),
    });
    const status = doc.status === "ready" ? "ready" : "failed";
    await tx.update(labelJobs).set({ status, generatedDocumentId: doc.id, errorMessage: doc.errorMessage }).where(eq(labelJobs.id, jobId));
    await audit(tx, ctx, {
      action: "documents.label_job.created",
      entityType: "label_job",
      entityId: jobId,
      entityNumber: e.number,
      siteId: e.siteId,
      after: { template: template.code, copies: input.copies, station: station.code, status, statusAtPrint: e.state, documentNumber: doc.documentNumber },
    });

    // Content changed since earlier labels: those labels are now wrong and must be destroyed.
    for (const r of live) {
      const was = r.state ? STATUS_WORD[r.state] ?? r.state : "unknown";
      const now = e.state ? STATUS_WORD[e.state] ?? e.state : "unknown";
      if (r.j.status === "printed") {
        await voidJobInTx(tx, ctx, r.j, `Superseded by a new label: status at print changed from ${was} to ${now}.`);
      } else {
        await tx.update(labelJobs).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date() }).where(eq(labelJobs.id, r.j.id));
        await audit(tx, ctx, { action: "documents.label_job.cancelled", entityType: "label_job", entityId: r.j.id, entityNumber: r.j.entityNumber, siteId: r.j.siteId, reason: `Superseded by job ${shortHash(jobId)} before printing.` });
      }
      if (r.doc && r.doc.status === "ready") await markDocumentVoid(tx, ctx, r.doc, `Superseded by ${doc.documentNumber}`, doc.id);
    }
    return { jobId, status, documentNumber: doc.documentNumber, replayed: false };
  });
}

/** Creates one job per lot of a goods receipt (W01-07). Each lot keeps its own idempotency key. */
export async function createLabelJobsForLots(ctx: AuthContext, lots: { lotId: string }[], labelTemplateId: string, copies: number, keyBase: string, printStationId?: string | null) {
  const out: { lotId: string; jobId?: string; error?: string }[] = [];
  for (const l of lots) {
    try {
      const r = await createLabelJob(ctx, { labelTemplateId, entityType: "inventory_lot", entityId: l.lotId, copies, printStationId, idempotencyKey: `${keyBase}:${l.lotId}` });
      out.push({ lotId: l.lotId, jobId: r.jobId });
    } catch (e) {
      if (e instanceof DomainError && (e.code === "forbidden" || (e.code === "state" && e.details?.setup))) throw e;
      out.push({ lotId: l.lotId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

async function loadJob(tx: DbOrTx, ctx: AuthContext, jobId: string, lock = false) {
  if (!isUuid(jobId)) throw new DomainError("not_found", "Label job not found in your sites.");
  const q = tx.select().from(labelJobs).where(and(eq(labelJobs.id, jobId), eq(labelJobs.organizationId, ctx.organizationId))).limit(1);
  const [j] = lock ? await q.for("update") : await q;
  if (!j || !ctx.allowedSiteIds.includes(j.siteId)) throw new DomainError("not_found", "Label job not found in your sites.");
  return j;
}

/** Station: the job was sent to the printer ("printed" = sent; browsers cannot confirm paper output). */
export async function markLabelJobPrinted(ctx: AuthContext, jobId: string) {
  ctx.require("inventory.label_job.create");
  return db.transaction(async (tx) => {
    const j = await loadJob(tx, ctx, jobId, true);
    if (j.status === "printed") return { status: "printed" as const, replayed: true };
    if (j.status !== "ready") throw new DomainError("state", `This job is ${j.status}; only a ready job can be marked printed.`);
    const [st] = await tx.select().from(printStations).where(eq(printStations.id, j.printStationId)).limit(1);
    await tx.update(labelJobs).set({ status: "printed", printedBy: ctx.userId, printedAt: new Date(), printerName: st?.printerName ?? j.printerName, errorMessage: null }).where(eq(labelJobs.id, j.id));
    await audit(tx, ctx, { action: "documents.label_job.printed", entityType: "label_job", entityId: j.id, entityNumber: j.entityNumber, siteId: j.siteId, after: { copies: j.copies, station: st?.code, printer: st?.printerName, reprintNo: j.reprintNo || undefined } });
    return { status: "printed" as const, replayed: false };
  });
}

/** Station: the printer failed (jam, out of labels). The job stays retryable with the same identity. */
export async function markLabelJobFailed(ctx: AuthContext, jobId: string, message: string) {
  ctx.require("inventory.label_job.create");
  const msg = message?.trim();
  if (!msg || msg.length < 3) throw new DomainError("validation", "Say what went wrong (for example: printer out of labels).", { field: "message" });
  return db.transaction(async (tx) => {
    const j = await loadJob(tx, ctx, jobId, true);
    if (j.status !== "ready") throw new DomainError("state", `This job is ${j.status}; only a ready job can be marked failed.`);
    await tx.update(labelJobs).set({ status: "failed", errorMessage: msg.slice(0, 300) }).where(eq(labelJobs.id, j.id));
    await audit(tx, ctx, { action: "documents.label_job.failed", entityType: "label_job", entityId: j.id, entityNumber: j.entityNumber, siteId: j.siteId, reason: msg.slice(0, 300) });
  });
}

/** Retry: re-renders when the render failed, otherwise returns the job to ready. Same job, same label identity. */
export async function retryLabelJob(ctx: AuthContext, jobId: string) {
  ctx.require("inventory.label_job.create");
  return db.transaction(async (tx) => {
    const j = await loadJob(tx, ctx, jobId, true);
    if (j.status !== "failed") throw new DomainError("state", `This job is ${j.status}; only a failed job can be retried.`);
    let status: "ready" | "failed" = "ready";
    let error: string | null = null;
    if (j.generatedDocumentId) {
      const doc = await renderInTx(tx, ctx, j.generatedDocumentId);
      status = doc.status === "ready" ? "ready" : "failed";
      error = doc.errorMessage;
    }
    await tx.update(labelJobs).set({ status, errorMessage: error, attempts: j.attempts + 1 }).where(eq(labelJobs.id, j.id));
    await audit(tx, ctx, { action: "documents.label_job.retried", entityType: "label_job", entityId: j.id, entityNumber: j.entityNumber, siteId: j.siteId, after: { status, attempts: j.attempts + 1 } });
    return { status };
  });
}

export async function cancelLabelJob(ctx: AuthContext, jobId: string) {
  ctx.require("inventory.label_job.create");
  return db.transaction(async (tx) => {
    const j = await loadJob(tx, ctx, jobId, true);
    if (!["queued", "ready", "failed"].includes(j.status)) throw new DomainError("state", `This job is ${j.status} and can no longer be cancelled.`);
    await tx.update(labelJobs).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date() }).where(eq(labelJobs.id, j.id));
    if (j.generatedDocumentId) {
      const [doc] = await tx.select().from(generatedDocuments).where(eq(generatedDocuments.id, j.generatedDocumentId)).limit(1);
      if (doc && doc.status !== "void") await markDocumentVoid(tx, ctx, doc, "Label job cancelled before printing");
    }
    await audit(tx, ctx, { action: "documents.label_job.cancelled", entityType: "label_job", entityId: j.id, entityNumber: j.entityNumber, siteId: j.siteId });
  });
}

/**
 * Controlled reprint (T-06): reason required (422 without; `other` needs a note), the new job links
 * reprint_of_id to the original, prints "REPRINT n", and writes documents.label_job.reprinted.
 * A reprint reproduces the frozen content, so it is refused when the record's status changed:
 * then a new label is needed instead.
 */
export async function reprintLabelJob(ctx: AuthContext, jobId: string, raw: unknown) {
  ctx.require("documents.reprint.create");
  ctx.require("inventory.label_job.create");
  const input = await parseReprint(db, ctx.organizationId, raw);
  const key = `label-reprint:${input.idempotencyKey}`;
  // Read the record's current state before the transaction (scoped read through the inventory
  // module), so the transaction never waits on a second pool connection.
  const target = await loadJob(db, ctx, jobId);
  const current = await labelEntity(ctx, target.entityType, target.entityId);
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(labelJobs).where(and(eq(labelJobs.organizationId, ctx.organizationId), eq(labelJobs.idempotencyKey, key))).limit(1);
    if (replay) return { jobId: replay.id, reprintNo: replay.reprintNo, replayed: true };
    const j = await loadJob(tx, ctx, jobId, true);
    const root = j.reprintOfId ? await loadJob(tx, ctx, j.reprintOfId, true) : j;
    if (root.voidedAt) throw new DomainError("state", "This label was voided as superseded; print a new label instead of reprinting it.");
    if (root.status !== "printed") throw new DomainError("state", "Only a printed label can be reprinted. Print the original first.");
    if (!root.generatedDocumentId) throw new DomainError("state", "The original label has no rendered document.");
    const [rootDoc] = await tx.select().from(generatedDocuments).where(eq(generatedDocuments.id, root.generatedDocumentId)).limit(1);
    // The current content must still match what the original printed (status at print).
    if (current.state !== rootDoc.sourceState) {
      throw new DomainError("state", `The status changed since this label was printed (${STATUS_WORD[rootDoc.sourceState ?? ""] ?? rootDoc.sourceState} → ${STATUS_WORD[current.state ?? ""] ?? current.state}). Print a new label instead; the old one will be listed as superseded.`);
    }
    const stations = await activeStationsAt(tx, ctx.organizationId, root.siteId);
    if (stations.length === 0) throw setupRequired(await siteCodeOf(tx, root.siteId));
    const station = stations.find((s) => s.id === root.printStationId) ?? stations[0];
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(labelJobs).where(eq(labelJobs.reprintOfId, root.id));
    const reprintNo = (c?.n ?? 0) + 1;
    const copies = input.copies ?? 1;
    const newId = uuidv7();
    const frozen = rootDoc.dataset as FrozenDataset<LabelData>;
    await tx.insert(labelJobs).values({
      id: newId,
      organizationId: ctx.organizationId,
      siteId: root.siteId,
      labelTemplateId: root.labelTemplateId,
      documentTemplateVersionId: root.documentTemplateVersionId,
      printStationId: station.id,
      entityType: root.entityType,
      entityId: root.entityId,
      entityNumber: root.entityNumber,
      copies,
      status: "rendering",
      printerName: station.printerName,
      reprintOfId: root.id,
      reprintNo,
      reprintReasonCode: input.reason.code,
      reprintNote: input.note,
      idempotencyKey: key,
      requestedBy: ctx.userId,
      attempts: 1,
    });
    const [version] = await tx.select().from(documentTemplateVersions).where(eq(documentTemplateVersions.id, root.documentTemplateVersionId)).limit(1);
    const [layoutRow] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, version.documentTemplateId)).limit(1);
    const doc = await insertAndRender(tx, ctx, {
      version,
      template: layoutRow,
      documentKind: "label",
      source: { type: rootDoc.sourceEntityType, id: rootDoc.sourceEntityId, revisionAt: rootDoc.sourceRevisionAt, state: rootDoc.sourceState },
      siteId: root.siteId,
      data: { ...frozen.data, copies },
      watermark: null,
      parameters: { labelJobId: newId, reprintOfJobId: root.id, copies },
      traceRef: shortHash(root.id),
      reprint: { root: rootDoc, reasonCode: input.reason.code, note: input.note },
    });
    const status = doc.status === "ready" ? "ready" : "failed";
    await tx.update(labelJobs).set({ status, generatedDocumentId: doc.id, errorMessage: doc.errorMessage }).where(eq(labelJobs.id, newId));
    await audit(tx, ctx, {
      action: "documents.label_job.reprinted",
      entityType: "label_job",
      entityId: newId,
      entityNumber: root.entityNumber,
      siteId: root.siteId,
      reason: [input.reason.code, input.note].filter(Boolean).join(": "),
      after: { reprintOfJobId: root.id, reprintNo, copies, documentNumber: doc.documentNumber },
    });
    return { jobId: newId, reprintNo, status, replayed: false };
  });
}

/**
 * W3E (US-4-08 repack, box removal): in the caller's transaction, voids every printed label of a
 * record that no longer matches it ("superseded label — destroy") and cancels jobs not yet printed.
 */
export async function voidLabelsForEntityInTx(tx: DbOrTx, ctx: AuthContext, entityType: string, entityId: string, reason: string) {
  const live = await tx
    .select({ j: labelJobs, doc: generatedDocuments })
    .from(labelJobs)
    .leftJoin(generatedDocuments, eq(generatedDocuments.id, labelJobs.generatedDocumentId))
    .where(and(eq(labelJobs.organizationId, ctx.organizationId), eq(labelJobs.entityType, entityType), eq(labelJobs.entityId, entityId), inArray(labelJobs.status, [...LIVE]), isNull(labelJobs.voidedAt)))
    .for("update", { of: labelJobs });
  for (const r of live) {
    if (r.j.status === "printed") await voidJobInTx(tx, ctx, r.j, reason);
    else {
      await tx.update(labelJobs).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date() }).where(eq(labelJobs.id, r.j.id));
      await audit(tx, ctx, { action: "documents.label_job.cancelled", entityType: "label_job", entityId: r.j.id, entityNumber: r.j.entityNumber, siteId: r.j.siteId, reason });
    }
    if (r.doc && r.doc.status === "ready") await markDocumentVoid(tx, ctx, r.doc, reason);
  }
  return live.length;
}

async function voidJobInTx(tx: DbOrTx, ctx: AuthContext, j: LabelJobRow, reason: string) {
  await tx.update(labelJobs).set({ voidedAt: new Date(), voidedBy: ctx.userId, voidReason: reason }).where(eq(labelJobs.id, j.id));
  await audit(tx, ctx, { action: "documents.label_job.voided", entityType: "label_job", entityId: j.id, entityNumber: j.entityNumber, siteId: j.siteId, reason });
}

/** Voids a printed label that no longer matches its record (repack, split, wrong content). */
export async function voidLabelJob(ctx: AuthContext, jobId: string, reason: string) {
  ctx.require("documents.generated_document.void");
  const r = reason?.trim();
  if (!r || r.length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const j = await loadJob(tx, ctx, jobId, true);
    if (j.voidedAt) throw new DomainError("state", "This label is already voided.");
    if (j.status !== "printed") throw new DomainError("state", "Only a printed label can be voided; cancel a job that has not printed yet.");
    await voidJobInTx(tx, ctx, j, r);
    if (j.generatedDocumentId) {
      const [doc] = await tx.select().from(generatedDocuments).where(eq(generatedDocuments.id, j.generatedDocumentId)).limit(1);
      if (doc && doc.status === "ready") await markDocumentVoid(tx, ctx, doc, r);
    }
  });
}

const requester = alias(users, "requester");
const printer = alias(users, "printer_user");

const jobColumns = {
  j: labelJobs,
  templateCode: labelTemplates.code,
  media: sql<string>`${labelTemplates.mediaWidthMm}::float || ' × ' || ${labelTemplates.mediaHeightMm}::float || ' mm'`,
  stationCode: printStations.code,
  stationName: printStations.name,
  requestedByName: requester.displayName,
  printedByName: printer.displayName,
  documentNumber: generatedDocuments.documentNumber,
  statusAtPrint: generatedDocuments.sourceState,
};

function jobsQuery() {
  return db
    .select(jobColumns)
    .from(labelJobs)
    .innerJoin(labelTemplates, eq(labelTemplates.id, labelJobs.labelTemplateId))
    .innerJoin(printStations, eq(printStations.id, labelJobs.printStationId))
    .innerJoin(requester, eq(requester.id, labelJobs.requestedBy))
    .leftJoin(printer, eq(printer.id, labelJobs.printedBy))
    .leftJoin(generatedDocuments, eq(generatedDocuments.id, labelJobs.generatedDocumentId));
}

type JobListRow = Awaited<ReturnType<ReturnType<typeof jobsQuery>["where"]>>[number];
const flat = (r: JobListRow) => ({ ...r.j, templateCode: r.templateCode, media: r.media, stationCode: r.stationCode, stationName: r.stationName, requestedByName: r.requestedByName, printedByName: r.printedByName, documentNumber: r.documentNumber, statusAtPrint: r.statusAtPrint });
export type LabelJobView = ReturnType<typeof flat>;

/** The station queue: jobs to print (ready/failed/rendering) plus the last 24 h of printed ones. */
export async function stationQueue(ctx: AuthContext, stationId: string) {
  ctx.require("inventory.label_job.view");
  if (!isUuid(stationId)) throw new DomainError("not_found", "Print station not found in your sites.");
  const [st] = await db.select().from(printStations).where(and(eq(printStations.id, stationId), eq(printStations.organizationId, ctx.organizationId))).limit(1);
  if (!st || !ctx.allowedSiteIds.includes(st.siteId)) throw new DomainError("not_found", "Print station not found in your sites.");
  const rows = await jobsQuery()
    .where(
      and(
        eq(labelJobs.printStationId, st.id),
        or(notInArray(labelJobs.status, ["printed", "cancelled"]), and(eq(labelJobs.status, "printed"), gt(labelJobs.printedAt, sql`now() - interval '24 hours'`))),
      ),
    )
    .orderBy(desc(labelJobs.requestedAt))
    .limit(200);
  const jobs = rows.map(flat);
  return { station: st, toPrint: jobs.filter((j) => j.status !== "printed"), printed: jobs.filter((j) => j.status === "printed") };
}

/** Label history of one record (newest first); voided labels are the "superseded — destroy" list. */
export async function labelHistory(ctx: AuthContext, entityType: string, entityId: string) {
  ctx.require("inventory.label_job.view");
  if (!isUuid(entityId)) return [];
  const rows = await jobsQuery()
    .where(and(eq(labelJobs.organizationId, ctx.organizationId), eq(labelJobs.entityType, entityType), eq(labelJobs.entityId, entityId), inArray(labelJobs.siteId, ctx.allowedSiteIds)))
    .orderBy(desc(labelJobs.requestedAt))
    .limit(100);
  return rows.map(flat);
}

export async function getLabelJob(ctx: AuthContext, jobId: string) {
  ctx.require("inventory.label_job.view");
  const j = await loadJob(db, ctx, jobId);
  const [row] = await jobsQuery().where(eq(labelJobs.id, j.id)).limit(1);
  return flat(row);
}

/** The job's label pages for the print route: re-rendered from the frozen dataset and hash-checked. */
export async function labelJobForPrint(ctx: AuthContext, jobId: string) {
  const job = await getLabelJob(ctx, jobId);
  if (!job.generatedDocumentId) return { job, render: null };
  const [doc] = await db.select().from(generatedDocuments).where(eq(generatedDocuments.id, job.generatedDocumentId)).limit(1);
  if (doc.status !== "ready" && doc.status !== "superseded" && doc.status !== "void") return { job, render: null, doc };
  return { job, doc, render: await renderForDisplay(doc) };
}
