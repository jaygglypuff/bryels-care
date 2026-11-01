import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { batchPauses, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { findStep, performPermission } from "./execution";
import { plainWords } from "./plain-words";
import { idempotent, lockBatch } from "./shared";
import { dayNumber, startedWords } from "./batch-days-words";

export { continueTitle, dayNumber, packedOverDays, startedWords } from "./batch-days-words";

/**
 * ADR-104 §5 batches over several days. A batch stays "Being made" across days; "Stop for today" on the step card
 * records where we stopped and a short note (batch_pauses, append-only, audited). Read models: the next day's task
 * ("Continue Calamansi Soap B-26-0006 · step 4 · started yesterday"), the TV card's "day 2", and the last pause note.
 */

export type StopForTodayInput = { batchId: string; stepNo: number; whereStopped?: string | null; note?: string | null; idempotencyKey?: string | null };

export async function stopForToday(ctx: AuthContext, input: StopForTodayInput) {
  ctx.require("production.batch.view");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch.pause", async () => {
      if (batch.status !== "in_process" && batch.status !== "materials_staged") throw new DomainError("state", `Batch ${batch.batchNumber} is not being made, so there is nothing to stop.`);
      const step = findStep(batch, Number(input.stepNo));
      const perm = performPermission(step.stepKind);
      ctx.requireAt(perm, batch.siteId);
      const where = ((input.whereStopped ?? "").trim() || `Step ${step.stepNo} · ${plainWords(step.name)}`).slice(0, 200);
      if (where.length < 2) throw new DomainError("validation", "Say where you stopped.", { field: "whereStopped", fieldErrors: { whereStopped: "Where did you stop?" } });
      const note = (input.note ?? "").trim() || null;
      if (note && note.length > 300) throw new DomainError("validation", "Keep the note short (300 characters).", { field: "note", fieldErrors: { note: "Too long." } });
      const [p] = await tx
        .insert(batchPauses)
        .values({ organizationId: batch.organizationId, siteId: batch.siteId, batchId: batch.id, stepNo: step.stepNo, whereStopped: where, note, pausedBy: ctx.userId, idempotencyKey: input.idempotencyKey ?? null })
        .returning();
      await audit(tx, ctx, { action: "production.batch.paused", entityType: "batch", entityId: batch.id, entityNumber: batch.batchNumber, siteId: batch.siteId, reason: note, after: { pauseId: p.id, stepNo: step.stepNo, whereStopped: where } });
      return { pauseId: p.id, batchNumber: batch.batchNumber, stepNo: step.stepNo, whereStopped: where, note };
    });
    return result;
  });
}

export type LastPause = { stepNo: number; whereStopped: string; note: string | null; by: string; at: Date };

/** The newest pause of each batch. */
export async function lastPauses(q: DbOrTx, batchIds: string[]): Promise<Map<string, LastPause>> {
  const out = new Map<string, LastPause>();
  if (!batchIds.length) return out;
  const rows = await q
    .select({ p: batchPauses, by: users.displayName })
    .from(batchPauses)
    .innerJoin(users, eq(users.id, batchPauses.pausedBy))
    .where(inArray(batchPauses.batchId, batchIds))
    .orderBy(desc(batchPauses.pausedAt));
  for (const r of rows) if (!out.has(r.p.batchId)) out.set(r.p.batchId, { stepNo: r.p.stepNo, whereStopped: r.p.whereStopped, note: r.p.note, by: r.by, at: r.p.pausedAt });
  return out;
}

/** For the step card: the newest pause of the batch, in words ("Stopped yesterday by Rhea: …"). */
export async function pauseOfBatch(ctx: AuthContext, batch: { id: string; siteId: string; startedAt: Date | null }, now = new Date()) {
  ctx.requireSite(batch.siteId);
  const p = (await lastPauses(db, [batch.id])).get(batch.id) ?? null;
  return {
    last: p ? { ...p, words: `Stopped ${startedWords(p.at, now)} by ${p.by.split(/\s+/)[0]}: ${p.whereStopped}${p.note ? ` — ${p.note}` : ""}` } : null,
    dayNo: batch.startedAt ? dayNumber(batch.startedAt, now) : null,
  };
}

