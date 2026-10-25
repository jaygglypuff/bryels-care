import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalDecisions, financialPostings } from "@/db/schema";
import { SETTINGS } from "@/lib/settings";
import {
  approvePeriodUnlock,
  approveTaxConfiguration,
  cancelPeriodUnlock,
  computeTaxedLines,
  createExpenseClaim,
  decideExpenseClaim,
  listExpenseClaims,
  listPeriods,
  listTaxConfigurations,
  lockPeriod,
  postExpenseClaim,
  proposeTaxConfiguration,
  rejectPeriodUnlock,
  requestPeriodUnlock,
  resolveTaxConfiguration,
  retireTaxConfiguration,
  salesTaxRateFor,
  submitExpenseClaim,
} from "@/modules/finance";
import { salesTaxRatePct } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, auditCount, bundle, clearOrgSetting, lastMonthDate, loadW4b, periodRow, setOrgSetting, taxRows, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;


beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
});

describe("US-6-14 tax configuration as reviewed data", () => {
  it("no tax rate exists in code: the sales tax setting moved to the reviewed configuration", () => {
    expect(Object.keys(SETTINGS)).not.toContain("sales.tax.rate_pct");
    expect(SETTINGS["finance.tax.default_sales_code"].default).toBeNull();
  });

  it("finance.tax_config.unreviewed_not_effective: a proposed rate resolves to nothing until a second person approves it", async () => {
    const row = await proposeTaxConfiguration(w.finance, { code: "TST-A", name: "Fictional output tax", kind: "vat_output", ratePct: "10", inclusive: false, appliesTo: "sales", rounding: "line", effectiveFrom: "2026-01-01", sourceNote: "FICTIONAL" }, { password: PW });
    expect(row.status).toBe("proposed");
    expect(row.reviewedBy).toBeNull();
    expect(await resolveTaxConfiguration(db, w.orgId, "TST-A", "sales", "2026-06-01")).toBeNull();
    const list = await listTaxConfigurations(w.finance);
    expect(list.rows.find((r) => r.id === row.id)?.pendingReview).toBe(true);
    // The proposer cannot approve their own rate (two-person approval).
    await expectCode(approveTaxConfiguration(w.finance, row.id, { password: PW }), "separation_of_duties");
    const ok = await approveTaxConfiguration(w.finance2, row.id, { note: "Checked against the accountant's memo (fictional)", password: PW });
    expect(ok.status).toBe("approved");
    expect(ok.reviewedBy).toBe(w.finance2.userId);
    expect((await resolveTaxConfiguration(db, w.orgId, "TST-A", "sales", "2026-06-01"))?.ratePct).toBe("10.0000");
    expect(await auditCount(row.id, "finance.tax_configuration.changed")).toBe(1);
  });

  it("finance.tax_config.db_requires_reviewer: an approved row without a reviewer is refused by the database", async () => {
    const [r] = await taxRows(w.orgId, "TST-A");
    await expect(db.execute(sql`update tax_configurations set reviewed_by = null where id = ${r.id}`)).rejects.toThrow();
  });

  it("effective-dated versions: a later version applies from its date; earlier dates keep the earlier rate", async () => {
    const v2 = await proposeTaxConfiguration(w.finance, { code: "TST-A", name: "Fictional output tax", kind: "vat_output", ratePct: "12", inclusive: false, appliesTo: "sales", rounding: "line", effectiveFrom: "2026-09-01" }, { password: PW });
    expect(v2.versionNo).toBe(2);
    await approveTaxConfiguration(w.finance2, v2.id, { password: PW });
    expect((await resolveTaxConfiguration(db, w.orgId, "TST-A", "sales", "2026-08-31"))?.ratePct).toBe("10.0000");
    expect((await resolveTaxConfiguration(db, w.orgId, "TST-A", "sales", "2026-09-01"))?.ratePct).toBe("12.0000");
    const retired = await retireTaxConfiguration(w.finance, v2.id, { reason: "Superseded in the test", effectiveTo: "2026-10-01", password: PW });
    expect(retired.status).toBe("retired");
    // With v2 retired, v1 applies again; history is kept.
    expect((await resolveTaxConfiguration(db, w.orgId, "TST-A", "sales", "2026-09-15"))?.ratePct).toBe("10.0000");
  });

  it("restricted: changing tax configuration needs finance.tax_config.admin and the password", async () => {
    const input = { code: "TST-B", name: "x tax", kind: "other" as const, ratePct: "1", inclusive: false, appliesTo: "sales" as const, rounding: "line" as const, effectiveFrom: "2026-01-01" };
    await expectCode(proposeTaxConfiguration(w.sales, input, { password: PW }), "forbidden");
    await expectCode(proposeTaxConfiguration(w.owner, input, { password: PW }), "forbidden");
    await expectCode(proposeTaxConfiguration(w.admin, input, { password: PW }), "forbidden");
    await expectCode(proposeTaxConfiguration(w.finance, input, { password: "wrong-password" }), "reauth_required");
    await expectCode(listTaxConfigurations(w.manager), "forbidden");
  });

  it("quotes and orders read the sales rate from the configuration (W3D setting moved): 0 % until a code is configured", async () => {
    await clearOrgSetting(w.orgId, "finance.tax.default_sales_code");
    expect((await salesTaxRatePct(db, w.orgId)).toString()).toBe("0");
    await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "TST-A");
    expect(await salesTaxRateFor(db, w.orgId, "2026-06-01")).toBe("10.0000");
    await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "NOPE");
    await expectCode(salesTaxRateFor(db, w.orgId, "2026-06-01"), "validation");
    await clearOrgSetting(w.orgId, "finance.tax.default_sales_code");
  });

  it("line tax arithmetic: exclusive line rounding, inclusive rates, document rounding", () => {
    const ex = computeTaxedLines([{ qty: "3", unitAmount: "33.335", ratePct: "12", inclusive: false, rounding: "line" }]);
    expect(ex).toMatchObject({ subtotal: "100.0100", tax: "12.0000", total: "112.0100" });
    const inc = computeTaxedLines([{ qty: "1", unitAmount: "112", ratePct: "12", inclusive: true, rounding: "line" }]);
    expect(inc).toMatchObject({ subtotal: "100.0000", tax: "12.0000", total: "112.0000" });
    const doc = computeTaxedLines([
      { qty: "1", unitAmount: "0.10", ratePct: "12", inclusive: false, rounding: "document" },
      { qty: "1", unitAmount: "0.10", ratePct: "12", inclusive: false, rounding: "document" },
    ]);
    // 0.012 + 0.012 = 0.024 → 0.02 once (line rounding would give 0.01 + 0.01).
    expect(doc.tax).toBe("0.0200");
  });
});

describe("US-6-13 accounting periods and locks", () => {
  const lastMonth = () => lastMonthDate().slice(0, 7);

  it("lists the last 12 months (open by default)", async () => {
    const list = await listPeriods(w.finance);
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(list.find((p) => p.isCurrent)?.status).toBe("open");
    await expectCode(listPeriods(w.warehouse), "forbidden");
  });

  it("pre-lock checklist: open documents dated in the period block the lock unless acknowledged with a reason", async () => {
    const claim = await createExpenseClaim(w.operator, { categoryCode: "travel", description: "Fictional jeepney fares", expenseDate: lastMonthDate(), amount: "120" });
    await submitExpenseClaim(w.operator, claim.claimId);
    const e = await expectCode(lockPeriod(w.finance, lastMonth(), { reason: "Month-end close (test)", password: PW }), "conflict");
    expect(e.details?.code).toBe("PRELOCK_OPEN_ITEMS");
    expect((e.details?.items as unknown[]).length).toBeGreaterThanOrEqual(1);
    await expectCode(lockPeriod(w.finance, lastMonth(), { reason: "Month-end close (test)", acknowledge: true, password: PW }), "validation");
    const locked = await lockPeriod(w.finance, lastMonth(), { reason: "Month-end close (test)", acknowledge: true, acknowledgementNote: "Claim carried to next month", password: PW });
    expect(locked.status).toBe("locked");
    expect(await auditCount(locked.id, "finance.accounting_period.locked")).toBe(1);
  });

  it("period.locked_posting_rejected: posting dated into a locked period is refused with 409 PERIOD_LOCKED", async () => {
    const [claim] = (await listExpenseClaims(w.operator, { scope: "mine" })).filter((c) => c.status === "submitted");
    await decideExpenseClaim(w.manager, claim.id, { decision: "approved" });
    // Approved today → posting date today (open); force the approval date into the locked month.
    await db.execute(sql`update expense_claims set approved_at = ${lastMonthDate() + "T04:00:00Z"}::timestamptz where id = ${claim.id}`);
    const before = (await db.select().from(financialPostings)).length;
    const e = await expectCode(postExpenseClaim(w.finance, claim.id, { password: PW }), "conflict");
    expect(e.details?.code).toBe("PERIOD_LOCKED");
    expect((await db.select().from(financialPostings)).length).toBe(before);
  });

  it("only finance locks; nobody but the period lock holders sees or changes periods", async () => {
    await expectCode(lockPeriod(w.owner, "2025-01", { reason: "test", password: PW }), "forbidden");
    await expectCode(lockPeriod(w.admin, "2025-01", { reason: "test", password: PW }), "forbidden");
    await expectCode(lockPeriod(w.sales, "2025-01", { reason: "test", password: PW }), "forbidden");
    await expectCode(lockPeriod(w.finance, "2025-01", { reason: "test", password: "wrong" }), "reauth_required");
  });

  it("finance.period_unlock_two_approvals: unlock needs the finance request and a different owner approval", async () => {
    const code = lastMonth();
    await expectCode(requestPeriodUnlock(w.owner, code, { reason: "Late supplier bill (test)", password: PW }), "forbidden");
    const req = await requestPeriodUnlock(w.finance, code, { reason: "Late supplier bill (test)", password: PW });
    expect((await periodRow(w.orgId, code)).status).toBe("locked");
    await expectCode(requestPeriodUnlock(w.finance2, code, { reason: "again", password: PW }), "conflict");
    // The requester cannot give the second approval; finance lacks the unlock (.void) permission altogether.
    await expectCode(approvePeriodUnlock(w.finance, req.id, { password: PW }), "forbidden");
    const ownerAsRequester = withPermissions(w.finance, bundle("owner_director"), ["owner_director"]);
    await expectCode(approvePeriodUnlock(ownerAsRequester, req.id, { password: PW }), "separation_of_duties");
    const r = await approvePeriodUnlock(w.owner, req.id, { note: "Agreed (test)", password: PW });
    expect(r.unlocked).toBe(true);
    const p = await periodRow(w.orgId, code);
    expect(p.status).toBe("open");
    expect(p.unlockedBy).toBe(w.owner.userId);
    const decisions = await db.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "period_lock_unlock"), eq(approvalDecisions.recordId, req.id)));
    expect(new Set(decisions.map((d) => d.decidedBy)).size).toBe(2);
    expect(await auditCount(p.id, "finance.accounting_period.unlocked")).toBe(1);
  });

  it("an unlock request can be rejected by the approver or withdrawn by the requester", async () => {
    const code = "2025-03";
    await lockPeriod(w.finance, code, { reason: "Old period (test)", password: PW });
    const r1 = await requestPeriodUnlock(w.finance, code, { reason: "Typo (test)", password: PW });
    await expectCode(rejectPeriodUnlock(w.owner, r1.id, { reason: "" }), "validation");
    await rejectPeriodUnlock(w.owner, r1.id, { reason: "Not needed (test)" });
    const r2 = await requestPeriodUnlock(w.finance, code, { reason: "Typo again (test)", password: PW });
    await expectCode(cancelPeriodUnlock(w.finance2, r2.id), "forbidden");
    await cancelPeriodUnlock(w.finance, r2.id);
    expect((await periodRow(w.orgId, code)).status).toBe("locked");
  });
});
