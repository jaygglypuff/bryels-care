/**
 * US-1-14 approval rules (docs/permissions-matrix.md §5.2): authz.threshold.rule_evaluation with an
 * injected date, site-specific over organization-wide, no rule → base permission, required_count,
 * escalation, AC4 configurable SoD, owner-only restricted rule editing with re-authentication and
 * `platform.approval_rule.changed`, and the inventory/master-data call sites reading the rules.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalRules, auditEvents, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  canDecideEvaluatedStep,
  createApprovalRule,
  evaluateApprovalRules,
  listApprovalRules,
  removeApprovalRule,
  rolesAllowedNow,
  sodRequired,
  updateApprovalRule,
} from "@/modules/governance";
import { loadApprovalPolicy } from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let admin: AuthContext;
let manager: AuthContext;
let managerRvs: AuthContext;
const PW = { password: "demo1234", reason: "Owner policy review (test)" };

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  managerRvs = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
});

const ruleInput = (over: Record<string, unknown> = {}) => ({
  documentType: "stock_adjustment",
  siteId: null,
  label: "Test step",
  thresholdBasis: "always",
  minValue: null,
  maxValue: null,
  currency: null,
  step: 1,
  requiredCount: 1,
  requiredRoleCodes: ["site_manager"],
  requiredPermissionCode: null,
  posterMayEqualApprover: false,
  escalationRoleCodes: null,
  escalationAfterHours: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "test",
  ...over,
});

describe("authz.threshold.rule_evaluation (seeded defaults, injected date)", () => {
  const on = new Date("2026-10-23T03:00:00Z");
  const steps = async (documentType: Parameters<typeof evaluateApprovalRules>[2]["documentType"], basis: Record<string, unknown>) =>
    (await evaluateApprovalRules(db, kit.orgId, { documentType, siteId: kit.nfd.id, basis: basis as never, on })).steps.map((s) => [s.step, s.roleCodes.join("|")]);

  it("stock adjustment: ≤ 20,000 one step; > 20,000 adds owner_director; unknown value is unbounded", async () => {
    expect(await steps("stock_adjustment", { amount: "20000" })).toEqual([[1, ""]]);
    expect(await steps("stock_adjustment", { amount: "20000.01" })).toEqual([[1, ""], [2, "owner_director"]]);
    expect(await steps("stock_adjustment", { amount: "unbounded" })).toEqual([[1, ""], [2, "owner_director"]]);
  });

  it("purchase order around 50,000; expense claim around 5,000; quote discount; sales order credit", async () => {
    expect(await steps("purchase_order", { amount: "50000" })).toEqual([[1, "site_manager"]]);
    expect(await steps("purchase_order", { amount: "50001" })).toEqual([[1, "site_manager"], [2, "owner_director"]]);
    expect(await steps("expense_claim", { amount: "4999.99" })).toEqual([[1, "site_manager"]]);
    expect(await steps("expense_claim", { amount: "5000.01" })).toEqual([[1, "site_manager"], [2, "finance"]]);
    expect(await steps("quote", { discount_pct: "10" })).toEqual([]);
    expect(await steps("quote", { discount_pct: "10.5" })).toEqual([[1, "site_manager"], [2, "finance"]]);
    expect(await steps("sales_order", { amount: "1000", credit_check_failed: true })).toEqual([[1, "finance"]]);
    expect(await steps("sales_order", { amount: "1000", credit_check_failed: false })).toEqual([]);
  });

  it("count variance > 2 % needs the owner; formula revisions need qa_qc then site_manager or owner", async () => {
    expect(await steps("stock_count_variance", { variance_pct: "2" })).toEqual([[1, ""]]);
    expect(await steps("stock_count_variance", { variance_pct: "2.5" })).toEqual([[1, ""], [2, "owner_director"]]);
    expect(await steps("formula_revision", {})).toEqual([[1, "qa_qc"], [2, "site_manager|owner_director"]]);
  });

  it("escalation roles may decide after escalation_after_hours", async () => {
    const ev = await evaluateApprovalRules(db, kit.orgId, { documentType: "purchase_request", siteId: kit.nfd.id, on });
    const step = ev.steps[0];
    const submitted = new Date("2026-10-20T00:00:00Z");
    expect(rolesAllowedNow(step, submitted, new Date("2026-10-21T00:00:00Z"))).toEqual(["site_manager"]);
    expect(rolesAllowedNow(step, submitted, new Date("2026-10-22T00:00:01Z")).sort()).toEqual(["owner_director", "site_manager"]);
  });
});

describe("rule administration (owner, restricted)", () => {
  it("authz.role_escalation: system_admin and site_manager cannot change approval rules", async () => {
    await expectCode(createApprovalRule(admin, ruleInput(), PW), "forbidden");
    await expectCode(createApprovalRule(manager, ruleInput(), PW), "forbidden");
  });

  it("re-authentication is required; a wrong password writes identity.reauth.failed", async () => {
    await expectCode(createApprovalRule(owner, ruleInput(), { password: "", reason: "x y z" }), "reauth_required");
    await expectCode(createApprovalRule(owner, ruleInput(), { password: "wrong-password", reason: "x y z" }), "reauth_required");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.reauth.failed"), eq(auditEvents.actorId, owner.userId)));
    expect(ev).toBeTruthy();
  });

  it("a site-specific rule beats the organization-wide rules; editing writes platform.approval_rule.changed with before/after", async () => {
    const r = await createApprovalRule(owner, ruleInput({ siteId: kit.rvs.id, label: "RVS: two managers", requiredCount: 2 }), PW);
    const rvs = await evaluateApprovalRules(db, kit.orgId, { documentType: "stock_adjustment", siteId: kit.rvs.id, basis: { amount: "99999" } });
    expect(rvs.steps).toHaveLength(1);
    expect(rvs.steps[0]).toMatchObject({ requiredCount: 2, roleCodes: ["site_manager"], ruleIds: [r.id] });
    const nfd = await evaluateApprovalRules(db, kit.orgId, { documentType: "stock_adjustment", siteId: kit.nfd.id, basis: { amount: "99999" } });
    expect(nfd.steps.map((s) => s.step)).toEqual([1, 2]);

    const after = await updateApprovalRule(owner, r.id, ruleInput({ siteId: kit.rvs.id, label: "RVS: one manager", requiredCount: 1 }), r.version, PW);
    expect(after.version).toBe(2);
    await expectCode(updateApprovalRule(owner, r.id, ruleInput({ siteId: kit.rvs.id }), 1, PW), "conflict");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.approval_rule.changed"), eq(auditEvents.entityId, r.id))).orderBy(desc(auditEvents.occurredAt)).limit(1);
    expect(ev.before).toMatchObject({ requiredCount: 2 });
    expect(ev.after).toMatchObject({ requiredCount: 1 });

    // authz.cross_site: a site manager at NFD does not see the RVS rule.
    const list = await listApprovalRules(manager);
    expect(list.rules.some((x) => x.id === r.id)).toBe(false);
    expect((await listApprovalRules(managerRvs)).rules.some((x) => x.id === r.id)).toBe(true);

    await removeApprovalRule(owner, r.id, PW);
    const back = await evaluateApprovalRules(db, kit.orgId, { documentType: "stock_adjustment", siteId: kit.rvs.id, basis: { amount: "99999" } });
    expect(back.steps.map((s) => s.step)).toEqual([1, 2]);
  });

  it("rules outside their effective dates are ignored; validation rejects bad bounds", async () => {
    await expect(createApprovalRule(owner, ruleInput({ thresholdBasis: "amount", minValue: "10", maxValue: "5", currency: "PHP" }), PW)).rejects.toThrow(/upper bound/);
    const r = await createApprovalRule(owner, ruleInput({ documentType: "over_shipment", label: "Future rule", effectiveFrom: "2030-01-01", requiredRoleCodes: ["owner_director"] }), PW);
    const now = await evaluateApprovalRules(db, kit.orgId, { documentType: "over_shipment", siteId: kit.nfd.id, on: new Date("2026-10-23") });
    expect(now.steps.map((s) => s.roleCodes)).toEqual([["site_manager"]]);
    const later = await evaluateApprovalRules(db, kit.orgId, { documentType: "over_shipment", siteId: kit.nfd.id, on: new Date("2030-06-01") });
    expect(later.steps[0].roleCodes.sort()).toEqual(["owner_director", "site_manager"]);
    await removeApprovalRule(owner, r.id, PW);
  });

  it("no matching rule → base permission suffices (master data falls back to one step)", async () => {
    await db.update(approvalRules).set({ deletedAt: new Date() }).where(and(eq(approvalRules.organizationId, kit.orgId), eq(approvalRules.documentType, "work_instruction_revision")));
    const policy = await loadApprovalPolicy(db, kit.orgId, "work_instruction_revision");
    expect(policy).toEqual([{ step: 1, label: "Approval", roles: [], permission: "masterdata.work_instruction.approve" }]);
    await db.update(approvalRules).set({ deletedAt: null }).where(and(eq(approvalRules.organizationId, kit.orgId), eq(approvalRules.documentType, "work_instruction_revision")));
    const restored = await loadApprovalPolicy(db, kit.orgId, "work_instruction_revision");
    expect(restored[0].roles).toEqual(["qa_qc", "site_manager", "owner_director"]);
  });

  it("canDecideEvaluatedStep checks permission and role", async () => {
    const ev = await evaluateApprovalRules(db, kit.orgId, { documentType: "stock_adjustment", siteId: kit.nfd.id, basis: { amount: "50000" } });
    expect(canDecideEvaluatedStep(manager, ev.steps[0])).toBe(true);
    expect(canDecideEvaluatedStep(manager, ev.steps[1])).toBe(false);
    expect(canDecideEvaluatedStep(owner, ev.steps[1])).toBe(true);
  });
});

describe("AC4 configurable separation of duties", () => {
  it("approvals.sod.<type> = false switches SoD off for that type only; mandatory types ignore it", async () => {
    expect(await sodRequired(db, kit.orgId, "sales_order")).toBe(true);
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "approvals.sod.sales_order", value: false });
    expect(await sodRequired(db, kit.orgId, "sales_order")).toBe(false);
    expect(await sodRequired(db, kit.orgId, "quote")).toBe(true);
    expect(await sodRequired(db, kit.orgId, "stock_adjustment")).toBe(true);
    await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "approvals.sod.sales_order")));
  });
});
