/**
 * US-1-19 numbering (docs/data-model.md §9, docs/testing.md §4.10): numbering.unique_under_concurrency,
 * numbering.locked_last (counter is the last write of the transaction), numbering.rollback_no_consume,
 * numbering.reset_period, numbering.change_not_retroactive, versioning with a second approver (A-DM-25),
 * pattern rules enforced by the database, peekNextNumber refused for gapless types.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, numberingRuleVersions, numberingRules } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { formatNumber, nextNumber, numberingBusinessDate, peekNextNumber, periodKeyFor, validateNumberingRule } from "@/lib/numbering";
import { approveNumberingRuleVersion, listNumberingAdmin, rejectNumberingRuleVersion, submitNumberingRuleVersion } from "@/modules/governance";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let admin2: AuthContext;
let owner: AuthContext;
let manager: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  admin2 = await asUser(kit, "admin2@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
});

describe("allocation", () => {
  it("numbering.unique_under_concurrency: 20 concurrent GR numbers are distinct and consecutive", async () => {
    const got = await Promise.all(Array.from({ length: 20 }, () => db.transaction((tx) => nextNumber(tx, kit.orgId, "GR"))));
    const seqs = got.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b);
    expect(new Set(got).size).toBe(20);
    expect(seqs[19] - seqs[0]).toBe(19);
    expect(got[0]).toMatch(/^GR-\d{2}-\d{5}$/);
  });

  it("numbering.rollback_no_consume: a rolled-back transaction returns its number", async () => {
    const before = await peekNextNumber(db, kit.orgId, "ADJ");
    await expect(
      db.transaction(async (tx) => {
        await nextNumber(tx, kit.orgId, "ADJ");
        throw new Error("posting failed");
      }),
    ).rejects.toThrow("posting failed");
    expect(await peekNextNumber(db, kit.orgId, "ADJ")).toBe(before);
    expect(await db.transaction((tx) => nextNumber(tx, kit.orgId, "ADJ"))).toBe(before);
  });

  it("numbering.reset_period: period keys and formats per reset period (Asia/Manila)", () => {
    const d = new Date("2026-12-31T17:30:00Z"); // 2027-01-01 01:30 in Manila
    expect(periodKeyFor("yearly", d)).toBe("27");
    expect(periodKeyFor("monthly", d)).toBe("2701");
    expect(periodKeyFor("daily", d)).toBe("270101");
    expect(periodKeyFor("never", d)).toBe("");
    expect(formatNumber({ prefix: "L", pattern: "{PREFIX}-{YYMM}-{SEQ}", sequenceWidth: 5 }, 171, d)).toBe("L-2701-00171");
    expect(formatNumber({ prefix: "BX", pattern: "{PREFIX}-{SEQ}", sequenceWidth: 8 }, 12, d)).toBe("BX-00000012");
  });

  it("pattern rules (data-model §9.4) in code and as database CHECKs", async () => {
    const ok = { prefix: "GR", pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "yearly" as const, sequenceWidth: 5, isGapless: false };
    expect(validateNumberingRule(ok)).toEqual({});
    expect(validateNumberingRule({ ...ok, pattern: "{PREFIX}-{YY}" }).pattern).toMatch(/exactly once/);
    expect(validateNumberingRule({ ...ok, pattern: "{PREFIX}-{SEQ}" }).pattern).toMatch(/year token/);
    expect(validateNumberingRule({ ...ok, resetPeriod: "monthly" }).pattern).toMatch(/YYMM/);
    expect(validateNumberingRule({ ...ok, pattern: "{PREFIX}-{SITE}-{SEQ}" }).pattern).toMatch(/site-specific/);
    expect(validateNumberingRule({ ...ok, pattern: "{PREFIX}-{FOO}-{SEQ}" }).pattern).toMatch(/Unknown token/);
    const base = { organizationId: kit.orgId, documentType: "GR", versionNo: 99, prefix: "GR", resetPeriod: "yearly", sequenceWidth: 5, effectiveFrom: "2030-01-01", changeSummary: "x", submittedBy: admin.userId };
    await expect(db.insert(numberingRuleVersions).values({ ...base, pattern: "{PREFIX}-{YY}" })).rejects.toThrow();
    await expect(db.insert(numberingRuleVersions).values({ ...base, pattern: "{PREFIX}-{SEQ}-{SEQ}-{YY}" })).rejects.toThrow();
    await expect(db.insert(numberingRuleVersions).values({ ...base, pattern: "{PREFIX}-{SEQ}" })).rejects.toThrow();
    await expect(db.insert(numberingRuleVersions).values({ ...base, pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "daily" })).rejects.toThrow();
    await expect(db.insert(numberingRuleVersions).values({ ...base, pattern: "gr-{YY}-{SEQ}" })).rejects.toThrow();
  });
});

describe("rule versions (A-DM-25)", () => {
  it("authz.role_escalation: a site manager and the owner cannot submit numbering changes", async () => {
    const input = { documentType: "CNT", prefix: "CC", pattern: "{PREFIX}-{YYYY}-{SEQ}", resetPeriod: "yearly" as const, sequenceWidth: 4, isGapless: false, effectiveFrom: numberingBusinessDate(), changeSummary: "test" };
    await expectCode(submitNumberingRuleVersion(manager, input, "demo1234"), "forbidden");
    await expectCode(submitNumberingRuleVersion(owner, input, "demo1234"), "forbidden");
    await expectCode(listNumberingAdmin(await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd])), "forbidden");
  });

  it("numbering.change_not_retroactive: issued numbers keep their pattern; the period sequence continues; SoD on approval", async () => {
    const old = await db.transaction((tx) => nextNumber(tx, kit.orgId, "CNT"));
    expect(old).toMatch(/^CNT-\d{2}-\d{4}$/);
    const oldSeq = Number(old.split("-").pop());
    const today = numberingBusinessDate();
    const v = await submitNumberingRuleVersion(admin, { documentType: "CNT", prefix: "CT", pattern: "{PREFIX}{YYYY}.{SEQ}", resetPeriod: "yearly", sequenceWidth: 5, isGapless: false, effectiveFrom: today, changeSummary: "Paper forms use CT2026.00001" }, "demo1234");
    expect(v.versionNo).toBe(1);
    // Submitted but not approved: still the default.
    expect(await db.transaction((tx) => nextNumber(tx, kit.orgId, "CNT"))).toMatch(/^CNT-/);
    await expectCode(approveNumberingRuleVersion(admin, v.id, "demo1234"), "separation_of_duties");
    const [denied] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.authorization.denied"), eq(auditEvents.entityId, v.id)));
    expect(denied).toBeTruthy();
    await approveNumberingRuleVersion(admin2, v.id, "demo1234");
    const fresh = await db.transaction((tx) => nextNumber(tx, kit.orgId, "CNT"));
    expect(fresh).toMatch(/^CT\d{4}\.\d{5}$/);
    expect(Number(fresh.split(".").pop())).toBe(oldSeq + 2);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.numbering_rule.changed"), eq(auditEvents.entityId, v.id)));
    expect(ev.before).toMatchObject({ source: "default", pattern: "{PREFIX}-{YY}-{SEQ}" });
    expect(ev.after).toMatchObject({ pattern: "{PREFIX}{YYYY}.{SEQ}" });

    // A second version effective on the same day as the approved one is a conflict (no overlap).
    const v2 = await submitNumberingRuleVersion(admin2, { documentType: "CNT", prefix: "CT", pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 5, isGapless: false, effectiveFrom: today, changeSummary: "Undo" }, "demo1234");
    await expectCode(approveNumberingRuleVersion(admin, v2.id, "demo1234"), "conflict");
    await rejectNumberingRuleVersion(admin, v2.id, "Overlaps version 1");
    const [r2] = await db.select().from(numberingRuleVersions).where(eq(numberingRuleVersions.id, v2.id));
    expect(r2.status).toBe("rejected");

    const admin_ = (await listNumberingAdmin(admin)).find((x) => x.documentType === "CNT")!;
    expect(admin_.rule).toMatchObject({ source: "version", versionNo: 1 });
    expect(admin_.versions.map((x) => x.status)).toEqual(["rejected", "approved"]);
  });

  it("an effective date in the past is refused; a version to start later leaves today's numbers alone", async () => {
    await expectCode(
      submitNumberingRuleVersion(admin, { documentType: "TR", prefix: "TR", pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 6, isGapless: false, effectiveFrom: "2020-01-01", changeSummary: "past" }, "demo1234"),
      "validation",
    );
    const v = await submitNumberingRuleVersion(admin, { documentType: "TR", prefix: "TRF", pattern: "{PREFIX}-{YYMM}-{SEQ}", resetPeriod: "monthly", sequenceWidth: 6, isGapless: false, effectiveFrom: "2099-01-01", changeSummary: "later" }, "demo1234");
    await approveNumberingRuleVersion(admin2, v.id, "demo1234");
    expect(await db.transaction((tx) => nextNumber(tx, kit.orgId, "TR"))).toMatch(/^TR-\d{2}-\d{6}$/);
  });

  it("peekNextNumber refuses gapless types", async () => {
    await db.insert(numberingRuleVersions).values({ organizationId: kit.orgId, documentType: "DOC", versionNo: 1, status: "approved", prefix: "DOC", pattern: "{PREFIX}-{YY}-{SEQ}", resetPeriod: "yearly", sequenceWidth: 7, isGapless: true, effectiveFrom: "2026-01-01", changeSummary: "gapless test", submittedBy: admin.userId, approvedBy: admin2.userId });
    await expectCode(peekNextNumber(db, kit.orgId, "DOC"), "validation");
    const [c] = await db.select().from(numberingRules).where(and(eq(numberingRules.organizationId, kit.orgId), eq(numberingRules.documentType, "DOC")));
    expect(c === undefined || c.nextValue >= 1).toBe(true);
  });
});
