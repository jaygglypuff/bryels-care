import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type Tx, db } from "@/db/client";
import { batchFinishChecks, batches, materials, products, users, type FinishCheckStatus } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { waitingForNames } from "@/lib/next-actors-words";
import { getSetting } from "@/lib/settings";
import { type AdHocHandoff, nextActors, notifyNextActors } from "@/modules/governance";
import { stateMachine } from "@/modules/inventory/command-kit";
import { notifyUsers } from "@/modules/platform/notifications";
import { CHECKS_HREF } from "./checks-href";
import { finishHref } from "./flow-paths";
import { findStepOfKind } from "./execution";
import { type FinishBatchInput, finishLocked } from "./finish";
import { plainNumber } from "./floor-words";
import { pieceWord } from "./production-order-status";
import { idempotent, lockBatch } from "./shared";
import { wrapperWord } from "./wrapper-words";

/**
 * ADR-133 (ADR-130 open point): "Finish check on the checker's own phone".
 *
 * When the recipe's move-to-QA step needs a checker, Finish has two ways to get the second person:
 *
 * | Way                                   | When                                         | Who signs                                   |
 * |---------------------------------------|----------------------------------------------|---------------------------------------------|
 * | Password on the operator's phone      | `production.sign_off.same_device` on         | `coSign` (signedOn operator_device)         |
 * | Send the counts to be checked (this)  | always                                       | the checker's own session (own_session)     |
 *
 * Flow (state machine `batch_finish_check`, one audit event per change):
 *
 * 1. `askFinishCheck` (operator; the Finish permissions): runs Finish as a dry run in a savepoint that is rolled back
 *    (every rule but the checker), so counts that do not add up are refused to the operator, not to the checker. Saves
 *    the form as sent and a summary; a check already waiting for the batch is withdrawn (one card per batch). The
 *    people who may check are told ("handoff.finish_check"). waiting.
 * 2. `confirmFinishCheck` (checker, own session, `production.process_step_record.approve` at the site, never the
 *    operator, owner override included): in ONE transaction re-runs Finish with the operator as the doer and the
 *    checker as the signer (idempotent with the stored `finish_key`), then marks the check confirmed. A retried tap
 *    with the same idempotency key returns the stored answer. waiting → confirmed.
 * 3. `returnFinishCheck` (checker): "Not right" with a reason picked from a list. waiting → returned.
 * 4. `withdrawFinishCheck` (only the operator who sent it): waiting → withdrawn. Anyone who may finish can send new
 *    counts instead, which withdraws the waiting ones.
 */

export const FINISH_CHECK_MACHINE = stateMachine<FinishCheckStatus>(
  "batch_finish_check",
  { waiting: ["confirmed", "returned", "withdrawn"], confirmed: [], returned: [], withdrawn: [] },
  { waiting: "waiting for the check", confirmed: "already checked", returned: "already sent back", withdrawn: "taken back by the operator" },
);

const CHECK_PERMISSION = "production.process_step_record.approve" as const;

/** Who is told and listed (independent check: the operator is never listed, owner included). */
const FINISH_CHECK: AdHocHandoff = {
  kind: "finish_check",
  permission: CHECK_PERMISSION,
  does: "checks the counts",
  doBase: "check the counts",
  where: "on their list Waiting for you to check",
  fallback: "an operator or the site manager",
  independent: true,
  prefer: ["production_operator", "site_manager", "production_planner", "qa_qc", "owner_director"],
};

export type FinishCheckSummary = {
  pieceWord: string;
  goodUnits: string;
  sellableUnits: string;
  samplesKept: string;
  rejects: string;
  /** "Wrappers: 2 damaged, 7 left over" per packaging item counted at Finish. */
  packaging: string[];
  location: string;
  yieldPct: string;
  within: boolean;
  problemReason: string | null;
};

const finishPermissions = (ctx: AuthContext) => {
  ctx.require("production.batch.post");
  ctx.require("production.batch.submit");
  ctx.require("production.batch_output.create");
  ctx.require("production.yield_record.create");
};

class DryRunDone extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof finishLocked>>) {
    super("dry run");
  }
}

const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "someone";

/** The facts a checker reads on the card, in plain words. Pure. */
export function finishCheckFacts(s: FinishCheckSummary): string[] {
  const out = [`Good ${s.pieceWord}: ${plainNumber(s.goodUnits)}`];
  if (new Decimal(s.samplesKept).gt(0)) out.push(`Samples kept for QA: ${plainNumber(s.samplesKept)} (${plainNumber(s.sellableUnits)} to sell)`);
  out.push(`Rejects: ${plainNumber(s.rejects)}`);
  out.push(...s.packaging);
  out.push(`Made ${plainNumber(s.yieldPct)} % of what was expected${s.within ? "" : " (outside the usual range)"}`);
  if (s.problemReason) out.push(`What happened: ${s.problemReason}`);
  out.push(`Goes to ${s.location} for QA`);
  return out;
}

/** Operator: send the Finish counts to be checked on the checker's own phone. */
export async function askFinishCheck(ctx: AuthContext, input: FinishBatchInput) {
  finishPermissions(ctx);
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result, replayed } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch_finish_check.ask", async () => {
      if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is not being made any more; there is nothing to finish.`);
      const transfer = findStepOfKind(batch, ["transfer"]);
      if (!transfer?.requiresChecker) throw new DomainError("state", "This recipe needs no second person to check the counts. Tap Finish.");
      const stored: FinishBatchInput = { ...input, idempotencyKey: "" };
      // Dry run: every rule of Finish except the checker, rolled back (savepoint).
      let dry: Awaited<ReturnType<typeof finishLocked>>;
      try {
        await tx.transaction(async (sp) => {
          throw new DryRunDone(await finishLocked(sp, ctx, batch, stored, {}, { checkerLater: true }));
        });
        throw new Error("unreachable");
      } catch (e) {
        if (!(e instanceof DryRunDone)) throw e;
        dry = e.result;
      }
      const [product] = await tx.select({ family: products.family }).from(products).where(eq(products.id, batch.productId)).limit(1);
      const pkgIds = (input.packaging ?? []).map((p) => p.materialId);
      const names = pkgIds.length ? await tx.select({ id: materials.id, name: materials.name }).from(materials).where(inArray(materials.id, pkgIds)) : [];
      const summary: FinishCheckSummary = {
        pieceWord: pieceWord(product?.family, 2),
        goodUnits: dry.goodUnits,
        sellableUnits: dry.sellableUnits,
        samplesKept: dry.samplesKept,
        rejects: dry.rejects,
        packaging: (input.packaging ?? []).map((p) => {
          const name = names.find((n) => n.id === p.materialId)?.name ?? "Packaging";
          const word = wrapperWord(name);
          return `${word[0].toUpperCase()}${word.slice(1)}${word !== name ? ` (${name})` : ""}: ${plainNumber(String(p.damaged ?? 0))} damaged, ${plainNumber(String(p.leftOver ?? 0))} left over`;
        }),
        location: dry.location,
        yieldPct: dry.yieldPct,
        within: dry.within,
        problemReason: input.problemReason?.trim() || null,
      };
      // One card per batch: a check still waiting is replaced by the new counts.
      const [old] = await tx.select().from(batchFinishChecks).where(and(eq(batchFinishChecks.batchId, batch.id), eq(batchFinishChecks.status, "waiting"))).for("update").limit(1);
      if (old) {
        FINISH_CHECK_MACHINE.assert(old.status, "withdrawn", "The counts sent earlier");
        await tx.update(batchFinishChecks).set({ status: "withdrawn" }).where(eq(batchFinishChecks.id, old.id));
        await audit(tx, ctx, { action: "production.batch_finish_check.withdrawn", entityType: "batch_finish_check", entityId: old.id, entityNumber: batch.batchNumber, siteId: batch.siteId, before: { status: "waiting" }, after: { status: "withdrawn", replacedBySending: true } });
      }
      const [row] = await tx
        .insert(batchFinishChecks)
        .values({ organizationId: ctx.organizationId, siteId: batch.siteId, batchId: batch.id, status: "waiting", input: stored, summary, finishKey: `finish-check:${batch.id}:${input.idempotencyKey}`, requestedBy: ctx.userId, idempotencyKey: input.idempotencyKey })
        .returning();
      await audit(tx, ctx, { action: "production.batch_finish_check.sent", entityType: "batch_finish_check", entityId: row.id, entityNumber: batch.batchNumber, siteId: batch.siteId, after: { status: "waiting", batchId: batch.id, summary } });
      await notifyNextActors(tx, ctx, FINISH_CHECK, { siteId: batch.siteId, excludeUserIds: [ctx.userId] }, {
        title: `Check the counts of batch ${batch.batchNumber}`,
        body: `${ctx.displayName} finished batch ${batch.batchNumber}: ${summary.goodUnits} good ${summary.pieceWord}. Look at the counts and tap Looks right or Not right.`,
        link: CHECKS_HREF,
        entityType: "batch",
        entityId: batch.id,
        dedupeKey: `handoff.finish_check:${row.id}`,
      });
      return { checkId: row.id, status: "waiting" as const, batchNumber: batch.batchNumber };
    });
    return { ...result, replayed };
  });
}

async function lockCheck(tx: Tx, ctx: AuthContext, checkId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(checkId)) throw new DomainError("not_found", "This check was not found.");
  const [row] = await tx
    .select()
    .from(batchFinishChecks)
    .where(and(eq(batchFinishChecks.id, checkId), eq(batchFinishChecks.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!row) throw new DomainError("not_found", "This check was not found.");
  ctx.requireSite(row.siteId);
  return row;
}

/** Independent check (GMP, ADR-080 §8): the person who sent the counts never checks them, owner override included. */
function assertNotSender(ctx: AuthContext, row: typeof batchFinishChecks.$inferSelect) {
  if (row.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You sent these counts. Another person checks them on their own phone.", { rule: "V-SOD" });
}

/** Checker: "Looks right". Finishes the batch in this one transaction. */
export async function confirmFinishCheck(ctx: AuthContext, input: { checkId: string; idempotencyKey: string }) {
  ctx.require(CHECK_PERMISSION);
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  return db.transaction(async (tx) => {
    const peek = await lockCheck(tx, ctx, input.checkId);
    const { result, replayed } = await idempotent(tx, ctx, input.idempotencyKey, "production.batch_finish_check.confirm", async () => {
      const row = peek;
      ctx.requireAt(CHECK_PERMISSION, row.siteId);
      assertNotSender(ctx, row);
      FINISH_CHECK_MACHINE.assert(row.status, "confirmed", "These counts");
      // The operator who sent the counts is the one who finishes (their permissions are checked again now).
      const operator = await buildContextForUser(row.requestedBy, row.siteId, { correlationId: ctx.correlationId });
      if (!operator || !operator.allowedSiteIds.includes(row.siteId)) throw new DomainError("state", "The person who sent these counts can no longer finish at this site. Ask them, or the site manager, to send them again.");
      finishPermissions(operator);
      const batch = await lockBatch(tx, operator, row.batchId);
      const stored = row.input as FinishBatchInput;
      const { result: fin } = await idempotent(tx, operator, row.finishKey, "production.batch.finish", () => finishLocked(tx, operator, batch, { ...stored, idempotencyKey: row.finishKey }, { checker: ctx }));
      const sent = row.summary as FinishCheckSummary;
      // Counts read from the daily log could have changed after sending: the checker confirms only what they saw.
      if (fin.goodUnits !== sent.goodUnits || fin.rejects !== sent.rejects) {
        throw new DomainError("state", `The counts changed after ${firstName(operator.displayName)} sent them (now ${fin.goodUnits} good, ${fin.rejects} rejects). Ask ${firstName(operator.displayName)} to send them again.`);
      }
      const now = new Date();
      await tx.update(batchFinishChecks).set({ status: "confirmed", decidedBy: ctx.userId, decidedAt: now }).where(eq(batchFinishChecks.id, row.id));
      await audit(tx, ctx, {
        action: "production.batch_finish_check.confirmed",
        entityType: "batch_finish_check",
        entityId: row.id,
        entityNumber: batch.batchNumber,
        siteId: row.siteId,
        before: { status: "waiting" },
        after: { status: "confirmed", batchId: batch.id, lotNumber: fin.lotNumber, operator: operator.displayName, signedOn: ctx.signedOn },
      });
      return { ...fin, checkId: row.id };
    });
    return { ...result, replayed };
  });
}

/** Checker: "Not right" with a reason picked from a list. */
export async function returnFinishCheck(ctx: AuthContext, input: { checkId: string; reason: string }) {
  ctx.require(CHECK_PERMISSION);
  const reason = (input.reason ?? "").trim();
  return db.transaction(async (tx) => {
    const row = await lockCheck(tx, ctx, input.checkId);
    ctx.requireAt(CHECK_PERMISSION, row.siteId);
    assertNotSender(ctx, row);
    if (reason.length < 3) throw new DomainError("validation", "Tap what is not right.", { field: "reasonCode", fieldErrors: { reasonCode: "Tap one." } });
    FINISH_CHECK_MACHINE.assert(row.status, "returned", "These counts");
    const [b] = await tx.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, row.batchId)).limit(1);
    await tx.update(batchFinishChecks).set({ status: "returned", decidedBy: ctx.userId, decidedAt: new Date(), reason: reason.slice(0, 300) }).where(eq(batchFinishChecks.id, row.id));
    await audit(tx, ctx, { action: "production.batch_finish_check.returned", entityType: "batch_finish_check", entityId: row.id, entityNumber: b?.number ?? null, siteId: row.siteId, reason, before: { status: "waiting" }, after: { status: "returned", signedOn: ctx.signedOn } });
    await notifyUsers(tx, [row.requestedBy], {
      organizationId: ctx.organizationId,
      siteId: row.siteId,
      kind: "production.batch_finish_check.returned",
      severity: "warning",
      title: `${firstName(ctx.displayName)} said the counts of batch ${b?.number ?? ""} are not right`,
      body: `${reason}. Count again and send them again on the Finish screen.`,
      entityType: "batch",
      entityId: row.batchId,
      link: finishHref(row.batchId),
      dedupeKey: `production.batch_finish_check.returned:${row.id}`,
    });
    return { checkId: row.id, status: "returned" as const };
  });
}

/** Operator: take the counts back while they wait (to change them). */
export async function withdrawFinishCheck(ctx: AuthContext, input: { batchId: string }) {
  finishPermissions(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(input.batchId ?? "")) throw new DomainError("not_found", "Batch not found.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const [row] = await tx.select().from(batchFinishChecks).where(and(eq(batchFinishChecks.batchId, batch.id), eq(batchFinishChecks.status, "waiting"))).for("update").limit(1);
    if (!row) throw new DomainError("state", "No counts are waiting for a check.");
    // Only the sender takes them back; a checker says "Not right" with a reason, and another operator sends new counts.
    if (row.requestedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who sent the counts can take them back. If they are not right, tap Not right on your list.");
    FINISH_CHECK_MACHINE.assert(row.status, "withdrawn", "These counts");
    await tx.update(batchFinishChecks).set({ status: "withdrawn" }).where(eq(batchFinishChecks.id, row.id));
    await audit(tx, ctx, { action: "production.batch_finish_check.withdrawn", entityType: "batch_finish_check", entityId: row.id, entityNumber: batch.batchNumber, siteId: batch.siteId, before: { status: "waiting" }, after: { status: "withdrawn" } });
    return { checkId: row.id, status: "withdrawn" as const };
  });
}

export type FinishCheckState = {
  checkId: string;
  status: FinishCheckStatus;
  /** True when the viewer sent it. */
  mine: boolean;
  /** "Waiting for Jun or Dino to check the counts." / "Jun said not right: Wrong count. Fix the counts and send them again." */
  words: string;
  reason: string | null;
  summary: FinishCheckSummary;
};

/** The latest check of a batch for the Finish screen (null when none was sent, or the last one was taken back). */
export async function finishCheckOf(ctx: AuthContext, batchId: string): Promise<FinishCheckState | null> {
  ctx.require("production.batch.view");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new DomainError("not_found", "Batch not found.");
  const [b] = await db.select({ id: batches.id, siteId: batches.siteId, status: batches.status }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(b.siteId);
  const [row] = await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.batchId, b.id)).orderBy(desc(batchFinishChecks.requestedAt)).limit(1);
  if (!row || row.status === "withdrawn" || row.status === "confirmed") return null;
  const summary = row.summary as FinishCheckSummary;
  let words: string;
  if (row.status === "waiting") {
    const next = await nextActors(ctx, FINISH_CHECK, { siteId: b.siteId, excludeUserIds: [row.requestedBy] }).catch(() => null);
    const names = next ? waitingForNames(next) : null;
    words = names ? `Waiting for ${names} to check the counts.` : "Waiting for a second person to check the counts. Nobody else here can check yet: ask the site manager.";
  } else {
    const [by] = row.decidedBy ? await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.decidedBy)).limit(1) : [];
    words = `${firstName(by?.displayName)} said not right: ${row.reason}. Fix the counts and send them again.`;
  }
  return { checkId: row.id, status: row.status as FinishCheckStatus, mine: row.requestedBy === ctx.userId, words, reason: row.reason, summary };
}

/** Is same-device signing on (ADR-130)? For the Finish screen. */
export async function sameDeviceSigning(organizationId: string): Promise<boolean> {
  return getSetting(db, organizationId, "production.sign_off.same_device");
}
