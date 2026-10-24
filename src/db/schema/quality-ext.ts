import { type AnyPgColumn, bigint, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations } from "./masterdata";
import { inspectionPlans } from "./engineering";
import { inventoryLots, stockMovements } from "./inventory";
import { batches, dispenseRecords, processStepRecords, testResults } from "./production";
import { qualityHolds } from "./holds";
import { containers } from "./containers";

/**
 * Wave 2 W2C quality tables (E-3-05, E-3-07, E-2-07 US-2-23/24; docs/data-model.md §3.6, §6.6).
 * Specifications are never stored here: an inspection points at the frozen, QA-approved
 * inspection plan revision (W1D) and every result is evaluated against that plan's tests.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const INSPECTION_STATUSES = ["pending", "in_progress", "awaiting_review", "approved", "rejected", "cancelled"] as const;
export const INSPECTION_KINDS = ["incoming", "in_process", "finished_product"] as const;
export const INSPECTION_OUTCOMES = ["pass", "fail", "conditional"] as const;

/**
 * Inspection of a lot (incoming) or a batch (in-process / finished product), §6.6:
 * pending → in_progress → awaiting_review → approved | rejected; awaiting_review → in_progress
 * (returned for retest); pending | in_progress → cancelled (reason). Reviewer ≠ performer.
 */
export const inspections = pgTable(
  "inspections",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    inspectionNumber: text("inspection_number").notNull(),
    status: text("status").notNull().default("pending"),
    inspectionKind: text("inspection_kind").notNull(),
    inspectionPlanId: uuid("inspection_plan_id").notNull().references(() => inspectionPlans.id),
    /** Subject lot: the incoming lot, or the output lot of the batch (sampling source). */
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    batchId: uuid("batch_id").references(() => batches.id),
    processStepRecordId: uuid("process_step_record_id").references(() => processStepRecords.id),
    /** Projection of inspection_samples: first sample time and sampler, total sampled quantity. */
    sampledAt: timestamp("sampled_at", { withTimezone: true }),
    sampledBy: uuid("sampled_by").references(() => users.id),
    sampleQtyBase: numeric("sample_qty_base", QTY),
    sampleUom: text("sample_uom"),
    /** First user who entered a result. */
    performedBy: uuid("performed_by").references(() => users.id),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    outcome: text("outcome"),
    reviewNote: text("review_note"),
    cancelReason: text("cancel_reason"),
    /** Queue due time (setting quality.inspection.due_hours from creation). */
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("uq_inspections_org_number").on(t.organizationId, t.inspectionNumber),
    uniqueIndex("uq_inspections_org_idem").on(t.organizationId, t.idempotencyKey),
    // One live inspection per subject and plan revision: concurrent "start inspection" calls create one row.
    uniqueIndex("uq_inspections_batch_plan_live").on(t.batchId, t.inspectionPlanId).where(sql`${t.batchId} is not null and ${t.processStepRecordId} is null and ${t.status} <> 'cancelled'`),
    // In-process inspections (W05-12): one live inspection per executed step and plan.
    uniqueIndex("uq_inspections_step_plan_live").on(t.processStepRecordId, t.inspectionPlanId).where(sql`${t.processStepRecordId} is not null and ${t.status} <> 'cancelled'`),
    uniqueIndex("uq_inspections_lot_plan_live").on(t.lotId, t.inspectionPlanId).where(sql`${t.batchId} is null and ${t.lotId} is not null and ${t.status} <> 'cancelled'`),
    index("ix_inspections_site_status").on(t.siteId, t.status),
    index("ix_inspections_lot").on(t.lotId),
    index("ix_inspections_batch").on(t.batchId),
    check("ck_inspections_status", sql`${t.status} in (${inList(INSPECTION_STATUSES)})`),
    check("ck_inspections_kind", sql`${t.inspectionKind} in (${inList(INSPECTION_KINDS)})`),
    check("ck_inspections_outcome", sql`${t.outcome} is null or ${t.outcome} in (${inList(INSPECTION_OUTCOMES)})`),
    check("ck_inspections_subject", sql`num_nonnulls(${t.lotId}, ${t.batchId}) >= 1`),
    check("ck_inspections_reviewer_not_performer", sql`${t.reviewedBy} is null or ${t.performedBy} is null or ${t.reviewedBy} <> ${t.performedBy}`),
    check("ck_inspections_reviewed", sql`(${t.status} in ('approved','rejected')) = (${t.reviewedBy} is not null and ${t.reviewedAt} is not null and ${t.outcome} is not null)`),
    check("ck_inspections_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/** One row per physical sample (W06-02); removal posts a consumption movement with reason `sample` (A-PROC-34). */
export const inspectionSamples = pgTable(
  "inspection_samples",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    inspectionId: uuid("inspection_id").notNull().references(() => inspections.id),
    sampleNo: integer("sample_no").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    note: text("note"),
    sampledBy: uuid("sampled_by").notNull().references(() => users.id),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    consumptionMovementId: uuid("consumption_movement_id").references(() => stockMovements.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("uq_inspection_samples_no").on(t.inspectionId, t.sampleNo),
    uniqueIndex("uq_inspection_samples_org_idem").on(t.organizationId, t.idempotencyKey),
    check("ck_inspection_samples_qty", sql`${t.qtyBase} > 0`),
  ],
);

/** Inspection state log (data-model §6.1 shape). */
export const inspectionStateTransitions = pgTable(
  "inspection_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    inspectionId: uuid("inspection_id").notNull().references(() => inspections.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_inspection_transitions_inspection").on(t.inspectionId, t.occurredAt)],
);

export const DEVIATION_STATUSES = ["open", "investigating", "closed"] as const;
/** What raised the deviation (W07-01 triggers); `manual` = a person raised it from a screen. */
export const DEVIATION_SOURCES = ["manual", "cx_tol", "cx_cal", "in_process_check", "yield", "reconciliation", "oos", "other"] as const;

/**
 * Deviation / nonconformance (FR-production-08, FR-quality-05, W07-01..05; numbering DEV).
 * open → investigating → closed; open → closed allowed. Severity is classified by qa_qc from the
 * configured list (setting quality.deviation.severity_levels). Closure needs root cause,
 * resolution, the release conclusion and a user other than the raiser. While not closed it blocks
 * the release of its batch and lot; closed with release_permitted = false it keeps blocking.
 */
export const deviations = pgTable(
  "deviations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    deviationNumber: text("deviation_number").notNull(),
    status: text("status").notNull().default("open"),
    source: text("source").notNull().default("manual"),
    severity: text("severity"),
    description: text("description").notNull(),
    /** Step reference from the caller, e.g. "step 3" or a routing step code (free text, shown on the BMR). */
    stepRef: text("step_ref"),
    batchId: uuid("batch_id").references(() => batches.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    processStepRecordId: uuid("process_step_record_id").references(() => processStepRecords.id),
    dispenseRecordId: uuid("dispense_record_id").references(() => dispenseRecords.id),
    inspectionId: uuid("inspection_id").references(() => inspections.id),
    /** The out-of-specification result an OOS deviation investigates. */
    testResultId: uuid("test_result_id").references((): AnyPgColumn => testResults.id),
    raisedBy: uuid("raised_by").notNull().references(() => users.id),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    classifiedBy: uuid("classified_by").references(() => users.id),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    investigation: text("investigation"),
    impactAssessment: text("impact_assessment"),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    /** QA conclusion at closure: may the affected batch/lot still be released (W06 OOS path)? */
    releasePermitted: boolean("release_permitted"),
    effectivenessCheckOn: date("effectiveness_check_on"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_deviations_org_number").on(t.organizationId, t.deviationNumber),
    uniqueIndex("uq_deviations_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_deviations_site_status").on(t.siteId, t.status),
    index("ix_deviations_batch").on(t.batchId),
    index("ix_deviations_lot").on(t.lotId),
    index("ix_deviations_test_result").on(t.testResultId),
    check("ck_deviations_status", sql`${t.status} in (${inList(DEVIATION_STATUSES)})`),
    check("ck_deviations_source", sql`${t.source} in (${inList(DEVIATION_SOURCES)})`),
    check("ck_deviations_subject", sql`num_nonnulls(${t.batchId}, ${t.lotId}) >= 1`),
    check(
      "ck_deviations_closed",
      sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null and ${t.rootCause} is not null and ${t.resolution} is not null and ${t.releasePermitted} is not null and ${t.severity} is not null)`,
    ),
    check("ck_deviations_closer_not_raiser", sql`${t.closedBy} is null or ${t.closedBy} <> ${t.raisedBy}`),
  ],
);

/** Deviation state log (data-model §6.1 shape). */
export const deviationStateTransitions = pgTable(
  "deviation_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    deviationId: uuid("deviation_id").notNull().references(() => deviations.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_deviation_transitions_deviation").on(t.deviationId, t.occurredAt)],
);

/** Containment: QA holds placed for a deviation (W07-02). The hold itself is the W1B quality hold. */
export const deviationHolds = pgTable(
  "deviation_holds",
  {
    id: id(),
    deviationId: uuid("deviation_id").notNull().references(() => deviations.id),
    qualityHoldId: uuid("quality_hold_id").notNull().references(() => qualityHolds.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_deviation_holds_pair").on(t.deviationId, t.qualityHoldId), index("ix_deviation_holds_hold").on(t.qualityHoldId)],
);

/**
 * A conditional-release request (W06-05): the first qa_qc user proposes conditions and a review date;
 * a second user holding quality.conditional_release.approve decides. pending → approved | rejected | cancelled.
 * Only available when the setting quality.conditional_release.enabled is on (Q-QA-03, default off).
 */
export const dispositionRequests = pgTable(
  "disposition_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    decision: text("decision").notNull().default("conditional_release"),
    status: text("status").notNull().default("pending"),
    conditions: text("conditions").notNull(),
    reviewDate: date("review_date").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    dispositionId: uuid("disposition_id"),
  },
  (t) => [
    uniqueIndex("uq_disposition_requests_batch_pending").on(t.batchId).where(sql`${t.status} = 'pending'`),
    check("ck_disposition_requests_status", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
    check("ck_disposition_requests_decision", sql`${t.decision} in ('conditional_release')`),
    check("ck_disposition_requests_sod", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
  ],
);

/**
 * Label verification scans (US-2-24, MC-06): first verified scan of a container label (BC:BOX) or of a
 * loose lot label (BC:LOT) at a location. Append-only; the container state never changes.
 * Kept in its own table instead of containers.verified_* columns (docs/data-model.md §3.3) so the
 * container row stays owned by its state machine and a lot label can be verified too.
 */
export const labelVerifications = pgTable(
  "label_verifications",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    containerId: uuid("container_id").references(() => containers.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    scanPayload: text("scan_payload").notNull(),
    verifiedBy: uuid("verified_by").notNull().references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    clientSequence: bigint("client_sequence", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("uq_label_verifications_container").on(t.containerId).where(sql`${t.containerId} is not null`),
    uniqueIndex("uq_label_verifications_lot_location").on(t.lotId, t.locationId).where(sql`${t.containerId} is null`),
    index("ix_label_verifications_location").on(t.locationId),
    check("ck_label_verifications_subject", sql`num_nonnulls(${t.containerId}, ${t.lotId}) = 1`),
  ],
);
