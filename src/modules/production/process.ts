import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { batches, equipment, equipmentOverrideRequests, equipmentUses, processStepReadings, processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { equipmentAvailability } from "@/modules/masterdata";
import { notifyRoles } from "@/modules/platform/notifications";
import { DEVIATION_UNAVAILABLE, type DeviationKind, executionHooks } from "./execution-hooks";
import { type BatchRow, HOLD_STEP_KINDS, type SnapshotStep, type StepRecord, findStep, openStep, routingStepDetails, stepLabel, stepRecord } from "./execution";
import { idempotent, lockBatch } from "./shared";

/* ================================================================== equipment use (W13-03/04) */

/**
 * Equipment kinds several batches may use at the same time (a weighing-room scale serves many
 * batches). Every other kind (mixer, kettle, mould line, filler…) holds one batch at a time until the
 * step that uses it ends (assumption A-W2B-07).
 */
export const SHARED_EQUIPMENT_KINDS = ["scale"] as const;

/** Equipment by id, BC:EQP payload or code, at the caller's organization. */
async function resolveEquipment(q: DbOrTx, ctx: AuthContext, ref: string) {
  const v = (ref ?? "").trim();
  const isId = /^[0-9a-f-]{36}$/i.test(v);
  const code = v.toUpperCase().replace(/^BC:EQP:/, "");
  const [e] = await q
    .select()
    .from(equipment)
    .where(and(eq(equipment.organizationId, ctx.organizationId), isId ? eq(equipment.id, v) : eq(equipment.code, code)))
    .limit(1);
  if (!e || !ctx.allowedSiteIds.includes(e.siteId)) throw new DomainError("not_found", `Equipment ${code || v} not found in your sites.`, { field: "equipment" });
  return e;
}

/**
 * Links equipment to a step (W13-03): the equipment must be at the batch site, of the kind the
 * routing step names, not in use on another batch, and usable now (equipmentAvailability). Not
 * selectable → refused with the reasons and due dates (V-CAL). `warn` reasons are recorded on the
 * use and the site manager is notified. Usable only through an approved CX-CAL override → the use
 * records the override and its approver, and a deviation is opened (W13-04). Returns the open use
 * (an existing open use of the same equipment on the step is returned as is).
 */
export async function useEquipment(tx: Tx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep, rec: StepRecord, equipmentRef: string) {
  ctx.require("production.equipment_use.create");
  const e = await resolveEquipment(tx, ctx, equipmentRef);
  if (e.siteId !== batch.siteId) throw new DomainError("validation", `${e.code} belongs to another site.`, { field: "equipment" });
  if (step.equipmentKind && e.equipmentKind !== step.equipmentKind) {
    throw new DomainError("validation", `${e.code} is a ${e.equipmentKind}; ${stepLabel(step)} needs a ${step.equipmentKind}.`, { field: "equipment" });
  }
  const [open] = await tx
    .select()
    .from(equipmentUses)
    .where(and(eq(equipmentUses.equipmentId, e.id), eq(equipmentUses.processStepRecordId, rec.id), isNull(equipmentUses.endedAt)))
    .limit(1);
  if (open) return { use: open, equipment: e };
  const [elsewhere] = !(SHARED_EQUIPMENT_KINDS as readonly string[]).includes(e.equipmentKind)
    ? await tx
    .select({ batchNumber: batches.batchNumber })
    .from(equipmentUses)
    .innerJoin(batches, eq(batches.id, equipmentUses.batchId))
    .where(and(eq(equipmentUses.equipmentId, e.id), isNull(equipmentUses.endedAt), ne(equipmentUses.batchId, batch.id)))
    .limit(1)
    : [];
  if (elsewhere) throw new DomainError("state", `${e.code} is in use on batch ${elsewhere.batchNumber}. Finish that step first.`, { field: "equipment" });

  const av = await equipmentAvailability(ctx, e.id, new Date(), { tx });
  if (!av.usable) {
    const why = av.blockingReasons.map((r) => r.detail).join("; ");
    throw new DomainError("state", `${e.code} cannot be used: ${why}. Choose other equipment, record the service, or request a controlled override (CX-CAL).`, {
      rule: "V-CAL",
      field: "equipment",
      reasons: av.blockingReasons,
    });
  }
  let override: { id: string; approvedBy: string; reason: string } | null = null;
  let deviationId: string | null = null;
  if (!av.selectable && av.override) {
    const [o] = await tx.select().from(equipmentOverrideRequests).where(eq(equipmentOverrideRequests.id, av.override.id)).limit(1);
    if (!o?.approvedBy) throw new DomainError("state", `The override for ${e.code} has no approver recorded.`);
    override = { id: o.id, approvedBy: o.approvedBy, reason: o.reason };
    const opener = executionHooks().openDeviation;
    if (!opener) throw new DomainError("state", `${e.code} may be used only under override ${o.id.slice(0, 8)}, which opens a deviation. ${DEVIATION_UNAVAILABLE}`, { rule: "CX-CAL" });
    deviationId = (
      await opener(tx, ctx, {
        kind: "equipment_override",
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        siteId: batch.siteId,
        processStepRecordId: rec.id,
        description: `${e.code} used under controlled override on ${stepLabel(step)}: ${av.blockingReasons.map((r) => r.detail).join("; ")}. Override reason: ${o.reason}`,
        approvedBy: o.approvedBy,
      })
    ).deviationId;
  }
  const reasons = av.reasons.map((r) => r.code);
  const [use] = await tx
    .insert(equipmentUses)
    .values({
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      equipmentId: e.id,
      processStepRecordId: rec.id,
      operatorId: ctx.userId,
      statusAtStart: e.status,
      cleaningStatusAtStart: e.cleaningStatus,
      calibrationDueDateAtUse: e.calibrationDueDate,
      maintenanceDueDateAtUse: e.maintenanceDueDate,
      availabilityReasons: reasons.length ? reasons : null,
      overrideRequestId: override?.id ?? null,
      exceptionApprovedBy: override?.approvedBy ?? null,
      exceptionReason: override?.reason ?? null,
      deviationId,
    })
    .returning();
  await audit(tx, ctx, {
    action: "production.equipment_use.created",
    entityType: "equipment_use",
    entityId: use.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    after: { equipment: e.code, stepNo: step.stepNo, reasons, override: override?.id ?? null, deviationId },
  });
  if (av.warnings.length && !override) {
    await notifyRoles(tx, { roleCodes: ["site_manager"], siteId: batch.siteId }, {
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      kind: "production.equipment_warning",
      severity: "warning",
      title: `${e.code} used with warnings on batch ${batch.batchNumber}`,
      body: `${av.warnings.map((w) => w.detail).join("; ")}. Recorded on the equipment use by ${ctx.displayName}.`,
      entityType: "batch",
      entityId: batch.id,
      link: `/production/${batch.id}`,
      dedupeKey: `equipment-warning:${use.id}`,
    });
  }
  return { use, equipment: e };
}

/** Selects (or scans) equipment for a step from the step screen. */
export async function selectEquipment(ctx: AuthContext, input: { batchId: string; stepNo: number; equipmentRef: string }) {
  ctx.require("production.equipment_use.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const step = findStep(batch, input.stepNo);
    const rec = await openStep(tx, ctx, batch, step);
    const { use, equipment: e } = await useEquipment(tx, ctx, batch, step, rec, input.equipmentRef);
    return { useId: use.id, equipmentCode: e.code, warnings: use.availabilityReasons ?? [] };
  });
}

/* ================================================================== readings (W05-11) */

type Param = NonNullable<SnapshotStep["parameters"]>[number];

/** Parses and evaluates a reading against the frozen limits. Booleans are pass/fail checks: true passes. */
export function evaluateReading(p: Param, raw: string) {
  const v = (raw ?? "").trim();
  if (!v) throw new DomainError("validation", `Enter ${p.name}.`, { field: `param-${p.id}` });
  if (p.valueKind === "numeric") {
    let n: Decimal;
    try {
      n = new Decimal(v.replace(/,/g, ""));
    } catch {
      throw new DomainError("validation", `${p.name} must be a number${p.uom ? ` in ${p.uom}` : ""}.`, { field: `param-${p.id}` });
    }
    if (!n.isFinite()) throw new DomainError("validation", `${p.name} must be a number.`, { field: `param-${p.id}` });
    if (n.decimalPlaces() > 6) throw new DomainError("validation", `${p.name} can have at most 6 decimals.`, { field: `param-${p.id}` });
    const within = (p.minValue === null || n.gte(p.minValue)) && (p.maxValue === null || n.lte(p.maxValue));
    return { valueNumeric: n.toString(), valueText: null, valueBoolean: null, within };
  }
  if (p.valueKind === "boolean") {
    const t = v.toLowerCase();
    if (!["yes", "no", "true", "false", "pass", "fail"].includes(t)) throw new DomainError("validation", `${p.name}: answer yes or no.`, { field: `param-${p.id}` });
    const b = ["yes", "true", "pass"].includes(t);
    return { valueNumeric: null, valueText: null, valueBoolean: b, within: b };
  }
  if (v.length > 500) throw new DomainError("validation", `${p.name} can have at most 500 characters.`, { field: `param-${p.id}` });
  return { valueNumeric: null, valueText: v, valueBoolean: null, within: true };
}

/** Current reading per parameter of a step record (the latest that nothing supersedes). */
export async function currentReadings(q: DbOrTx, recordId: string) {
  const rows = await q.select().from(processStepReadings).where(eq(processStepReadings.processStepRecordId, recordId));
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  return rows.filter((r) => !superseded.has(r.id));
}

/**
 * Records a process reading (US-3-11 AC1). The reading is always saved, with is_within_limits
 * evaluated against the routing revision frozen on the batch; outside the limits the step shows
 * the reason and cannot complete until a controlled exception with a deviation (CX-TOL). A second
 * reading of the same parameter supersedes the first and needs a correction reason.
 */
export async function recordReading(
  ctx: AuthContext,
  input: { batchId: string; stepNo: number; parameterId: string; value: string; correctionReason?: string | null; equipmentRef?: string | null; idempotencyKey?: string | null },
) {
  ctx.require("production.process_step_record.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.process_step_reading.record", async () => {
      const step = findStep(batch, input.stepNo);
      const p = (step.parameters ?? []).find((x) => x.id === input.parameterId);
      if (!p) throw new DomainError("validation", "This parameter is not part of the step's routing revision.");
      const ev = evaluateReading(p, input.value);
      const rec = await openStep(tx, ctx, batch, step);
      const current = (await currentReadings(tx, rec.id)).find((r) => r.routingStepParameterId === p.id);
      const correction = input.correctionReason?.trim() || null;
      if (current && (!correction || correction.length < 5)) {
        throw new DomainError("validation", `${p.name} already has a reading. Give a correction reason (at least 5 characters) to replace it.`, { field: "correctionReason" });
      }
      let equipmentId: string | null = null;
      if (input.equipmentRef) equipmentId = (await useEquipment(tx, ctx, batch, step, rec, input.equipmentRef)).equipment.id;
      const [row] = await tx
        .insert(processStepReadings)
        .values({
          organizationId: ctx.organizationId,
          siteId: batch.siteId,
          processStepRecordId: rec.id,
          routingStepParameterId: p.id,
          parameterCode: p.code,
          parameterName: p.name,
          valueKind: p.valueKind,
          uom: p.uom,
          minValue: p.minValue,
          targetValue: p.targetValue,
          maxValue: p.maxValue,
          valueNumeric: ev.valueNumeric,
          valueText: ev.valueText,
          valueBoolean: ev.valueBoolean,
          isWithinLimits: ev.within,
          equipmentId,
          recordedBy: ctx.userId,
          supersedesId: current?.id ?? null,
          correctionReason: current ? correction : null,
        })
        .returning();
      const shown = ev.valueNumeric ?? ev.valueText ?? (ev.valueBoolean ? "yes" : "no");
      await audit(tx, ctx, {
        action: current ? "production.process_step_reading.corrected" : "production.process_step_reading.recorded",
        entityType: "process_step_reading",
        entityId: row.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        reason: current ? correction : null,
        before: current ? { value: current.valueNumeric ?? current.valueText ?? current.valueBoolean, isWithinLimits: current.isWithinLimits } : null,
        after: { stepNo: step.stepNo, parameter: p.code, value: shown, uom: p.uom, min: p.minValue, max: p.maxValue, isWithinLimits: ev.within },
      });
      const limitText = limitsLabel(p);
      if (!ev.within) {
        await tx
          .update(processStepRecords)
          .set({ blockedReason: `${p.name} ${shown}${p.uom ? ` ${p.uom}` : ""} is outside ${limitText}.` })
          .where(eq(processStepRecords.id, rec.id));
      }
      return { readingId: row.id, isWithinLimits: ev.within, parameter: p.name, value: shown, limits: limitText };
    });
    return result;
  });
}

export function limitsLabel(p: { minValue: string | null; maxValue: string | null; uom: string | null; valueKind: string }) {
  if (p.valueKind === "boolean") return "the required answer (yes)";
  if (p.minValue === null && p.maxValue === null) return "no limits";
  const u = p.uom ? ` ${p.uom}` : "";
  if (p.minValue !== null && p.maxValue !== null) return `${new Decimal(p.minValue).toString()}–${new Decimal(p.maxValue).toString()}${u}`;
  return p.minValue !== null ? `≥ ${new Decimal(p.minValue).toString()}${u}` : `≤ ${new Decimal(p.maxValue!).toString()}${u}`;
}

/* ================================================================== blockers and exception */

export type Blocker = { message: string; exceptionable: boolean };

/**
 * What keeps a process-type step from completing (W05-11..13): required readings missing,
 * readings outside limits (exceptionable: CX-TOL), required equipment not recorded, a required
 * in-process inspection not passed, a hold/curing step before its minimum duration (exceptionable).
 */
export async function processBlockers(q: DbOrTx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep, rec: StepRecord | null): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const params = step.parameters ?? [];
  const readings = rec ? await currentReadings(q, rec.id) : [];
  for (const p of params) {
    const r = readings.find((x) => x.routingStepParameterId === p.id);
    if (!r) {
      if (p.isRequired) out.push({ message: `Record ${p.name}${p.uom ? ` (${p.uom})` : ""}.`, exceptionable: false });
    } else if (!r.isWithinLimits && !rec?.deviationId) {
      const shown = r.valueNumeric ?? r.valueText ?? (r.valueBoolean ? "yes" : "no");
      out.push({ message: `${p.name} ${shown}${p.uom ? ` ${p.uom}` : ""} is outside ${limitsLabel(p)}: needs a controlled exception with a deviation (CX-TOL).`, exceptionable: true });
    }
  }
  if (step.requiresEquipment) {
    const uses = rec ? await q.select({ id: equipmentUses.id }).from(equipmentUses).where(eq(equipmentUses.processStepRecordId, rec.id)) : [];
    if (!uses.length) out.push({ message: `Select the ${step.equipmentKind ?? "equipment"} used.`, exceptionable: false });
  }
  const details = await routingStepDetails(q, step.routingStepId);
  if (details.inspectionPlanId) {
    const hook = executionHooks().inProcessQcStatus;
    if (!hook || !rec) {
      out.push({ message: !rec ? "Start the step to request the in-process inspection." : "This step needs an in-process inspection, and QA inspections are not connected yet. The step stays blocked: ask QA.", exceptionable: false });
    } else {
      const s = await hook(q as Tx, ctx, { batchId: batch.id, processStepRecordId: rec.id, inspectionPlanId: details.inspectionPlanId });
      if (s.status === "pending") out.push({ message: s.message ?? "The in-process inspection is not complete yet.", exceptionable: false });
      if (s.status === "failed") out.push({ message: s.message ?? "The in-process inspection failed. The step is blocked; QA handles the deviation and hold.", exceptionable: false });
    }
  }
  if ((HOLD_STEP_KINDS as readonly string[]).includes(step.stepKind) && rec?.earliestCompletionAt && !rec.deviationId) {
    if (rec.earliestCompletionAt.getTime() > Date.now()) {
      out.push({ message: `The minimum hold time ends ${rec.earliestCompletionAt.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}. Ending earlier needs a controlled exception with a deviation.`, exceptionable: true });
    }
  }
  return out;
}

/**
 * Controlled exception on a step (CX-TOL: reading outside limits, early end of a hold, packaging
 * reconciliation mismatch). Approved on the operator's device by a person holding
 * production.over_tolerance_dispense.approve (qa_qc or site_manager) other than the operator, with a
 * reason; a deviation is opened through the quality module. Without the deviations module the
 * request is refused and the step stays blocked.
 */
export async function approveStepException(
  ctx: AuthContext,
  input: { batchId: string; stepNo: number; reason: string; kind?: DeviationKind },
  signers: { approver: AuthContext },
) {
  ctx.require("production.process_step_record.create");
  const approver = signers.approver;
  approver.require("production.over_tolerance_dispense.approve");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new DomainError("validation", "Describe the exception and the decision (at least 10 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    approver.requireSite(batch.siteId);
    const step = findStep(batch, input.stepNo);
    const rec = await stepRecord(tx, batch.id, step.stepNo);
    if (!rec || rec.status !== "in_progress") throw new DomainError("state", `${stepLabel(step)} is not in progress.`);
    if (approver.userId === ctx.userId || approver.userId === rec.conductedBy) {
      throw new DomainError("separation_of_duties", "The exception must be approved by someone other than the operator.");
    }
    if (rec.deviationId) throw new DomainError("state", "This step already has an approved exception.");
    const opener = executionHooks().openDeviation;
    if (!opener) throw new DomainError("state", DEVIATION_UNAVAILABLE, { rule: "CX-TOL" });
    const { deviationId } = await opener(tx, approver, {
      kind: input.kind ?? "out_of_tolerance",
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      siteId: batch.siteId,
      processStepRecordId: rec.id,
      description: `${stepLabel(step)}: ${rec.blockedReason ?? "exception"}. Decision: ${reason}`,
      approvedBy: approver.userId,
    });
    await tx.update(processStepRecords).set({ exceptionApprovedBy: approver.userId, exceptionReason: reason, deviationId, blockedReason: null }).where(eq(processStepRecords.id, rec.id));
    await audit(tx, approver, {
      action: "production.process_step_record.exception_approved",
      entityType: "process_step_record",
      entityId: rec.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      after: { stepNo: step.stepNo, deviationId, operator: ctx.displayName, blockedReason: rec.blockedReason },
    });
    return { deviationId };
  });
}
