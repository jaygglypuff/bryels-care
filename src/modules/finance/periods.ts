import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { accountingPeriods, approvalDecisions, creditNotes, expenseClaims, invoices, paymentRecords, periodUnlockRequests, supplierBills } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { evaluateApprovalRulesAudited, requireReauthentication, rolesAllowedNow } from "@/modules/governance";
import { notifyRoles } from "@/modules/platform";
import { businessDate, ensurePeriod, isUuid, namesOf, requireReason } from "./shared";

/**
 * Accounting periods and locks (US-6-13, FR-finance-07, docs/modules/finance.md §2.6).
 *
 * - A period is a calendar month (A-FIN-02), created the first time a document dates into it.
 * - Lock (`finance.period_lock.post`, restricted): a pre-lock checklist lists documents dated in the period
 *   that are still in submission or approval (and unposted payments); the lock proceeds only when the list is
 *   empty or each item is acknowledged with a reason. The lock takes the period row FOR UPDATE, so it waits
 *   for postings in flight (they hold it FOR SHARE) and every later posting into the period is refused
 *   (409 PERIOD_LOCKED), as is any reversal dated into it.
 * - Unlock needs two approvals by two different people (`finance.period_unlock_two_approvals`): a finance
 *   user requests it with a reason (that request is step 1 of approval_rules `period_lock_unlock`, A-W4B-04)
 *   and a holder of `finance.period_lock.void` in the owner step (owner_director) approves; the period opens
 *   only then. Audit `finance.accounting_period.locked` / `.unlocked`.
 */

export type PeriodRow = typeof accountingPeriods.$inferSelect;
const UNLOCK_RECORD = "period_lock_unlock" as const;

function monthsBack(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Open documents dated in the period (the pre-lock checklist). */
export async function preLockChecklist(q: Tx | typeof db, organizationId: string, p: { periodStart: string; periodEnd: string }) {
  const startTs = sql`${p.periodStart}::date`;
  const endTs = sql`(${p.periodEnd}::date + 1)`;
  const items: { kind: string; id: string; label: string; status: string }[] = [];
  const inv = await q
    .select({ id: invoices.id, status: invoices.status, createdAt: invoices.createdAt })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), inArray(invoices.status, ["submitted", "approved"]), sql`${invoices.createdAt} >= ${startTs} and ${invoices.createdAt} < ${endTs}`));
  for (const r of inv) items.push({ kind: "invoice", id: r.id, label: "Invoice draft awaiting issue", status: r.status });
  const bills = await q
    .select({ id: supplierBills.id, number: supplierBills.billNumber, status: supplierBills.status })
    .from(supplierBills)
    .where(and(eq(supplierBills.organizationId, organizationId), inArray(supplierBills.status, ["submitted", "approved", "disputed"]), gte(supplierBills.billDate, p.periodStart), lte(supplierBills.billDate, p.periodEnd)));
  for (const r of bills) items.push({ kind: "supplier_bill", id: r.id, label: `Bill ${r.number}`, status: r.status });
  const pays = await q
    .select({ id: paymentRecords.id, number: paymentRecords.paymentNumber, status: paymentRecords.status })
    .from(paymentRecords)
    .where(and(eq(paymentRecords.organizationId, organizationId), inArray(paymentRecords.status, ["draft", "submitted", "approved"]), gte(paymentRecords.paidOn, p.periodStart), lte(paymentRecords.paidOn, p.periodEnd)));
  for (const r of pays) items.push({ kind: "payment_record", id: r.id, label: `Payment ${r.number} not recorded`, status: r.status });
  const cns = await q
    .select({ id: creditNotes.id, status: creditNotes.status })
    .from(creditNotes)
    .where(and(eq(creditNotes.organizationId, organizationId), inArray(creditNotes.status, ["submitted", "approved"]), sql`${creditNotes.createdAt} >= ${startTs} and ${creditNotes.createdAt} < ${endTs}`));
  for (const r of cns) items.push({ kind: "credit_note", id: r.id, label: "Credit note awaiting issue", status: r.status });
  const exps = await q
    .select({ id: expenseClaims.id, number: expenseClaims.claimNumber, status: expenseClaims.status })
    .from(expenseClaims)
    .where(and(eq(expenseClaims.organizationId, organizationId), inArray(expenseClaims.status, ["submitted", "approved"]), gte(expenseClaims.expenseDate, p.periodStart), lte(expenseClaims.expenseDate, p.periodEnd)));
  for (const r of exps) items.push({ kind: "expense_claim", id: r.id, label: `Expense claim ${r.number}`, status: r.status });
  return items;
}

/** Periods of the last 12 months (existing rows plus months not created yet, shown as open). */
export async function listPeriods(ctx: AuthContext, now = new Date()) {
  ctx.require("finance.period_lock.view");
  const today = businessDate(now);
  const rows = await db.select().from(accountingPeriods).where(eq(accountingPeriods.organizationId, ctx.organizationId)).orderBy(desc(accountingPeriods.periodCode));
  const byCode = new Map(rows.map((r) => [r.periodCode, r]));
  const codes = [...new Set([...monthsBack(today, 12), ...rows.map((r) => r.periodCode)])].sort().reverse();
  const pending = await db
    .select()
    .from(periodUnlockRequests)
    .where(and(eq(periodUnlockRequests.organizationId, ctx.organizationId), eq(periodUnlockRequests.status, "pending")));
  const names = await namesOf(db, [...rows.map((r) => r.lockedBy), ...pending.map((p) => p.requestedBy)]);
  return codes.map((code) => {
    const r = byCode.get(code) ?? null;
    const req = r ? pending.find((p) => p.accountingPeriodId === r.id) ?? null : null;
    return {
      periodCode: code,
      id: r?.id ?? null,
      status: (r?.status ?? "open") as "open" | "locked",
      lockedAt: r?.lockedAt ?? null,
      lockedByName: r?.lockedBy ? names.get(r.lockedBy) ?? null : null,
      lockReason: r?.lockReason ?? null,
      unlockedAt: r?.unlockedAt ?? null,
      isCurrent: code === today.slice(0, 7),
      pendingUnlock: req ? { id: req.id, reason: req.reason, requestedAt: req.requestedAt, requestedBy: req.requestedBy, requestedByName: names.get(req.requestedBy) ?? null } : null,
    };
  });
}

export async function getPeriodChecklist(ctx: AuthContext, periodCode: string) {
  ctx.require("finance.period_lock.view");
  if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new DomainError("not_found", "Period not found.");
  const p = await ensurePeriodRead(ctx, periodCode);
  return preLockChecklist(db, ctx.organizationId, p);
}

async function ensurePeriodRead(ctx: AuthContext, periodCode: string) {
  const [existing] = await db.select().from(accountingPeriods).where(and(eq(accountingPeriods.organizationId, ctx.organizationId), eq(accountingPeriods.periodCode, periodCode))).limit(1);
  if (existing) return existing;
  const [y, m] = periodCode.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { periodStart: `${periodCode}-01`, periodEnd: `${periodCode}-${String(last).padStart(2, "0")}` };
}

/** Locks a period (restricted). Refused while checklist items exist unless each is acknowledged with a reason. */
export async function lockPeriod(ctx: AuthContext, periodCode: string, input: { reason: string; acknowledge?: boolean; acknowledgementNote?: string | null; password?: string | null }) {
  ctx.require("finance.period_lock.post");
  if (!/^\d{4}-\d{2}$/.test(periodCode)) throw new DomainError("validation", "Choose a period.", { field: "periodCode" });
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.period_lock.post");
  return db.transaction(async (tx) => {
    const base = await ensurePeriod(tx, ctx.organizationId, `${periodCode}-01`);
    const [p] = await tx.select().from(accountingPeriods).where(eq(accountingPeriods.id, base.id)).for("update").limit(1);
    if (p.status === "locked") throw new DomainError("state", `Period ${periodCode} is already locked.`);
    const items = await preLockChecklist(tx, ctx.organizationId, p);
    let acknowledgements: unknown = null;
    if (items.length) {
      if (!input.acknowledge) {
        throw new DomainError("conflict", `PRELOCK_OPEN_ITEMS: ${items.length} document(s) dated in ${periodCode} are still open. Finish them, or acknowledge them with a reason to lock anyway.`, { code: "PRELOCK_OPEN_ITEMS", items });
      }
      acknowledgements = { note: requireReason(input.acknowledgementNote, "acknowledgementNote"), items };
    }
    const now = new Date();
    const [after] = await tx
      .update(accountingPeriods)
      .set({ status: "locked", lockedBy: ctx.userId, lockedAt: now, lockReason: reason, lockAcknowledgements: acknowledgements as object | null, version: p.version + 1, updatedAt: now })
      .where(eq(accountingPeriods.id, p.id))
      .returning();
    await audit(tx, ctx, { action: "finance.accounting_period.locked", entityType: "accounting_period", entityId: p.id, entityNumber: periodCode, siteId: null, reason, before: { status: p.status }, after: { status: "locked", acknowledgedItems: items.length } });
    return after;
  });
}

async function lockRequest(tx: Tx, ctx: AuthContext, requestId: string) {
  if (!isUuid(requestId)) throw new DomainError("not_found", "Unlock request not found.");
  const [r] = await tx
    .select()
    .from(periodUnlockRequests)
    .where(and(eq(periodUnlockRequests.id, requestId), eq(periodUnlockRequests.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!r) throw new DomainError("not_found", "Unlock request not found.");
  return r;
}

async function unlockProgress(tx: Tx, ctx: AuthContext, requestId: string, periodCode: string) {
  const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: UNLOCK_RECORD, siteId: null, basis: {}, recordId: requestId, recordNumber: periodCode });
  const decisions = await tx
    .select()
    .from(approvalDecisions)
    .where(and(eq(approvalDecisions.recordType, UNLOCK_RECORD), eq(approvalDecisions.recordId, requestId), eq(approvalDecisions.decision, "approved")))
    .orderBy(asc(approvalDecisions.decidedAt));
  // At least two distinct people, whatever the rules say (finance + owner by default).
  const steps = ev.steps.length >= 2 ? ev.steps : [...ev.steps, ...[1, 2].filter((n) => !ev.steps.some((s) => s.step === n)).map((n) => ({ step: n, label: n === 1 ? "Finance approval" : "Owner approval", ruleIds: [], roleCodes: n === 1 ? ["finance"] : ["owner_director"], permission: null, requiredCount: 1, posterMayEqualApprover: false, escalation: null }))].sort((a, b) => a.step - b.step);
  const withApprovals = steps.map((s) => ({ ...s, approvals: decisions.filter((d) => d.step === s.step), done: decisions.filter((d) => d.step === s.step).length >= s.requiredCount }));
  return { steps: withApprovals, next: withApprovals.find((s) => !s.done) ?? null, deciders: new Set(decisions.map((d) => d.decidedBy)) };
}

/**
 * Requests the unlock of a locked period (restricted; the requester is the finance approval, step 1).
 * One pending request per period.
 */
export async function requestPeriodUnlock(ctx: AuthContext, periodCode: string, input: { reason: string; password?: string | null }) {
  ctx.require("finance.period_lock.post");
  const reason = requireReason(input.reason);
  await requireReauthentication(ctx, input.password, "finance.period_lock.post");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.organizationId, ctx.organizationId), eq(accountingPeriods.periodCode, periodCode))).for("update").limit(1);
    if (!p) throw new DomainError("not_found", "Period not found.");
    if (p.status !== "locked") throw new DomainError("state", `Period ${periodCode} is open; there is nothing to unlock.`);
    const [dup] = await tx.select({ id: periodUnlockRequests.id }).from(periodUnlockRequests).where(and(eq(periodUnlockRequests.accountingPeriodId, p.id), eq(periodUnlockRequests.status, "pending"))).limit(1);
    if (dup) throw new DomainError("conflict", "An unlock request for this period is already waiting for approval.");
    const [req] = await tx.insert(periodUnlockRequests).values({ organizationId: ctx.organizationId, accountingPeriodId: p.id, reason, requestedBy: ctx.userId }).returning();
    const prog = await unlockProgress(tx, ctx, req.id, periodCode);
    const first = prog.steps[0];
    const roles = rolesAllowedNow(first, null);
    if (roles.length > 0 && !roles.some((r) => ctx.roleCodes.includes(r))) {
      throw new DomainError("forbidden", `An unlock is requested by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")} (step 1 of the unlock approval).`);
    }
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: null, recordType: UNLOCK_RECORD, recordId: req.id, step: first.step, cycle: 1, decision: "approved", decidedBy: ctx.userId, note: reason });
    await audit(tx, ctx, { action: "finance.accounting_period.unlock_requested", entityType: "accounting_period", entityId: p.id, entityNumber: periodCode, siteId: null, reason, after: { requestId: req.id } });
    const second = prog.steps[1];
    if (second?.roleCodes.length) {
      await notifyRoles(tx, { roleCodes: second.roleCodes, siteId: null }, { organizationId: ctx.organizationId, kind: "finance.period_unlock", severity: "warning", title: `Unlock of period ${periodCode} needs your approval`, body: `Requested by ${ctx.displayName}: ${reason}`, entityType: "accounting_period", entityId: p.id, link: "/finance/periods" });
    }
    return req;
  });
}

/** Second (and any further) approval of an unlock; the last approval opens the period. */
export async function approvePeriodUnlock(ctx: AuthContext, requestId: string, input: { note?: string | null; password?: string | null }) {
  ctx.require("finance.period_lock.void");
  await requireReauthentication(ctx, input.password, "finance.period_lock.void");
  return db.transaction(async (tx) => {
    const req = await lockRequest(tx, ctx, requestId);
    if (req.status !== "pending") throw new DomainError("state", `This unlock request is ${req.status}.`);
    const [p] = await tx.select().from(accountingPeriods).where(eq(accountingPeriods.id, req.accountingPeriodId)).for("update").limit(1);
    const prog = await unlockProgress(tx, ctx, req.id, p.periodCode);
    if (req.requestedBy === ctx.userId || prog.deciders.has(ctx.userId)) {
      throw new DomainError("separation_of_duties", "Unlocking a period needs two different people: you already approved this request.", { code: "SEPARATION_OF_DUTIES" });
    }
    const step = prog.next;
    if (!step) throw new DomainError("state", "Every approval step is already complete.");
    const roles = rolesAllowedNow(step, req.requestedAt);
    if (roles.length > 0 && !roles.some((r) => ctx.roleCodes.includes(r))) {
      throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
    }
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: null, recordType: UNLOCK_RECORD, recordId: req.id, step: step.step, cycle: 1, decision: "approved", decidedBy: ctx.userId, note: input.note?.trim() || null });
    const remaining = prog.steps.filter((s) => !s.done && !(s.step === step.step && s.approvals.length + 1 >= s.requiredCount));
    if (remaining.length > 0) return { unlocked: false, period: p };
    const now = new Date();
    await tx.update(periodUnlockRequests).set({ status: "applied", decidedBy: ctx.userId, decidedAt: now, decisionNote: input.note?.trim() || null }).where(eq(periodUnlockRequests.id, req.id));
    const [after] = await tx.update(accountingPeriods).set({ status: "open", unlockedBy: ctx.userId, unlockedAt: now, version: p.version + 1, updatedAt: now }).where(eq(accountingPeriods.id, p.id)).returning();
    await audit(tx, ctx, {
      action: "finance.accounting_period.unlocked",
      entityType: "accounting_period",
      entityId: p.id,
      entityNumber: p.periodCode,
      siteId: null,
      reason: req.reason,
      before: { status: "locked", lockedBy: p.lockedBy, lockedAt: p.lockedAt },
      after: { status: "open", requestedBy: req.requestedBy, approvedBy: ctx.userId, requestId: req.id },
    });
    return { unlocked: true, period: after };
  });
}

export async function rejectPeriodUnlock(ctx: AuthContext, requestId: string, input: { reason: string }) {
  ctx.require("finance.period_lock.void");
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const req = await lockRequest(tx, ctx, requestId);
    if (req.status !== "pending") throw new DomainError("state", `This unlock request is ${req.status}.`);
    if (req.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You requested this unlock; another person decides on it.", { code: "SEPARATION_OF_DUTIES" });
    await tx.update(periodUnlockRequests).set({ status: "rejected", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: reason }).where(eq(periodUnlockRequests.id, req.id));
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: null, recordType: UNLOCK_RECORD, recordId: req.id, step: 2, cycle: 1, decision: "rejected", decidedBy: ctx.userId, note: reason });
    await audit(tx, ctx, { action: "finance.accounting_period.unlock_rejected", entityType: "accounting_period", entityId: req.accountingPeriodId, siteId: null, reason, after: { requestId: req.id } });
    return { rejected: true };
  });
}

/** Cancels one's own pending request. */
export async function cancelPeriodUnlock(ctx: AuthContext, requestId: string) {
  ctx.require("finance.period_lock.post");
  return db.transaction(async (tx) => {
    const req = await lockRequest(tx, ctx, requestId);
    if (req.status !== "pending") throw new DomainError("state", `This unlock request is ${req.status}.`);
    if (req.requestedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who requested the unlock can withdraw it.");
    await tx.update(periodUnlockRequests).set({ status: "cancelled", decidedAt: new Date() }).where(eq(periodUnlockRequests.id, req.id));
    await audit(tx, ctx, { action: "finance.accounting_period.unlock_cancelled", entityType: "accounting_period", entityId: req.accountingPeriodId, siteId: null, after: { requestId: req.id } });
    return { cancelled: true };
  });
}
