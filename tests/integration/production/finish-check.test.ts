import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, batchFinishChecks, batches, inventoryLots, notifications, processStepRecords, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { coSign } from "@/lib/auth/co-sign";
import { askFinishCheck, checkerQueue, confirmFinishCheck, finishBatch, finishCheckOf, getFinishView, returnFinishCheck, withdrawFinishCheck } from "@/modules/production";
import { resolveDoneNotifications } from "@/modules/platform";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { directBatchReadyToFinish } from "../../support/g3";

/**
 * ADR-133 item 1 (ADR-130 open point): with `production.sign_off.same_device` off, a recipe whose move-to-QA step needs
 * a checker can still be finished: the operator sends the counts, the checker confirms on their own session from
 * "Waiting for you to check", and the batch goes to the QA waiting area in that one transaction (idempotent). The
 * password on the operator's device keeps working while the setting is on. Fictional data only.
 */
let kit: Kit;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let warehouse: AuthContext;
let operatorRvs: AuthContext;
let checkerRvs: AuthContext;
const PW = "demo1234";
const key = () => `fc-${randomUUID()}`;

async function setSetting(k: string, value: unknown) {
  await db
    .insert(settings)
    .values({ organizationId: kit.orgId, scope: "organization", key: k, value })
    .onConflictDoUpdate({ target: [settings.organizationId, settings.scope, settings.siteId, settings.userId, settings.key], set: { value } });
}
async function clearSetting(k: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, k)));
}

const counts = (b: { batchId: string; wrapperMaterialId: string }, k = key()) => ({ batchId: b.batchId, goodUnits: "60", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "10" }], idempotencyKey: k });

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  checkerRvs = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  await setSetting("production.sign_off.same_device", false);
}, 180_000);

afterAll(async () => {
  await clearSetting("production.sign_off.same_device");
});

describe("Finish check on the checker's own phone (same-device signing off)", () => {
  it("the password on the operator's phone is refused, so the counts are sent instead", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const e = await expectCode(coSign(operator, { role: "checker", permission: "production.process_step_record.approve", siteId: kit.nfd.id, userId: checker.userId, password: PW }), "validation");
    expect(e.message).toMatch(/own phone/);
    const v = await getFinishView(operator, b.batchId);
    expect(v.needsChecker).toBe(true);
    expect(v.sameDevice).toBe(false);
    expect(v.finishCheck).toBeNull();
  });

  it("send → card on the checker's list → Looks right finishes the batch in one go; a retried confirm changes nothing", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const askKey = key();
    const sent = await askFinishCheck(operator, counts(b, askKey));
    expect(sent).toMatchObject({ status: "waiting", replayed: false });
    // A retried send answers with the same check (no second card).
    const again = await askFinishCheck(operator, counts(b, askKey));
    expect(again).toMatchObject({ checkId: sent.checkId, replayed: true });
    // Nothing is posted yet: the batch is still being made and has no lot.
    const [still] = await db.select({ status: batches.status }).from(batches).where(eq(batches.id, b.batchId));
    expect(still.status).toBe("in_process");
    expect(await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId))).toHaveLength(0);

    // The operator's screen names who checks.
    const w = await finishCheckOf(operator, b.batchId);
    expect(w).toMatchObject({ status: "waiting", mine: true });
    expect(w!.words).toMatch(/^Waiting for .+ to check the counts/);

    // The operator has no card for her own counts; the checker has one.
    expect((await checkerQueue(operator)).cards.some((c) => c.kind === "finish")).toBe(false);
    const q = await checkerQueue(checker);
    const card = q.cards.find((c) => c.kind === "finish" && c.batchId === b.batchId);
    expect(card).toBeTruthy();
    if (card?.kind !== "finish") throw new Error("no finish card");
    expect(card.facts.join(" | ")).toMatch(/Good .*60/);
    expect(card.facts.join(" | ")).toMatch(/left over/);
    // The checker was told (one message, cleared later by the done rule).
    const told = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, checker.userId), eq(notifications.kind, "handoff.finish_check")));
    expect(told.length).toBeGreaterThanOrEqual(1);

    const confirmKey = key();
    const r = await confirmFinishCheck(checker, { checkId: card.checkId, idempotencyKey: confirmKey });
    expect(r).toMatchObject({ batchNumber: b.batchNumber, goodUnits: "60", replayed: false });
    const [done] = await db.select({ status: batches.status }).from(batches).where(eq(batches.id, b.batchId));
    expect(done.status).toBe("awaiting_qc");
    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId));
    expect(lots).toHaveLength(1);
    // The move step is signed by the operator (who did it) and the checker (who checked it, on their own session).
    const [transfer] = await db.select().from(processStepRecords).where(and(eq(processStepRecords.batchId, b.batchId), eq(processStepRecords.stepKind, "transfer")));
    expect(transfer.conductedBy).toBe(operator.userId);
    expect(transfer.checkedBy).toBe(checker.userId);
    const checked = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), eq(auditEvents.action, "production.process_step_record.checked")));
    expect((checked[0].after as { signedOn: string }).signedOn).toBe("own_session");
    const fin = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), eq(auditEvents.action, "production.batch.finished")));
    expect(fin).toHaveLength(1);
    expect(fin[0].actorId).toBe(operator.userId);
    const conf = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.batch_finish_check.confirmed"), eq(auditEvents.entityId, card.checkId)));
    expect(conf).toHaveLength(1);
    expect(conf[0].actorId).toBe(checker.userId);

    // Retry of the same tap: the stored answer, no second lot.
    const replay = await confirmFinishCheck(checker, { checkId: card.checkId, idempotencyKey: confirmKey });
    expect(replay.replayed).toBe(true);
    expect(replay.lotNumber).toBe(r.lotNumber);
    expect(await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId))).toHaveLength(1);
    // A new tap on a confirmed check is refused in plain words.
    const twice = await expectCode(confirmFinishCheck(checker, { checkId: card.checkId, idempotencyKey: key() }), "state");
    expect(twice.message).toMatch(/already/i);
    expect((await checkerQueue(checker)).cards.some((c) => c.kind === "finish" && c.batchId === b.batchId)).toBe(false);
    const [row] = await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.id, card.checkId));
    expect(row).toMatchObject({ status: "confirmed", decidedBy: checker.userId });
    // The message clears once the counts are checked.
    await resolveDoneNotifications(db, { organizationId: kit.orgId, recipientUserId: checker.userId });
    const after = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, checker.userId), eq(notifications.kind, "handoff.finish_check"), eq(notifications.dedupeKey, `handoff.finish_check:${card.checkId}`)));
    expect(after.length).toBe(1);
    expect(after[0].resolvedAt).not.toBeNull();
  });

  it("negatives: the operator cannot confirm her own counts; another site's checker and the warehouse (no check permission) cannot", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const { checkId } = await askFinishCheck(operator, counts(b));
    await expectCode(confirmFinishCheck(operator, { checkId, idempotencyKey: key() }), "separation_of_duties");
    await expectCode(confirmFinishCheck(checkerRvs, { checkId, idempotencyKey: key() }), "not_found");
    await expectCode(returnFinishCheck(checkerRvs, { checkId, reason: "Wrong count" }), "not_found");
    await expectCode(confirmFinishCheck(warehouse, { checkId, idempotencyKey: key() }), "forbidden");
    await expectCode(askFinishCheck(operatorRvs, counts(b)), "not_found");
    await expectCode(finishCheckOf(operatorRvs, b.batchId), "not_found");
    // Another site's checker sees no card for this batch.
    expect((await checkerQueue(checkerRvs)).cards.some((c) => c.kind === "finish")).toBe(false);
    const [row] = await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.id, checkId));
    expect(row.status).toBe("waiting");
  });

  it("Not right sends it back with the reason; the operator fixes the counts and sends again", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const first = await askFinishCheck(operator, counts(b));
    await expectCode(returnFinishCheck(operator, { checkId: first.checkId, reason: "Wrong count" }), "separation_of_duties");
    await expectCode(returnFinishCheck(checker, { checkId: first.checkId, reason: "" }), "validation");
    await returnFinishCheck(checker, { checkId: first.checkId, reason: "Wrong count: 59 bars on the table" });
    const back = await finishCheckOf(operator, b.batchId);
    expect(back).toMatchObject({ status: "returned", reason: "Wrong count: 59 bars on the table" });
    expect(back!.words).toMatch(/not right/i);
    const told = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, operator.userId), eq(notifications.kind, "production.batch_finish_check.returned")));
    expect(told.map((n) => n.body)).toContain("Wrong count: 59 bars on the table. Count again and send them again on the Finish screen.");
    expect((await checkerQueue(checker)).cards.some((c) => c.kind === "finish" && c.batchId === b.batchId)).toBe(false);
    await expectCode(confirmFinishCheck(checker, { checkId: first.checkId, idempotencyKey: key() }), "state");

    // Sent again with other counts: a new card; the old one stays sent back (history).
    const second = await askFinishCheck(operator, { ...counts(b), goodUnits: "59", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "11" }] });
    expect(second.checkId).not.toBe(first.checkId);
    // Sending again while one waits replaces it (withdrawn), never two cards.
    const third = await askFinishCheck(operator, { ...counts(b), goodUnits: "59", packaging: [{ materialId: b.wrapperMaterialId, damaged: "1", leftOver: "10" }] });
    const rows = await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.batchId, b.batchId));
    expect(rows.map((r) => [r.id === first.checkId ? "first" : r.id === second.checkId ? "second" : "third", r.status]).sort()).toEqual([
      ["first", "returned"],
      ["second", "withdrawn"],
      ["third", "waiting"],
    ]);
    const r = await confirmFinishCheck(checker, { checkId: third.checkId, idempotencyKey: key() });
    expect(r.goodUnits).toBe("59");
  });

  it("counts that do not add up are refused at send (the checker never gets a card that cannot finish)", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const e = await expectCode(askFinishCheck(operator, { ...counts(b), packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "3" }] }), "state");
    expect(e.message).toMatch(/missing/);
    expect(await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.batchId, b.batchId))).toHaveLength(0);
    // The dry run left nothing behind.
    expect(await db.select().from(inventoryLots).where(eq(inventoryLots.sourceBatchId, b.batchId))).toHaveLength(0);
  });

  it("the operator can take the counts back while they wait", async () => {
    const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
    const { checkId } = await askFinishCheck(operator, counts(b));
    await expectCode(withdrawFinishCheck(checker, { batchId: b.batchId }), "forbidden");
    await withdrawFinishCheck(operator, { batchId: b.batchId });
    const [row] = await db.select().from(batchFinishChecks).where(eq(batchFinishChecks.id, checkId));
    expect(row.status).toBe("withdrawn");
    await expectCode(confirmFinishCheck(checker, { checkId, idempotencyKey: key() }), "state");
  });
});

describe("Same-device co-sign keeps working while the setting is on", () => {
  it("the checker's own password on the operator's phone finishes at once", async () => {
    await clearSetting("production.sign_off.same_device");
    try {
      const b = await directBatchReadyToFinish(kit, { manager, operator, checker });
      expect((await getFinishView(operator, b.batchId)).sameDevice).toBe(true);
      const signer = await coSign(operator, { role: "checker", permission: "production.process_step_record.approve", siteId: kit.nfd.id, userId: checker.userId, password: PW });
      const r = await finishBatch(operator, counts(b), { checker: signer });
      expect(r.goodUnits).toBe("60");
      const checked = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, b.batchId), eq(auditEvents.action, "production.process_step_record.checked")));
      expect((checked[0].after as { signedOn: string }).signedOn).toBe("operator_device");
      // The phone route works with the setting on too.
      const b2 = await directBatchReadyToFinish(kit, { manager, operator, checker });
      const { checkId } = await askFinishCheck(operator, counts(b2));
      const r2 = await confirmFinishCheck(checker, { checkId, idempotencyKey: key() });
      expect(r2.goodUnits).toBe("60");
    } finally {
      await setSetting("production.sign_off.same_device", false);
    }
  });
});
