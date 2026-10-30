/**
 * ADR-075 / ADR-082 §4 (owner QA 2026-10-30): "To approve" lists by default only what the signed-in user
 * can decide now. An expense claim whose open step belongs to the site manager is decidable by the site
 * manager, and only "waiting for the site manager" for the owner (no override) and for finance; the
 * header badge equals the number of decidable rows; other sites never see it; the claimant cannot
 * decide; after step 1 the claim moves to finance and leaves the manager's decidable list.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { listMyApprovals, myApprovalCount, myApprovalInbox, refreshActionItems } from "@/modules/action-centre";
import { createExpenseClaim, decideExpenseClaim, submitExpenseClaim } from "@/modules/finance";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { clearOrgSetting, loadW4b, setOrgSetting, today, type W4b } from "../../support/w4b";

let w: W4b;
let small: string; // ₱350, one step (site manager)
let large: string; // ₱6,000, site manager then finance

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  registerAppHooks();
  await setOrgSetting(w.orgId, "governance.owner_override", false);
  const a = await createExpenseClaim(w.operator, { categoryCode: "travel", description: "Jeepney fare to the supplier (fictional)", expenseDate: today(), amount: "350" });
  await submitExpenseClaim(w.operator, a.claimId);
  small = a.claimId;
  const b = await createExpenseClaim(w.operator, { categoryCode: "supplies", description: "Spare gaskets (fictional)", expenseDate: today(), amount: "6000" });
  await setOrgSetting(w.orgId, "finance.expense.receipt_required_above", 10000);
  try {
    await submitExpenseClaim(w.operator, b.claimId);
  } finally {
    await clearOrgSetting(w.orgId, "finance.expense.receipt_required_above");
  }
  large = b.claimId;
  await refreshActionItems(w.orgId);
}, 240_000);

const row = async (ctx: Parameters<typeof listMyApprovals>[0], id: string) => (await listMyApprovals(ctx)).find((r) => r.entityId === id);

async function badgeMatchesList(ctx: Parameters<typeof listMyApprovals>[0]) {
  const inbox = await myApprovalInbox(ctx);
  expect(await myApprovalCount(ctx)).toBe(inbox.decidable.length);
  expect(inbox.decidable.every((r) => r.canDecide)).toBe(true);
  expect(inbox.waiting.every((r) => !r.canDecide && !!r.waitingFor)).toBe(true);
  return inbox;
}

describe("ADR-082 To approve: only what you can decide now", () => {
  it("the site manager can decide step 1; the row is plain (real name, ₱ amount, no raw keys)", async () => {
    const r = await row(w.manager, small);
    expect(r).toBeTruthy();
    expect(r!.canDecide).toBe(true);
    expect(r!.waitingFor).toBeNull();
    const [op] = await db.select().from(users).where(eq(users.email, "operator.nfd@bryels-care.test"));
    expect(r!.requestedBy.name).toBe(op.displayName);
    expect(r!.amountText).toBe("₱350.00");
    expect(r!.what).toContain("₱350.00");
    expect(r!.what).toContain(op.displayName);
    expect(r!.displayTitle).not.toMatch(/[a-z]_[a-z]/);
    const inbox = await badgeMatchesList(w.manager);
    expect(inbox.decidable.some((x) => x.entityId === small)).toBe(true);
  });

  it("the owner (no override) does not get the site-manager step: it waits for the site manager, badge excludes it", async () => {
    expect(w.owner.ownerOverride).toBe(false);
    const r = await row(w.owner, small);
    expect(r).toBeTruthy(); // visible (owner holds the approve permission) …
    expect(r!.canDecide).toBe(false); // … but not decidable
    expect(r!.waitingFor).toMatch(/^Waiting for the site manager/i);
    const inbox = await badgeMatchesList(w.owner);
    expect(inbox.decidable.some((x) => x.entityId === small || x.entityId === large)).toBe(false);
    expect(inbox.waiting.some((x) => x.entityId === small)).toBe(true);
    // The service agrees: the owner is refused.
    await expect(decideExpenseClaim(w.owner, small, { decision: "approved" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the real owner context (from assignments, override off) gets the same verdict", async () => {
    const [o] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
    const owner = (await buildContextForUser(o.id))!;
    expect(owner.ownerOverride).toBe(false);
    const inbox = await badgeMatchesList(owner);
    expect(inbox.decidable.some((x) => x.entityId === small)).toBe(false);
  });

  it("cross-site and role negatives: another site sees nothing; the claimant cannot decide", async () => {
    expect(await row(w.managerRvs, small)).toBeUndefined();
    expect((await myApprovalInbox(w.managerRvs)).decidable.some((x) => x.entityId === small)).toBe(false);
    expect(await row(w.operator, small)).toBeUndefined(); // no approve permission
    expect(await row(w.warehouse, small)).toBeUndefined();
  });

  it("after the site manager approves step 1, the claim waits for finance and leaves the manager's list", async () => {
    await decideExpenseClaim(w.manager, large, { decision: "approved" });
    await refreshActionItems(w.orgId);
    const m = await row(w.manager, large);
    // The manager may still see it, but never as decidable (wrong role for step 2, and already approved step 1).
    if (m) expect(m.canDecide).toBe(false);
    const f = await row(w.finance, large);
    expect(f?.canDecide).toBe(true);
    expect(f?.amountText).toBe("₱6,000.00");
    await badgeMatchesList(w.manager);
    await badgeMatchesList(w.finance);
  });

  it("with the owner override on, the owner may decide any step (recorded in the audit)", async () => {
    await setOrgSetting(w.orgId, "governance.owner_override", true);
    try {
      const [o] = await db.select().from(users).where(eq(users.email, "owner@bryels-care.test"));
      const owner = (await buildContextForUser(o.id))!;
      expect(owner.ownerOverride).toBe(true);
      const r = await row(owner, small);
      expect(r?.canDecide).toBe(true);
      await badgeMatchesList(owner);
    } finally {
      await setOrgSetting(w.orgId, "governance.owner_override", false);
    }
  });

  it("a record decided since the last sweep is dropped instead of offered with a failing button", async () => {
    await decideExpenseClaim(w.manager, small, { decision: "approved" });
    // No refresh: the stored action item is stale, the verdict sees the claim is no longer submitted.
    expect(await row(w.manager, small)).toBeUndefined();
    await badgeMatchesList(w.manager);
  });
});
