/**
 * Production engineering master data (Wave 1 stream W1D; backlog E-3-01, E-3-02):
 * routings and their revisions, routing steps with parameters and checklist items, work
 * instructions, inspection plans and tests, the equipment register with service records,
 * state transitions, downtime and controlled-override requests (docs/data-model.md §3.2, §3.6, §4).
 * The generic approval_decisions ledger lives in ./platform.ts.
 *
 * Every limit, specification and step stored here is configuration entered and approved by the
 * company's process owners and QA; seed values are fictional placeholders.
 */
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { formulaRevisions, materials, products } from "./masterdata";
import { productionLines } from "./org";

const VERSION_STATUS_CK = `('draft', 'pending_approval', 'approved', 'rejected', 'retired')`;

// approval_decisions moved to ./platform.ts (shared by master data and inventory documents, ADR-028).

/* ------------------------------------------------------------------ work instructions */

export const workInstructions = pgTable(
  "work_instructions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("work_instructions_org_code_uq").on(t.organizationId, t.code)],
);

export const workInstructionRevisions = pgTable(
  "work_instruction_revisions",
  {
    id: id(),
    workInstructionId: uuid("work_instruction_id").notNull().references(() => workInstructions.id),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull().default("draft"),
    bodyMarkdown: text("body_markdown").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => workInstructionRevisions.id),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("wi_rev_uq").on(t.workInstructionId, t.revisionNo),
    uniqueIndex("wi_rev_one_open_uq").on(t.workInstructionId).where(sql`${t.status} in ('draft', 'pending_approval')`),
    check("wi_rev_status_ck", sql.raw(`status in ${VERSION_STATUS_CK}`)),
    check("wi_rev_effective_ck", sql`${t.status} not in ('approved', 'retired') or (${t.effectiveFrom} is not null and ${t.approvedBy} is not null)`),
    check("wi_rev_range_ck", sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/* ------------------------------------------------------------------ inspection plans */

/**
 * Versioned inspection plan (docs/data-model.md §3.6; US-3-03). Self-versioned by code:
 * one row per (code, revision_no). plan_kind incoming applies to a material; in_process and
 * finished_product apply to a product. Specifications are QA configuration; is_placeholder marks
 * fictional seed content that QA must replace before production use (A-PROC-20).
 */
export const inspectionPlans = pgTable(
  "inspection_plans",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    planKind: text("plan_kind").notNull(),
    productId: uuid("product_id").references(() => products.id),
    materialId: uuid("material_id").references(() => materials.id),
    samplingInstructions: text("sampling_instructions"),
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => inspectionPlans.id),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inspection_plans_code_rev_uq").on(t.organizationId, t.code, t.revisionNo),
    uniqueIndex("inspection_plans_one_open_uq").on(t.organizationId, t.code).where(sql`${t.status} in ('draft', 'pending_approval')`),
    index("inspection_plans_product_idx").on(t.productId),
    index("inspection_plans_material_idx").on(t.materialId),
    check("inspection_plans_status_ck", sql.raw(`status in ${VERSION_STATUS_CK}`)),
    check("inspection_plans_kind_ck", sql`${t.planKind} in ('incoming', 'in_process', 'finished_product')`),
    check("inspection_plans_subject_ck", sql`(${t.planKind} = 'incoming' and ${t.materialId} is not null and ${t.productId} is null) or (${t.planKind} <> 'incoming' and ${t.productId} is not null and ${t.materialId} is null)`),
    check("inspection_plans_effective_ck", sql`${t.status} not in ('approved', 'retired') or (${t.effectiveFrom} is not null and ${t.approvedBy} is not null)`),
    check("inspection_plans_range_ck", sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/** One test of a plan. numeric tests need a unit and at least one of spec_min / spec_max. */
export const inspectionPlanTests = pgTable(
  "inspection_plan_tests",
  {
    id: id(),
    inspectionPlanId: uuid("inspection_plan_id").notNull().references(() => inspectionPlans.id),
    sequence: integer("sequence").notNull(),
    testCode: text("test_code").notNull(),
    name: text("name").notNull(),
    method: text("method"),
    /** numeric | text | pass_fail */
    valueKind: text("value_kind").notNull(),
    uom: text("uom"),
    specMin: numeric("spec_min", QTY),
    specMax: numeric("spec_max", QTY),
    specText: text("spec_text"),
    isRequired: boolean("is_required").notNull().default(true),
  },
  (t) => [
    uniqueIndex("inspection_plan_tests_code_uq").on(t.inspectionPlanId, t.testCode),
    check("inspection_plan_tests_kind_ck", sql`${t.valueKind} in ('numeric', 'text', 'pass_fail')`),
    check("inspection_plan_tests_range_ck", sql`${t.specMin} is null or ${t.specMax} is null or ${t.specMin} <= ${t.specMax}`),
    check(
      "inspection_plan_tests_numeric_ck",
      sql`${t.valueKind} <> 'numeric' or (${t.uom} is not null and num_nonnulls(${t.specMin}, ${t.specMax}) >= 1)`,
    ),
  ],
);

/* ------------------------------------------------------------------ equipment */

/**
 * Equipment register (docs/data-model.md §3.1). status is the administrative state (§6.11:
 * in_service | maintenance | out_of_service); availability for a step is derived from status,
 * due dates, cleaning and qualification and never stored (equipmentAvailability()).
 */
export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    equipmentKind: text("equipment_kind").notNull(),
    /** Free-text line/area until production_lines exist (US-1-20). */
    lineLabel: text("line_label"),
    /** Line the equipment belongs to (W2G, US-1-20); line_label mirrors the line name for display. */
    productionLineId: uuid("production_line_id").references(() => productionLines.id),
    status: text("status").notNull().default("in_service"),
    calibrationIntervalDays: integer("calibration_interval_days"),
    lastCalibratedDate: date("last_calibrated_date"),
    calibrationDueDate: date("calibration_due_date"),
    maintenanceIntervalDays: integer("maintenance_interval_days"),
    lastMaintainedDate: date("last_maintained_date"),
    maintenanceDueDate: date("maintenance_due_date"),
    cleaningStatus: text("cleaning_status").notNull().default("clean"),
    lastCleanedAt: timestamp("last_cleaned_at", { withTimezone: true }),
    cleaningRule: text("cleaning_rule").notNull().default("per_batch"),
    qualificationStatus: text("qualification_status").notNull().default("not_required"),
    blockingRule: text("blocking_rule").notNull().default("block"),
    capacityMin: numeric("capacity_min", QTY),
    capacityMax: numeric("capacity_max", QTY),
    capacityUom: text("capacity_uom"),
    responsibleUserId: uuid("responsible_user_id").references(() => users.id),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("equipment_org_code_uq").on(t.organizationId, t.code),
    index("equipment_site_idx").on(t.siteId),
    check("equipment_code_ck", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check("equipment_kind_ck", sql`${t.equipmentKind} in ('scale', 'mixer', 'heater', 'kettle', 'homogenizer', 'mould', 'cutter', 'filler', 'labeller', 'other')`),
    check("equipment_status_ck", sql`${t.status} in ('in_service', 'maintenance', 'out_of_service')`),
    check("equipment_cleaning_status_ck", sql`${t.cleaningStatus} in ('clean', 'dirty', 'in_progress')`),
    check("equipment_cleaning_rule_ck", sql`${t.cleaningRule} in ('per_batch', 'per_changeover', 'none')`),
    check("equipment_qualification_ck", sql`${t.qualificationStatus} in ('not_required', 'qualified', 'pending', 'failed')`),
    check("equipment_blocking_rule_ck", sql`${t.blockingRule} in ('block', 'warn', 'none')`),
    check("equipment_capacity_ck", sql`${t.capacityMin} is null or ${t.capacityMax} is null or ${t.capacityMin} <= ${t.capacityMax}`),
    check("equipment_intervals_ck", sql`coalesce(${t.calibrationIntervalDays}, 1) > 0 and coalesce(${t.maintenanceIntervalDays}, 1) > 0`),
  ],
);

/** Cleaning, calibration, maintenance, repair, qualification and inspection events. Append-only; corrections supersede. */
export const equipmentServiceRecords = pgTable(
  "equipment_service_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    serviceKind: text("service_kind").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
    performedBy: uuid("performed_by").references(() => users.id),
    performedByExternal: text("performed_by_external"),
    /** pass | fail | completed */
    result: text("result").notNull(),
    nextDueDate: date("next_due_date"),
    referenceNumber: text("reference_number"),
    notes: text("notes"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => equipmentServiceRecords.id),
    correctionReason: text("correction_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("equipment_service_site_eq_idx").on(t.siteId, t.equipmentId, t.performedAt),
    check("equipment_service_kind_ck", sql`${t.serviceKind} in ('cleaning', 'calibration', 'preventive_maintenance', 'repair', 'qualification', 'inspection')`),
    check("equipment_service_result_ck", sql`${t.result} in ('pass', 'fail', 'completed')`),
    check("equipment_service_performer_ck", sql`num_nonnulls(${t.performedBy}, ${t.performedByExternal}) >= 1`),
    check("equipment_service_reviewer_ck", sql`${t.reviewedBy} is null or ${t.reviewedBy} is distinct from ${t.performedBy}`),
    check("equipment_service_correction_ck", sql`${t.supersedesId} is null or ${t.correctionReason} is not null`),
  ],
);

export const equipmentStateTransitions = pgTable(
  "equipment_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("equipment_transitions_eq_idx").on(t.equipmentId, t.occurredAt)],
);

/** Downtime opened by a move to maintenance/out_of_service and closed by the return to service. */
export const downtimeEvents = pgTable(
  "downtime_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: text("reason").notNull(),
    loggedBy: uuid("logged_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("downtime_site_started_idx").on(t.siteId, t.startedAt),
    uniqueIndex("downtime_one_open_uq").on(t.equipmentId).where(sql`${t.endedAt} is null`),
    check("downtime_range_ck", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

/**
 * CX-CAL controlled exception: permission to use equipment that is not available, time-boxed.
 * Two approvals by different users, neither the requester (site_manager, then qa_qc; A-PROC-23),
 * recorded in approval_decisions (record_type equipment_override). Wave 2 links equipment_uses
 * to an approved, unexpired request and opens the deviation.
 */
export const equipmentOverrideRequests = pgTable(
  "equipment_override_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    /** pending_approval | approved | rejected | cancelled */
    status: text("status").notNull().default("pending_approval"),
    reason: text("reason").notNull(),
    /** Availability reasons at the time of the request (evidence). */
    availabilityReasons: text("availability_reasons").array().notNull(),
    /** Batch number or work reference the override is for (free text until work orders exist). */
    workReference: text("work_reference"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("equipment_override_eq_idx").on(t.equipmentId, t.status),
    check("equipment_override_status_ck", sql`${t.status} in ('pending_approval', 'approved', 'rejected', 'cancelled')`),
    check("equipment_override_window_ck", sql`${t.validUntil} > ${t.validFrom}`),
  ],
);

/* ------------------------------------------------------------------ routings */

export const routings = pgTable(
  "routings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("routings_org_code_uq").on(t.organizationId, t.code), index("routings_product_idx").on(t.productId)],
);

/**
 * Versioned routing (US-3-02). change_scope is computed at submit: sequencing_only when the step
 * content equals the superseded revision except for order (one site_manager/owner approval,
 * A-PROC-41); otherwise quality_relevant (qa_qc, then site_manager/owner_director).
 */
export const routingRevisions = pgTable(
  "routing_revisions",
  {
    id: id(),
    routingId: uuid("routing_id").notNull().references(() => routings.id),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => routingRevisions.id),
    /** sequencing_only | quality_relevant (set at submit) */
    changeScope: text("change_scope"),
    changeSummary: text("change_summary"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("routing_rev_uq").on(t.routingId, t.revisionNo),
    uniqueIndex("routing_rev_one_open_uq").on(t.routingId).where(sql`${t.status} in ('draft', 'pending_approval')`),
    check("routing_rev_status_ck", sql.raw(`status in ${VERSION_STATUS_CK}`)),
    check("routing_rev_scope_ck", sql`${t.changeScope} is null or ${t.changeScope} in ('sequencing_only', 'quality_relevant')`),
    check("routing_rev_effective_ck", sql`${t.status} not in ('approved', 'retired') or (${t.effectiveFrom} is not null and ${t.approvedBy} is not null)`),
    check("routing_rev_range_ck", sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/**
 * Steps of a routing revision (the 7 BMR checklist rows are steps). formula_revision_id is the
 * MVP binding, kept nullable for migration compatibility and no longer written.
 */
export const routingSteps = pgTable(
  "routing_steps",
  {
    id: id(),
    routingRevisionId: uuid("routing_revision_id").notNull().references(() => routingRevisions.id),
    /** Legacy (MVP): steps hung off formula revisions. Not written any more. */
    formulaRevisionId: uuid("formula_revision_id").references(() => formulaRevisions.id),
    stepNo: integer("step_no").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    stepKind: text("step_kind").notNull(),
    /** weighing | production | packaging | filling | other; required for line_clearance */
    area: text("area"),
    /** Short inline guidance shown on the step; the controlled text is the work instruction revision. */
    instruction: text("instruction"),
    workInstructionRevisionId: uuid("work_instruction_revision_id").references(() => workInstructionRevisions.id),
    inspectionPlanId: uuid("inspection_plan_id").references(() => inspectionPlans.id),
    requiresChecker: boolean("requires_checker").notNull().default(true),
    blocksUntilComplete: boolean("blocks_until_complete").notNull().default(true),
    requiresEquipment: boolean("requires_equipment").notNull().default(false),
    equipmentKind: text("equipment_kind"),
    recordMode: text("record_mode").notNull().default("electronic"),
    minDurationMinutes: integer("min_duration_minutes"),
    expectedDurationMinutes: integer("expected_duration_minutes"),
  },
  (t) => [
    uniqueIndex("routing_steps_rev_step_uq").on(t.routingRevisionId, t.stepNo),
    check(
      "routing_steps_kind_ck",
      sql`${t.stepKind} in ('line_clearance', 'dispensing', 'process', 'in_process_qc', 'filling', 'cutting', 'curing', 'hold', 'packaging', 'reconciliation', 'transfer', 'checklist')`,
    ),
    check("routing_steps_area_ck", sql`${t.area} is null or ${t.area} in ('weighing', 'production', 'packaging', 'filling', 'other')`),
    check("routing_steps_clearance_area_ck", sql`${t.stepKind} <> 'line_clearance' or ${t.area} is not null`),
    check("routing_steps_record_mode_ck", sql`${t.recordMode} in ('electronic', 'paper_then_transcribe', 'paper_only')`),
    check("routing_steps_durations_ck", sql`coalesce(${t.minDurationMinutes}, 1) > 0 and coalesce(${t.expectedDurationMinutes}, 1) > 0`),
    check("routing_steps_equipment_ck", sql`not ${t.requiresEquipment} or ${t.equipmentKind} is not null`),
  ],
);

/** Process readings definition of a step: unit, limits and required flag. */
export const routingStepParameters = pgTable(
  "routing_step_parameters",
  {
    id: id(),
    routingStepId: uuid("routing_step_id").notNull().references(() => routingSteps.id),
    sequence: integer("sequence").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** numeric | text | boolean */
    valueKind: text("value_kind").notNull(),
    uom: text("uom"),
    minValue: numeric("min_value", QTY),
    targetValue: numeric("target_value", QTY),
    maxValue: numeric("max_value", QTY),
    isRequired: boolean("is_required").notNull().default(true),
  },
  (t) => [
    uniqueIndex("routing_step_params_code_uq").on(t.routingStepId, t.code),
    check("routing_step_params_kind_ck", sql`${t.valueKind} in ('numeric', 'text', 'boolean')`),
    check("routing_step_params_range_ck", sql`${t.minValue} is null or ${t.maxValue} is null or ${t.minValue} <= ${t.maxValue}`),
    check(
      "routing_step_params_target_ck",
      sql`${t.targetValue} is null or ((${t.minValue} is null or ${t.minValue} <= ${t.targetValue}) and (${t.maxValue} is null or ${t.targetValue} <= ${t.maxValue}))`,
    ),
    check("routing_step_params_numeric_ck", sql`${t.valueKind} <> 'numeric' or ${t.uom} is not null`),
  ],
);

/** Line-clearance and checklist content per step (A-PROC-07). */
export const routingStepChecklistItems = pgTable(
  "routing_step_checklist_items",
  {
    id: id(),
    routingStepId: uuid("routing_step_id").notNull().references(() => routingSteps.id),
    itemNo: integer("item_no").notNull(),
    text: text("text").notNull(),
    requiresPhoto: boolean("requires_photo").notNull().default(false),
    isBlocking: boolean("is_blocking").notNull().default(true),
  },
  (t) => [uniqueIndex("routing_step_checklist_item_uq").on(t.routingStepId, t.itemNo)],
);
