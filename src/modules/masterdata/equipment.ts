import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { downtimeEvents, equipment, equipmentOverrideRequests, equipmentServiceRecords, equipmentStateTransitions, sites, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { idempotent } from "./idempotency";
import { CreateEquipmentInput, DecisionInput, EquipmentStatusInput, OverrideRequestInput, ServiceRecordInput, parseInput } from "./schemas";
import { addDays, approvalState, businessToday, canDecideStep, recordApprovalDecision, requireAny } from "./versioning";

/**
 * Equipment gate (US-3-04, W13). Administrative status follows the state machine below
 * (docs/data-model.md §6.11); availability for use is derived on demand and never stored.
 */
export const EQUIPMENT_STATUSES = ["in_service", "maintenance", "out_of_service"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const EQUIPMENT_TRANSITIONS: Record<EquipmentStatus, readonly EquipmentStatus[]> = {
  in_service: ["maintenance", "out_of_service"],
  maintenance: ["in_service", "out_of_service"],
  out_of_service: ["maintenance", "in_service"],
};

type EquipmentRow = typeof equipment.$inferSelect;

export type AvailabilityReason = {
  code: "out_of_service" | "calibration_due" | "maintenance_due" | "cleaning_required" | "qualification_pending";
  detail: string;
  dueDate?: string | null;
};

/**
 * Derived availability on a business date (docs/data-model.md §3.1 "Equipment availability").
 * Stored status other than in_service always blocks (an administrative decision). Due dates,
 * cleaning and qualification block when blocking_rule = block, are recorded as warnings when
 * warn, and are informational when none (A-DM-28; assumption A-W1D-04).
 */
export function deriveAvailability(
  e: Pick<EquipmentRow, "status" | "calibrationDueDate" | "maintenanceDueDate" | "cleaningStatus" | "cleaningRule" | "qualificationStatus" | "blockingRule">,
  onDate: string,
  /** W4C: derived reasons from registered providers (usage-based PM plans overdue), subject to the blocking rule. */
  extra: readonly AvailabilityReason[] = [],
) {
  const statusReasons: AvailabilityReason[] = [];
  const derived: AvailabilityReason[] = [];
  if (e.status !== "in_service") statusReasons.push({ code: "out_of_service", detail: e.status === "maintenance" ? "In maintenance" : "Out of service" });
  if (e.calibrationDueDate && e.calibrationDueDate < onDate) derived.push({ code: "calibration_due", detail: `Calibration was due ${e.calibrationDueDate}`, dueDate: e.calibrationDueDate });
  if (e.maintenanceDueDate && e.maintenanceDueDate < onDate) derived.push({ code: "maintenance_due", detail: `Maintenance was due ${e.maintenanceDueDate}`, dueDate: e.maintenanceDueDate });
  if (e.cleaningRule !== "none" && e.cleaningStatus !== "clean") derived.push({ code: "cleaning_required", detail: e.cleaningStatus === "in_progress" ? "Cleaning in progress" : "Cleaning not recorded since last use" });
  if (e.qualificationStatus === "pending" || e.qualificationStatus === "failed") derived.push({ code: "qualification_pending", detail: e.qualificationStatus === "failed" ? "Qualification failed" : "Qualification pending" });
  derived.push(...extra);
  const reasons = [...statusReasons, ...derived];
  const blocking = [...statusReasons, ...(e.blockingRule === "block" ? derived : [])];
  return {
    reasons,
    /** No reason at all. */
    available: reasons.length === 0,
    /** May be selected without an override (warnings are recorded on the use). */
    selectable: blocking.length === 0,
    blockingReasons: blocking,
    warnings: e.blockingRule === "warn" ? derived : [],
  };
}

/**
 * W4C (US-6-19): extra derived availability reasons from other modules, e.g. the maintenance module's
 * usage-based PM plans that reached their interval (time-based plans keep `maintenance_due_date` in step,
 * so they need no provider). Registered by src/modules/wiring.ts; the registry lives on globalThis.
 */
export type AvailabilityProvider = (q: DbOrTx, equipmentIds: string[], onDate: string) => Promise<Map<string, AvailabilityReason[]>>;
const PROVIDERS_KEY = "__bc_equipment_availability_providers__";
function providers(): Map<string, AvailabilityProvider> {
  const g = globalThis as unknown as Record<string, Map<string, AvailabilityProvider> | undefined>;
  g[PROVIDERS_KEY] ??= new Map();
  return g[PROVIDERS_KEY]!;
}
export function registerEquipmentAvailabilityProvider(key: string, provider: AvailabilityProvider) {
  providers().set(key, provider);
}
async function extraReasons(q: DbOrTx, equipmentIds: string[], onDate: string): Promise<Map<string, AvailabilityReason[]>> {
  const out = new Map<string, AvailabilityReason[]>();
  if (!equipmentIds.length) return out;
  for (const p of providers().values()) {
    for (const [id, reasons] of await p(q, equipmentIds, onDate)) out.set(id, [...(out.get(id) ?? []), ...reasons]);
  }
  return out;
}

/** Business date of an instant in the plant time zone. */
const dateOf = (at: Date) => businessToday(at);

async function lockEquipment(tx: Tx, ctx: AuthContext, equipmentId: string) {
  const [e] = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!e) throw new DomainError("not_found", "Equipment not found.");
  ctx.requireSite(e.siteId);
  return e;
}

async function unreviewedFailedCalibration(q: DbOrTx, equipmentId: string) {
  const [r] = await q
    .select({ id: equipmentServiceRecords.id, performedAt: equipmentServiceRecords.performedAt })
    .from(equipmentServiceRecords)
    .where(and(eq(equipmentServiceRecords.equipmentId, equipmentId), eq(equipmentServiceRecords.serviceKind, "calibration"), eq(equipmentServiceRecords.result, "fail"), isNull(equipmentServiceRecords.reviewedBy)))
    .limit(1);
  return r ?? null;
}

/** Moves equipment through the status state machine: transition row, downtime open/close, audit. */
async function transitionEquipment(tx: Tx, ctx: AuthContext, e: EquipmentRow, to: EquipmentStatus, reason: string) {
  if (!(EQUIPMENT_STATUSES as readonly string[]).includes(e.status) || !EQUIPMENT_TRANSITIONS[e.status as EquipmentStatus].includes(to)) {
    throw new DomainError("state", `${e.code} is ${e.status.replace(/_/g, " ")} and cannot move to ${to.replace(/_/g, " ")}.`);
  }
  if (to === "in_service") {
    const failed = await unreviewedFailedCalibration(tx, e.id);
    if (failed) throw new DomainError("state", `${e.code} has a failed calibration that QA has not reviewed yet. It stays blocked until a QA review (G-W13-B).`);
  }
  const now = new Date();
  await tx.update(equipment).set({ status: to, statusChangedAt: now, statusChangedBy: ctx.userId }).where(eq(equipment.id, e.id));
  await tx.insert(equipmentStateTransitions).values({ organizationId: ctx.organizationId, siteId: e.siteId, equipmentId: e.id, fromState: e.status, toState: to, actorId: ctx.userId, reason, occurredAt: now });
  if (to === "in_service") {
    await tx.update(downtimeEvents).set({ endedAt: now }).where(and(eq(downtimeEvents.equipmentId, e.id), isNull(downtimeEvents.endedAt)));
  } else {
    const [open] = await tx.select({ id: downtimeEvents.id }).from(downtimeEvents).where(and(eq(downtimeEvents.equipmentId, e.id), isNull(downtimeEvents.endedAt)));
    if (!open) await tx.insert(downtimeEvents).values({ organizationId: ctx.organizationId, siteId: e.siteId, equipmentId: e.id, startedAt: now, reason, loggedBy: ctx.userId });
  }
  await audit(tx, ctx, { action: "masterdata.equipment.status_changed", entityType: "equipment", entityId: e.id, entityNumber: e.code, siteId: e.siteId, reason, before: { status: e.status }, after: { status: to } });
  const from = e.status;
  e.status = to;
  return { from, to };
}

/* ================================================================== commands */

export async function createEquipment(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.equipment.admin");
  const input = parseInput(CreateEquipmentInput, raw);
  ctx.requireSite(input.siteId);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.organizationId, ctx.organizationId), eq(equipment.code, input.code)));
    if (dup) throw new DomainError("conflict", `Equipment code ${input.code} is already used.`, { fieldErrors: { code: "This code is already used." } });
    const [e] = await tx
      .insert(equipment)
      .values({ ...input, organizationId: ctx.organizationId, status: "in_service", statusChangedBy: ctx.userId, createdBy: ctx.userId })
      .returning();
    await tx.insert(equipmentStateTransitions).values({ organizationId: ctx.organizationId, siteId: e.siteId, equipmentId: e.id, fromState: null, toState: "in_service", actorId: ctx.userId, reason: "Registered" });
    await audit(tx, ctx, { action: "masterdata.equipment.created", entityType: "equipment", entityId: e.id, entityNumber: e.code, siteId: e.siteId, after: { code: e.code, kind: e.equipmentKind, blockingRule: e.blockingRule } });
    return { equipmentId: e.id };
  });
}

/**
 * Records a cleaning, calibration, maintenance, repair, qualification or inspection event and
 * applies it to the equipment in the same transaction: due dates, cleaning and qualification
 * status, and the administrative status (a failed calibration blocks until a QA review; a passing
 * service returns maintenance/out-of-service equipment to service).
 */
export async function recordServiceRecord(ctx: AuthContext, raw: unknown, opts: { tx?: Tx } = {}) {
  ctx.require("masterdata.equipment.edit");
  const input = parseInput(ServiceRecordInput, raw);
  // W4C: the maintenance work order completes inside its own transaction (opts.tx).
  const run = async (tx: Tx) => {
    const e = await lockEquipment(tx, ctx, input.equipmentId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "masterdata.equipment.serviced", async () => {
      const performedAt = input.performedAt ?? new Date();
      if (performedAt.getTime() > Date.now() + 5 * 60_000) throw new DomainError("validation", "The service cannot be recorded in the future.", { fieldErrors: { performedAt: "Use the time the work was done." } });
      const day = dateOf(performedAt);
      if (input.nextDueDate && input.nextDueDate <= day) throw new DomainError("validation", "The next due date must be after the service date.", { fieldErrors: { nextDueDate: "Choose a later date." } });
      const pass = input.result !== "fail";
      if (input.serviceKind === "calibration" && input.result === "completed") throw new DomainError("validation", "A calibration result is pass or fail.", { fieldErrors: { result: "Choose pass or fail." } });

      const [rec] = await tx
        .insert(equipmentServiceRecords)
        .values({
          organizationId: ctx.organizationId,
          siteId: e.siteId,
          equipmentId: e.id,
          serviceKind: input.serviceKind,
          performedAt,
          performedBy: input.performedByExternal ? null : ctx.userId,
          performedByExternal: input.performedByExternal,
          result: input.result,
          nextDueDate: input.nextDueDate,
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          createdBy: ctx.userId,
        })
        .returning();

      const set: Partial<typeof equipment.$inferInsert> = {};
      let toStatus: EquipmentStatus | null = null;
      let statusReason = "";
      switch (input.serviceKind) {
        case "cleaning":
          set.cleaningStatus = pass ? "clean" : "dirty";
          if (pass) set.lastCleanedAt = performedAt;
          break;
        case "calibration":
          if (pass) {
            set.lastCalibratedDate = day;
            set.calibrationDueDate = input.nextDueDate ?? (e.calibrationIntervalDays ? addDays(day, e.calibrationIntervalDays) : null);
          } else {
            toStatus = "out_of_service";
            statusReason = "calibration_failed";
          }
          break;
        case "preventive_maintenance":
          if (pass) {
            set.lastMaintainedDate = day;
            set.maintenanceDueDate = input.nextDueDate ?? (e.maintenanceIntervalDays ? addDays(day, e.maintenanceIntervalDays) : null);
          } else {
            toStatus = "out_of_service";
            statusReason = "maintenance_failed";
          }
          break;
        case "qualification":
          set.qualificationStatus = pass ? "qualified" : "failed";
          break;
        case "repair":
        case "inspection":
          if (!pass) {
            toStatus = "out_of_service";
            statusReason = `${input.serviceKind}_failed`;
          }
          break;
      }
      if (Object.keys(set).length) await tx.update(equipment).set(set).where(eq(equipment.id, e.id));
      Object.assign(e, set);

      let statusChange: { from: string; to: string } | null = null;
      if (toStatus && e.status !== toStatus) {
        statusChange = await transitionEquipment(tx, ctx, e, toStatus, statusReason);
      } else if (pass && e.status !== "in_service" && input.serviceKind !== "cleaning") {
        // A passing calibration/maintenance/repair returns the equipment to service, unless a failed
        // calibration still awaits QA review (then it stays blocked; no error, the record is kept).
        const failed = await unreviewedFailedCalibration(tx, e.id);
        if (!failed) statusChange = await transitionEquipment(tx, ctx, e, "in_service", `${input.serviceKind} ${input.result}`);
      }

      await audit(tx, ctx, {
        action: "masterdata.equipment.serviced",
        entityType: "equipment",
        entityId: e.id,
        entityNumber: e.code,
        siteId: e.siteId,
        after: { recordId: rec.id, serviceKind: input.serviceKind, result: input.result, nextDueDate: set.calibrationDueDate ?? set.maintenanceDueDate ?? input.nextDueDate ?? null, statusChange },
      });
      return { recordId: rec.id, status: e.status, statusChange };
    });
    return result;
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/**
 * QA review of a failed calibration (G-W13-B): reviewer ≠ performer and ≠ recorder. When no other
 * failed calibration awaits review and the latest calibration passed, the equipment returns to
 * service. QA assesses the batches that used the equipment since the last good calibration
 * (reverse query via equipment_uses, Wave 2).
 */
export async function reviewServiceRecord(ctx: AuthContext, input: { recordId: string; note: string }) {
  ctx.require("masterdata.equipment.approve");
  const note = input.note?.trim();
  if (!note) throw new DomainError("validation", "Enter the review conclusion (impact on batches, actions taken).", { fieldErrors: { note: "Required." } });
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(equipmentServiceRecords)
      .where(and(eq(equipmentServiceRecords.id, input.recordId), eq(equipmentServiceRecords.organizationId, ctx.organizationId)))
      .limit(1);
    if (!rec) throw new DomainError("not_found", "Service record not found.");
    const e = await lockEquipment(tx, ctx, rec.equipmentId);
    if (rec.result !== "fail") throw new DomainError("state", "Only a failed service record needs a QA review.");
    if (rec.reviewedBy) throw new DomainError("state", "This record has already been reviewed.");
    ctx.assertSeparation(rec.performedBy === ctx.userId || rec.createdBy === ctx.userId, "The person who performed or recorded the service cannot review it.");
    await tx.update(equipmentServiceRecords).set({ reviewedBy: ctx.userId, reviewedAt: new Date(), reviewNote: note }).where(eq(equipmentServiceRecords.id, rec.id));
    let statusChange: { from: string; to: string } | null = null;
    if (e.status !== "in_service" && !(await unreviewedFailedCalibration(tx, e.id))) {
      const [latest] = await tx
        .select()
        .from(equipmentServiceRecords)
        .where(and(eq(equipmentServiceRecords.equipmentId, e.id), eq(equipmentServiceRecords.serviceKind, "calibration")))
        .orderBy(desc(equipmentServiceRecords.performedAt))
        .limit(1);
      if (latest && latest.result === "pass" && latest.performedAt > rec.performedAt) {
        statusChange = await transitionEquipment(tx, ctx, e, "in_service", "QA reviewed the failed calibration; later calibration passed");
      }
    }
    await audit(tx, ctx, { action: "masterdata.equipment_service_record.reviewed", entityType: "equipment", entityId: e.id, entityNumber: e.code, siteId: e.siteId, reason: note, after: { recordId: rec.id, statusChange } });
    return { statusChange };
  });
}

/** Manual status change with a reason (masterdata.equipment.edit), through the state machine. */
export async function changeEquipmentStatus(ctx: AuthContext, raw: unknown, opts: { tx?: Tx } = {}) {
  ctx.require("masterdata.equipment.edit");
  const input = parseInput(EquipmentStatusInput, raw);
  const run = async (tx: Tx) => {
    const e = await lockEquipment(tx, ctx, input.equipmentId);
    return transitionEquipment(tx, ctx, e, input.toStatus, input.reason);
  };
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

/**
 * W4C (US-6-19): sets the stored next-maintenance date from the maintenance module's active time-based
 * PM plans (earliest due date), inside the caller's transaction, audited when it changes. `null` keeps the
 * stored date unless it was the plan's own date (`clearIfEquals`).
 */
export async function syncMaintenanceDueDate(tx: Tx, ctx: AuthContext, equipmentId: string, next: string | null, opts: { clearIfEquals?: string | null; reason: string }) {
  const e = await lockEquipment(tx, ctx, equipmentId);
  const value = next ?? (opts.clearIfEquals && e.maintenanceDueDate === opts.clearIfEquals ? null : e.maintenanceDueDate);
  if (value === e.maintenanceDueDate) return { changed: false, maintenanceDueDate: value };
  await tx.update(equipment).set({ maintenanceDueDate: value }).where(eq(equipment.id, e.id));
  await audit(tx, ctx, { action: "masterdata.equipment.updated", entityType: "equipment", entityId: e.id, entityNumber: e.code, siteId: e.siteId, reason: opts.reason, before: { maintenanceDueDate: e.maintenanceDueDate }, after: { maintenanceDueDate: value } });
  return { changed: true, maintenanceDueDate: value };
}

/**
 * CX-CAL request: the operator (or supervisor) asks to use equipment that is not available, with a
 * risk assessment and a time box. Approval needs a site_manager and a qa_qc co-approval, both other
 * than the requester (A-PROC-23).
 */
export async function requestEquipmentOverride(ctx: AuthContext, raw: unknown) {
  ctx.require("production.equipment_use.create");
  const input = parseInput(OverrideRequestInput, raw);
  return db.transaction(async (tx) => {
    const e = await lockEquipment(tx, ctx, input.equipmentId);
    const now = new Date();
    const av = deriveAvailability(e, dateOf(now));
    if (av.selectable) throw new DomainError("state", `${e.code} can be used without an override${av.warnings.length ? " (warnings are recorded on the use)" : ""}.`);
    const [pending] = await tx
      .select({ id: equipmentOverrideRequests.id })
      .from(equipmentOverrideRequests)
      .where(and(eq(equipmentOverrideRequests.equipmentId, e.id), eq(equipmentOverrideRequests.status, "pending_approval")));
    if (pending) throw new DomainError("conflict", `An override request for ${e.code} is already waiting for approval.`);
    const [req] = await tx
      .insert(equipmentOverrideRequests)
      .values({
        organizationId: ctx.organizationId,
        siteId: e.siteId,
        equipmentId: e.id,
        reason: input.reason,
        availabilityReasons: av.blockingReasons.map((r) => r.code),
        workReference: input.workReference,
        validFrom: now,
        validUntil: new Date(now.getTime() + input.validHours * 3_600_000),
        requestedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "production.equipment_override.requested", entityType: "equipment_override_request", entityId: req.id, entityNumber: e.code, siteId: e.siteId, reason: input.reason, after: { reasons: req.availabilityReasons, validUntil: req.validUntil, workReference: req.workReference } });
    return { requestId: req.id };
  });
}

export async function decideEquipmentOverride(ctx: AuthContext, raw: unknown) {
  ctx.require("production.equipment_override.approve");
  const input = parseInput(DecisionInput, raw);
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(equipmentOverrideRequests)
      .where(and(eq(equipmentOverrideRequests.id, input.id), eq(equipmentOverrideRequests.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!req) throw new DomainError("not_found", "Override request not found.");
    ctx.requireSite(req.siteId);
    const e = await lockEquipment(tx, ctx, req.equipmentId);
    if (req.status !== "pending_approval") throw new DomainError("state", `This override request is ${req.status.replace(/_/g, " ")}.`);
    if (req.validUntil.getTime() <= Date.now()) throw new DomainError("state", "This override request has expired. Ask the requester to submit a new one.");
    const d = await recordApprovalDecision(tx, ctx, { recordType: "equipment_override", recordId: req.id, siteId: req.siteId, excludedUserIds: [req.requestedBy], decision: input.decision, note: input.note });
    const base = { entityType: "equipment_override_request", entityId: req.id, entityNumber: e.code, siteId: req.siteId } as const;
    if (d.rejected) {
      await tx.update(equipmentOverrideRequests).set({ status: "rejected" }).where(eq(equipmentOverrideRequests.id, req.id));
      await audit(tx, ctx, { ...base, action: "production.equipment_override.rejected", reason: input.note, before: { status: req.status }, after: { status: "rejected" } });
      return { status: "rejected" as const };
    }
    if (!d.final) {
      await audit(tx, ctx, { ...base, action: "production.equipment_override.reviewed", reason: input.note, after: { step: d.step.step, stepLabel: d.step.label } });
      return { status: "pending_approval" as const, step: d.step.step };
    }
    await tx.update(equipmentOverrideRequests).set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(equipmentOverrideRequests.id, req.id));
    await audit(tx, ctx, { ...base, action: "production.equipment_use.override_approved", reason: input.note, before: { status: req.status }, after: { status: "approved", reasons: req.availabilityReasons, validUntil: req.validUntil } });
    return { status: "approved" as const, step: d.step.step };
  });
}

/* ================================================================== queries */

/**
 * Availability of one piece of equipment at an instant (default now), with the approved,
 * unexpired override that covers it, if any. Wave 2 calls this at batch start, dispensing and
 * process steps: `usable` false means refuse with `blockingReasons`; record `warnings` and the
 * override id on equipment_uses.
 */
export async function equipmentAvailability(ctx: AuthContext, equipmentId: string, at: Date = new Date(), opts: { tx?: DbOrTx } = {}) {
  requireAny(ctx, ["masterdata.equipment.view", "production.equipment_use.create", "production.batch.view"]);
  const q = opts.tx ?? db;
  const [e] = await q
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.organizationId)))
    .limit(1);
  if (!e) throw new DomainError("not_found", "Equipment not found.");
  ctx.requireSite(e.siteId);
  const day = dateOf(at);
  const av = deriveAvailability(e, day, (await extraReasons(q, [e.id], day)).get(e.id));
  const [override] = av.selectable
    ? []
    : await q
        .select()
        .from(equipmentOverrideRequests)
        .where(and(eq(equipmentOverrideRequests.equipmentId, e.id), eq(equipmentOverrideRequests.status, "approved"), lte(equipmentOverrideRequests.validFrom, at), gt(equipmentOverrideRequests.validUntil, at)))
        .orderBy(desc(equipmentOverrideRequests.approvedAt))
        .limit(1);
  return {
    equipment: { id: e.id, code: e.code, name: e.name, kind: e.equipmentKind, siteId: e.siteId, status: e.status, blockingRule: e.blockingRule, calibrationDueDate: e.calibrationDueDate, maintenanceDueDate: e.maintenanceDueDate, cleaningStatus: e.cleaningStatus },
    ...av,
    override: override ? { id: override.id, validUntil: override.validUntil, reason: override.reason } : null,
    usable: av.selectable || !!override,
  };
}
export type EquipmentAvailability = Awaited<ReturnType<typeof equipmentAvailability>>;

/** Equipment at the caller's sites (optionally one site / kind) with derived availability. */
export async function listEquipment(ctx: AuthContext, filter: { siteId?: string; kind?: string } = {}) {
  ctx.require("masterdata.equipment.view");
  if (filter.siteId) ctx.requireSite(filter.siteId);
  const siteIds = filter.siteId ? [filter.siteId] : ctx.allowedSiteIds;
  const rows = await db
    .select({ e: equipment, siteCode: sites.code })
    .from(equipment)
    .innerJoin(sites, eq(sites.id, equipment.siteId))
    .where(and(eq(equipment.organizationId, ctx.organizationId), inArray(equipment.siteId, siteIds), filter.kind ? eq(equipment.equipmentKind, filter.kind) : undefined))
    .orderBy(asc(sites.code), asc(equipment.code));
  const today = businessToday();
  const extra = await extraReasons(db, rows.map((r) => r.e.id), today);
  return rows.map(({ e, siteCode }) => ({ ...e, siteCode, availability: deriveAvailability(e, today, extra.get(e.id)) }));
}
export type EquipmentListRow = Awaited<ReturnType<typeof listEquipment>>[number];

export async function getEquipment(ctx: AuthContext, equipmentId: string) {
  ctx.require("masterdata.equipment.view");
  const [row] = await db
    .select({ e: equipment, siteCode: sites.code, siteName: sites.name })
    .from(equipment)
    .innerJoin(sites, eq(sites.id, equipment.siteId))
    .where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.e.siteId)) return null;
  const e = row.e;
  const [records, transitions, downtime, overrides] = await Promise.all([
    db.select().from(equipmentServiceRecords).where(eq(equipmentServiceRecords.equipmentId, e.id)).orderBy(desc(equipmentServiceRecords.performedAt)),
    db.select().from(equipmentStateTransitions).where(eq(equipmentStateTransitions.equipmentId, e.id)).orderBy(desc(equipmentStateTransitions.occurredAt)),
    db.select().from(downtimeEvents).where(eq(downtimeEvents.equipmentId, e.id)).orderBy(desc(downtimeEvents.startedAt)),
    db.select().from(equipmentOverrideRequests).where(eq(equipmentOverrideRequests.equipmentId, e.id)).orderBy(desc(equipmentOverrideRequests.requestedAt)),
  ]);
  const ids = [...new Set([...records.flatMap((r) => [r.performedBy, r.reviewedBy, r.createdBy]), ...transitions.map((t) => t.actorId), ...overrides.map((o) => o.requestedBy)].filter((x): x is string => !!x))];
  const names = ids.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n])) : new Map<string, string>();
  const nm = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : null);
  const availability = await equipmentAvailability(ctx, e.id);
  const overridesView = await Promise.all(
    overrides.map(async (o) => {
      const approval = await approvalState(db, ctx.organizationId, "equipment_override", o.id);
      return {
        ...o,
        requestedByName: nm(o.requestedBy),
        expired: o.validUntil.getTime() <= Date.now(),
        approval,
        canDecide:
          o.status === "pending_approval" &&
          o.validUntil.getTime() > Date.now() &&
          canDecideStep(ctx, approval.nextStep) &&
          !ctx.sodConflict(o.requestedBy) &&
          !approval.decisions.some((d) => ctx.sodConflict(d.decidedBy)),
      };
    }),
  );
  return {
    equipment: e,
    site: { code: row.siteCode, name: row.siteName },
    availability,
    records: records.map((r) => ({
      ...r,
      performedByName: r.performedByExternal ?? nm(r.performedBy),
      reviewedByName: nm(r.reviewedBy),
      canReview: r.result === "fail" && !r.reviewedBy && ctx.can("masterdata.equipment.approve") && !ctx.sodConflict(r.performedBy) && !ctx.sodConflict(r.createdBy),
    })),
    transitions: transitions.map((t) => ({ ...t, actorName: nm(t.actorId) })),
    downtime,
    overrides: overridesView,
    can: {
      service: ctx.can("masterdata.equipment.edit"),
      changeStatus: ctx.can("masterdata.equipment.edit"),
      requestOverride: ctx.can("production.equipment_use.create") && !availability.selectable && !overrides.some((o) => o.status === "pending_approval"),
    },
    nextStatuses: EQUIPMENT_TRANSITIONS[e.status as EquipmentStatus] ?? [],
  };
}
