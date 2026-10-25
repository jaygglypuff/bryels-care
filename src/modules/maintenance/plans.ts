import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import { equipment, maintenancePlans, maintenanceWorkOrders, sites } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { DUE_STATE_LABEL, type DueState, addDays, canMovePlan, planDueState, type MaintenancePlanStatus } from "./rules";
import { CreatePlanInput, PlanStatusInput, UpdatePlanInput, parse } from "./schemas";
import { assertTechnician, equipmentInScope, manilaToday, namesOf, syncEquipmentDue, usersWithPermissionAt } from "./shared";
import { USAGE_UNIT, planUsage } from "./usage";

/**
 * Preventive-maintenance plans (US-6-19, FR-production-15, process map W13-01/W13-02) on the W1D
 * equipment register: time based (interval in days; the next due date drives the equipment's
 * `maintenance_due_date`, hence its availability) or usage based (distinct batches or hours of use from
 * production's equipment uses; an overdue usage plan is a `maintenance_due` availability reason through
 * the provider registered in src/modules/wiring.ts). Intervals and lead days are the company's maintenance
 * configuration (A-W4C-04).
 */

type PlanRow = typeof maintenancePlans.$inferSelect;

async function lockPlan(tx: Tx, ctx: AuthContext, planId: string) {
  const [p] = await tx.select().from(maintenancePlans).where(and(eq(maintenancePlans.id, planId), eq(maintenancePlans.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!p || !ctx.allowedSiteIds.includes(p.siteId)) throw new DomainError("not_found", "PM plan not found in your sites.");
  return p;
}

export async function createMaintenancePlan(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.plan.create");
  const input = parse(CreatePlanInput, raw);
  return db.transaction(async (tx) => {
    const e = await equipmentInScope(tx, ctx, input.equipmentId);
    ctx.requireAt("maintenance.plan.create", e.siteId);
    await assertTechnician(tx, ctx, input.responsibleUserId, e.siteId, "responsibleUserId");
    const today = manilaToday();
    let nextDueOn: string | null = null;
    if (input.triggerKind === "time") {
      nextDueOn = input.firstDueOn ?? addDays(today, input.intervalDays!);
      if (input.firstDueOn && input.firstDueOn < today) throw new DomainError("validation", "The first due date cannot be in the past.", { field: "firstDueOn", fieldErrors: { firstDueOn: "Choose today or later." } });
    }
    const planNumber = await nextNumber(tx, ctx.organizationId, "PM");
    const [p] = await tx
      .insert(maintenancePlans)
      .values({
        organizationId: ctx.organizationId,
        siteId: e.siteId,
        equipmentId: e.id,
        planNumber,
        title: input.title,
        instructions: input.instructions,
        triggerKind: input.triggerKind,
        intervalDays: input.triggerKind === "time" ? input.intervalDays : null,
        usageMetric: input.triggerKind === "usage" ? input.usageMetric : null,
        usageInterval: input.triggerKind === "usage" ? input.usageInterval : null,
        leadDays: input.leadDays,
        takesEquipmentDown: input.takesEquipmentDown,
        responsibleUserId: input.responsibleUserId,
        nextDueOn,
        createdBy: ctx.userId,
      })
      .returning();
    const sync = p.triggerKind === "time" ? await syncEquipmentDue(tx, ctx, e.id, `PM plan ${planNumber} created`) : null;
    await audit(tx, ctx, {
      action: "maintenance.plan.created",
      entityType: "maintenance_plan",
      entityId: p.id,
      entityNumber: planNumber,
      siteId: p.siteId,
      after: { equipment: e.code, triggerKind: p.triggerKind, intervalDays: p.intervalDays, usageMetric: p.usageMetric, usageInterval: p.usageInterval, nextDueOn, equipmentMaintenanceDueDate: sync?.maintenanceDueDate ?? null },
    });
    return { planId: p.id, planNumber };
  });
}

export async function updateMaintenancePlan(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.plan.edit");
  const input = parse(UpdatePlanInput, raw);
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, input.planId);
    ctx.requireAt("maintenance.plan.edit", p.siteId);
    if (p.status === "retired") throw new DomainError("state", `PM plan ${p.planNumber} is retired.`);
    const set: Partial<typeof maintenancePlans.$inferInsert> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.instructions !== undefined) set.instructions = input.instructions;
    if (input.leadDays !== undefined) set.leadDays = input.leadDays;
    if (input.takesEquipmentDown !== undefined) set.takesEquipmentDown = input.takesEquipmentDown;
    if (input.responsibleUserId !== undefined) {
      await assertTechnician(tx, ctx, input.responsibleUserId, p.siteId, "responsibleUserId");
      set.responsibleUserId = input.responsibleUserId;
    }
    if (p.triggerKind === "time") {
      if (input.intervalDays !== undefined && input.intervalDays !== null) set.intervalDays = input.intervalDays;
      if (input.nextDueOn !== undefined && input.nextDueOn !== null) {
        if (input.nextDueOn < manilaToday()) throw new DomainError("validation", "The next due date cannot be in the past.", { field: "nextDueOn", fieldErrors: { nextDueOn: "Choose today or later." } });
        set.nextDueOn = input.nextDueOn;
      }
    } else if (input.usageInterval !== undefined && input.usageInterval !== null) {
      if (new Decimal(input.usageInterval).lte(0)) throw new DomainError("validation", "Enter the usage interval (more than 0).", { field: "usageInterval" });
      set.usageInterval = input.usageInterval;
    }
    const changed = Object.fromEntries(Object.entries(set).filter(([k, v]) => String((p as Record<string, unknown>)[k] ?? "") !== String(v ?? "")));
    if (!Object.keys(changed).length) throw new DomainError("validation", "Nothing changed.");
    await tx.update(maintenancePlans).set({ ...changed, updatedAt: new Date() }).where(eq(maintenancePlans.id, p.id));
    if ("nextDueOn" in changed && p.status === "active") await syncEquipmentDue(tx, ctx, p.equipmentId, `PM plan ${p.planNumber} due date changed`, p.nextDueOn);
    await audit(tx, ctx, { action: "maintenance.plan.updated", entityType: "maintenance_plan", entityId: p.id, entityNumber: p.planNumber, siteId: p.siteId, before: Object.fromEntries(Object.keys(changed).map((k) => [k, (p as Record<string, unknown>)[k]])), after: changed });
    return { planId: p.id };
  });
}

/** Pause, resume or retire a plan (reason required except to resume); the equipment's due date follows. */
export async function changeMaintenancePlanStatus(ctx: AuthContext, raw: unknown) {
  ctx.require("maintenance.plan.edit");
  const input = parse(PlanStatusInput, raw);
  return db.transaction(async (tx) => {
    const p = await lockPlan(tx, ctx, input.planId);
    ctx.requireAt("maintenance.plan.edit", p.siteId);
    if (!canMovePlan(p.status, input.toStatus)) throw new DomainError("state", `PM plan ${p.planNumber} is ${p.status}; it cannot become ${input.toStatus}.`);
    if (input.toStatus !== "active" && !input.reason) throw new DomainError("validation", "Give a reason of at least 5 characters.", { field: "reason", fieldErrors: { reason: "Required." } });
    if (input.toStatus === "retired") {
      const [live] = await tx.select({ n: maintenanceWorkOrders.workOrderNumber }).from(maintenanceWorkOrders).where(and(eq(maintenanceWorkOrders.planId, p.id), inArray(maintenanceWorkOrders.status, ["open", "in_progress", "on_hold"]))).limit(1);
      if (live) throw new DomainError("state", `Work order ${live.n} of this plan is still open. Complete or cancel it first.`);
    }
    await tx.update(maintenancePlans).set({ status: input.toStatus, statusReason: input.toStatus === "active" ? null : input.reason, updatedAt: new Date() }).where(eq(maintenancePlans.id, p.id));
    if (p.triggerKind === "time") await syncEquipmentDue(tx, ctx, p.equipmentId, `PM plan ${p.planNumber} ${input.toStatus}`, p.nextDueOn);
    await audit(tx, ctx, { action: `maintenance.plan.${input.toStatus === "active" ? "resumed" : input.toStatus}`, entityType: "maintenance_plan", entityId: p.id, entityNumber: p.planNumber, siteId: p.siteId, reason: input.reason, before: { status: p.status }, after: { status: input.toStatus } });
    return { status: input.toStatus as MaintenancePlanStatus };
  });
}

/* ------------------------------------------------------------------ queries */

export type PlanView = PlanRow & { equipmentCode: string; equipmentName: string; siteCode: string; usage: string | null; usageUnit: string | null; dueState: DueState; dueLabel: string; liveWorkOrder: { id: string; number: string; status: string } | null };

async function withDue(ctx: AuthContext, rows: { p: PlanRow; equipmentCode: string; equipmentName: string; siteCode: string }[]): Promise<PlanView[]> {
  const today = manilaToday();
  const usage = await planUsage(db, rows.map((r) => r.p));
  const live = rows.length
    ? await db
        .select({ planId: maintenanceWorkOrders.planId, id: maintenanceWorkOrders.id, number: maintenanceWorkOrders.workOrderNumber, status: maintenanceWorkOrders.status })
        .from(maintenanceWorkOrders)
        .where(and(inArray(maintenanceWorkOrders.planId, rows.map((r) => r.p.id)), inArray(maintenanceWorkOrders.status, ["open", "in_progress", "on_hold"])))
    : [];
  const leadBySite = new Map<string, number>();
  const pctBySite = new Map<string, number>();
  for (const s of new Set(rows.map((r) => r.p.siteId))) {
    leadBySite.set(s, await getSetting(db, ctx.organizationId, "maintenance.pm.due_soon_days", s));
    pctBySite.set(s, await getSetting(db, ctx.organizationId, "maintenance.pm.usage_due_soon_pct", s));
  }
  return rows.map(({ p, ...rest }) => {
    const used = usage.get(p.id) ?? null;
    const dueState = planDueState(p, { today, leadDays: p.leadDays ?? leadBySite.get(p.siteId) ?? 7, usage: used, usageDueSoonPct: pctBySite.get(p.siteId) ?? 90 });
    const w = live.find((x) => x.planId === p.id);
    return { ...p, ...rest, usage: used ? used.toDecimalPlaces(1).toString() : null, usageUnit: p.usageMetric ? (USAGE_UNIT[p.usageMetric] ?? p.usageMetric) : null, dueState, dueLabel: DUE_STATE_LABEL[dueState], liveWorkOrder: w ? { id: w.id, number: w.number, status: w.status } : null };
  });
}

export async function listMaintenancePlans(ctx: AuthContext, f: { equipmentId?: string; status?: string; due?: boolean } = {}) {
  ctx.require("maintenance.plan.view");
  const conds = [eq(maintenancePlans.organizationId, ctx.organizationId), inArray(maintenancePlans.siteId, ctx.allowedSiteIds)];
  if (f.equipmentId) conds.push(eq(maintenancePlans.equipmentId, f.equipmentId));
  if (!f.status || f.status === "live") conds.push(inArray(maintenancePlans.status, ["active", "paused"]));
  else if (f.status !== "all") conds.push(eq(maintenancePlans.status, f.status));
  const rows = await db
    .select({ p: maintenancePlans, equipmentCode: equipment.code, equipmentName: equipment.name, siteCode: sites.code })
    .from(maintenancePlans)
    .innerJoin(equipment, eq(equipment.id, maintenancePlans.equipmentId))
    .innerJoin(sites, eq(sites.id, maintenancePlans.siteId))
    .where(and(...conds))
    .orderBy(asc(sites.code), asc(equipment.code), asc(maintenancePlans.planNumber));
  const out = await withDue(ctx, rows);
  const order: Record<DueState, number> = { overdue: 0, due: 1, due_soon: 2, ok: 3 };
  const sorted = out.sort((a, b) => order[a.dueState] - order[b.dueState]);
  return f.due ? sorted.filter((p) => p.dueState !== "ok") : sorted;
}

export async function getMaintenancePlan(ctx: AuthContext, planId: string) {
  ctx.require("maintenance.plan.view");
  if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new DomainError("not_found", "PM plan not found in your sites.");
  const rows = await db
    .select({ p: maintenancePlans, equipmentCode: equipment.code, equipmentName: equipment.name, siteCode: sites.code })
    .from(maintenancePlans)
    .innerJoin(equipment, eq(equipment.id, maintenancePlans.equipmentId))
    .innerJoin(sites, eq(sites.id, maintenancePlans.siteId))
    .where(and(eq(maintenancePlans.id, planId), eq(maintenancePlans.organizationId, ctx.organizationId)))
    .limit(1);
  if (!rows.length || !ctx.allowedSiteIds.includes(rows[0].p.siteId)) throw new DomainError("not_found", "PM plan not found in your sites.");
  const [plan] = await withDue(ctx, rows);
  const history = await db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.planId, plan.id)).orderBy(desc(maintenanceWorkOrders.createdAt)).limit(50);
  const names = await namesOf([plan.responsibleUserId, plan.createdBy, ...history.map((h) => h.completedBy)]);
  return {
    plan: { ...plan, responsibleName: plan.responsibleUserId ? (names.get(plan.responsibleUserId) ?? null) : null, createdByName: names.get(plan.createdBy) ?? null },
    history: history.map((h) => ({ ...h, completedByName: h.completedBy ? (names.get(h.completedBy) ?? null) : null })),
    technicians: await usersWithPermissionAt(db, ctx.organizationId, "maintenance.work_order.edit", plan.siteId),
    can: {
      edit: plan.status !== "retired" && ctx.canAt("maintenance.plan.edit", plan.siteId),
      createWorkOrder: plan.status === "active" && !plan.liveWorkOrder && ctx.canAt("maintenance.work_order.create", plan.siteId),
    },
  };
}

/** Plans that are due soon, due or overdue, organization-wide (action centre `pm_due` / `pm_overdue`). */
export async function pmDueCandidates(organizationId: string, now: Date = new Date()) {
  const rows = await db
    .select({ p: maintenancePlans, equipmentCode: equipment.code, equipmentName: equipment.name })
    .from(maintenancePlans)
    .innerJoin(equipment, eq(equipment.id, maintenancePlans.equipmentId))
    .where(and(eq(maintenancePlans.organizationId, organizationId), eq(maintenancePlans.status, "active")));
  if (!rows.length) return [];
  const today = manilaToday(now);
  const usage = await planUsage(db, rows.map((r) => r.p));
  const out = [];
  for (const { p, equipmentCode, equipmentName } of rows) {
    const lead = p.leadDays ?? (await getSetting(db, organizationId, "maintenance.pm.due_soon_days", p.siteId));
    const pct = await getSetting(db, organizationId, "maintenance.pm.usage_due_soon_pct", p.siteId);
    const used = usage.get(p.id) ?? null;
    const state = planDueState(p, { today, leadDays: lead, usage: used, usageDueSoonPct: pct });
    if (state === "ok") continue;
    const when = p.triggerKind === "time" ? `due ${p.nextDueOn}` : `${used?.toDecimalPlaces(1).toString()} of ${p.usageInterval} ${USAGE_UNIT[p.usageMetric ?? ""] ?? p.usageMetric}`;
    out.push({
      kind: state === "overdue" ? "pm_overdue" : "pm_due",
      siteId: p.siteId,
      entityType: "maintenance_plan",
      entityId: p.id,
      recordNumber: p.planNumber,
      title: `${state === "overdue" ? "Overdue" : DUE_STATE_LABEL[state]}: PM ${p.planNumber} on ${equipmentCode} (${when})`,
      detail: `${equipmentName}: ${p.title}`,
      link: `/maintenance/plans/${p.id}`,
      openedAt: p.triggerKind === "time" && p.nextDueOn ? new Date(addDays(p.nextDueOn, state === "overdue" ? 1 : -lead) + "T00:00:00+08:00") : p.usageSince,
    });
  }
  return out;
}

/** Context for the "New PM plan" form: equipment at the sites where the caller may create plans, technicians per site. */
export async function maintenancePlanFormContext(ctx: AuthContext, ref: { equipmentId?: string | null } = {}) {
  ctx.require("maintenance.plan.create");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("maintenance.plan.create", s));
  const eqRows = siteIds.length
    ? await db
        .select({ id: equipment.id, code: equipment.code, name: equipment.name, siteId: equipment.siteId, siteCode: sites.code, maintenanceDueDate: equipment.maintenanceDueDate })
        .from(equipment)
        .innerJoin(sites, eq(sites.id, equipment.siteId))
        .where(and(eq(equipment.organizationId, ctx.organizationId), inArray(equipment.siteId, siteIds)))
        .orderBy(asc(sites.code), asc(equipment.code))
    : [];
  const technicians: { id: string; name: string; siteId: string }[] = [];
  for (const s of siteIds) for (const t of await usersWithPermissionAt(db, ctx.organizationId, "maintenance.work_order.edit", s)) technicians.push({ ...t, siteId: s });
  return { equipment: eqRows, technicians, preselected: ref.equipmentId ? (eqRows.find((e) => e.id === ref.equipmentId) ?? null) : null, dueSoonDays: await getSetting(db, ctx.organizationId, "maintenance.pm.due_soon_days") };
}
