import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers } from "./masterdata";
import { inventoryLots } from "./inventory";
import { shipments } from "./sales";
import { containers } from "./containers";
import { deviations } from "./quality-ext";
import { complaints } from "./complaints";
import { dispositions } from "./quality";

/**
 * Wave 4 W4C: quality system completion (US-6-18; docs/data-model.md §3.6 `capas`, `capa_actions`,
 * `change_controls`, `recall_cases`, `recall_case_*`; process map W07-04, W07-08..10).
 *
 * Nothing here decides a regulatory rule: effectiveness-check periods, risk levels, recall
 * classification, notification obligations and the notice wording are company configuration
 * (settings `quality.capa.*`, `quality.change_control.*`, `quality.recall_case.*`) or free text
 * entered and validated by the company's QA / regulatory personnel.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/* ------------------------------------------------------------------ CAPA (W07-04) */

/** CAPA state machine (`CAPA_TRANSITIONS` in src/modules/quality/capa-rules.ts). */
export const CAPA_STATUSES = ["open", "in_progress", "verification", "closed", "cancelled"] as const;
export const CAPA_SOURCES = ["deviation", "complaint", "audit", "change_control", "other"] as const;
export const CAPA_ACTION_KINDS = ["corrective", "preventive"] as const;
export const CAPA_ACTION_STATUSES = ["open", "done", "verified", "cancelled"] as const;
export const CAPA_EFFECTIVENESS_RESULTS = ["effective", "not_effective"] as const;

/**
 * Corrective and preventive action (FR-quality-07, rule CAPA). `owner_id` is the CAPA owner; each action
 * has its own owner and due date (capa_actions). Closure needs a recorded effectiveness check with result
 * `effective` and a closer other than the person who submitted it for closure (separation of duties).
 */
export const capas = pgTable(
  "capas",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    capaNumber: text("capa_number").notNull(),
    status: text("status").notNull().default("open"),
    sourceKind: text("source_kind").notNull(),
    deviationId: uuid("deviation_id").references(() => deviations.id),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    /** Free reference for audit / other sources (e.g. "Internal audit 2026-Q3 finding 4"). */
    sourceReference: text("source_reference"),
    title: text("title").notNull(),
    problemStatement: text("problem_statement").notNull(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    dueDate: date("due_date"),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
    preventiveAction: text("preventive_action"),
    /** What will show the actions worked (QA's criterion; the system never invents one). */
    effectivenessCriteria: text("effectiveness_criteria"),
    /** Earliest date the effectiveness check may be recorded (submission + quality.capa.effectiveness_check_days unless QA sets a date). */
    effectivenessDueOn: date("effectiveness_due_on"),
    effectivenessResult: text("effectiveness_result"),
    effectivenessEvidence: text("effectiveness_evidence"),
    effectivenessCheckedBy: uuid("effectiveness_checked_by").references(() => users.id),
    effectivenessCheckedAt: timestamp("effectiveness_checked_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureNote: text("closure_note"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("uq_capas_org_number").on(t.organizationId, t.capaNumber),
    uniqueIndex("uq_capas_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_capas_site_status").on(t.siteId, t.status),
    index("ix_capas_deviation").on(t.deviationId),
    index("ix_capas_complaint").on(t.complaintId),
    check("ck_capas_status", sql`${t.status} in (${inList(CAPA_STATUSES)})`),
    check("ck_capas_source", sql`${t.sourceKind} in (${inList(CAPA_SOURCES)})`),
    check("ck_capas_source_link", sql`(${t.sourceKind} <> 'deviation' or ${t.deviationId} is not null) and (${t.sourceKind} <> 'complaint' or ${t.complaintId} is not null)`),
    check("ck_capas_effectiveness", sql`${t.effectivenessResult} is null or (${t.effectivenessResult} in (${inList(CAPA_EFFECTIVENESS_RESULTS)}) and ${t.effectivenessCheckedBy} is not null and ${t.effectivenessCheckedAt} is not null and ${t.effectivenessEvidence} is not null)`),
    check(
      "ck_capas_closed",
      sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null and coalesce(${t.effectivenessResult} = 'effective', false) and ${t.rootCause} is not null)`,
    ),
    check("ck_capas_closer_not_submitter", sql`${t.closedBy} is null or ${t.closedBy} is distinct from ${t.submittedBy}`),
    check("ck_capas_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/** Individual CAPA actions with owner and due date (W07-04); overdue rows show in the action centre. */
export const capaActions = pgTable(
  "capa_actions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    capaId: uuid("capa_id").notNull().references(() => capas.id),
    actionNo: integer("action_no").notNull(),
    actionKind: text("action_kind").notNull(),
    description: text("description").notNull(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    dueDate: date("due_date").notNull(),
    status: text("status").notNull().default("open"),
    /** How a second person will verify the action was done (W07-04 "verification method"). */
    verificationMethod: text("verification_method"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    completionNote: text("completion_note"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verificationNote: text("verification_note"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_capa_actions_no").on(t.capaId, t.actionNo),
    index("ix_capa_actions_open_due").on(t.siteId, t.status, t.dueDate),
    check("ck_capa_actions_kind", sql`${t.actionKind} in (${inList(CAPA_ACTION_KINDS)})`),
    check("ck_capa_actions_status", sql`${t.status} in (${inList(CAPA_ACTION_STATUSES)})`),
    check("ck_capa_actions_done", sql`${t.status} not in ('done', 'verified') or (${t.completedAt} is not null and ${t.completedBy} is not null and ${t.completionNote} is not null)`),
    check("ck_capa_actions_verified", sql`(${t.status} = 'verified') = (${t.verifiedBy} is not null and ${t.verifiedAt} is not null)`),
    check("ck_capa_actions_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

export const capaStateTransitions = pgTable(
  "capa_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    capaId: uuid("capa_id").notNull().references(() => capas.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_capa_transitions_capa").on(t.capaId, t.occurredAt)],
);

/* ------------------------------------------------------------------ change control (FR-quality-07) */

/** Change control state machine (`CHANGE_CONTROL_TRANSITIONS` in src/modules/quality/change-control-rules.ts). */
export const CHANGE_CONTROL_STATUSES = ["draft", "submitted", "approved", "rejected", "implemented", "closed", "cancelled"] as const;
/**
 * The versioned records a change control can govern (W1D revisions). `other` = a change without a
 * versioned record in the system (e.g. a supplier change); its implementation is a written note.
 */
export const CHANGE_CONTROL_ENTITY_TYPES = ["formula_revision", "routing_revision", "inspection_plan", "work_instruction_revision", "other"] as const;

/**
 * Controlled change to a versioned record (rule CC). Approval steps come from `approval_rules`
 * (document type `change_control`), decisions in `approval_decisions`. The change is implemented
 * through the record's own revision workflow; `implemented` requires the linked revision to be
 * approved (it is never edited from here).
 */
export const changeControls = pgTable(
  "change_controls",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    changeNumber: text("change_number").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    justification: text("justification").notNull(),
    entityType: text("entity_type").notNull(),
    /** The revision (draft or approved) that implements the change; may be linked until implementation. */
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    capaId: uuid("capa_id").references(() => capas.id),
    /** Risk level from quality.change_control.risk_levels (QA-defined meaning). */
    riskLevel: text("risk_level"),
    impactAssessment: text("impact_assessment"),
    implementationPlan: text("implementation_plan"),
    targetDate: date("target_date"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    implementedBy: uuid("implemented_by").references(() => users.id),
    implementedAt: timestamp("implemented_at", { withTimezone: true }),
    implementationNote: text("implementation_note"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureNote: text("closure_note"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("uq_change_controls_org_number").on(t.organizationId, t.changeNumber),
    uniqueIndex("uq_change_controls_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_change_controls_status").on(t.organizationId, t.status),
    index("ix_change_controls_entity").on(t.entityType, t.entityId),
    check("ck_change_controls_status", sql`${t.status} in (${inList(CHANGE_CONTROL_STATUSES)})`),
    check("ck_change_controls_entity_type", sql`${t.entityType} in (${inList(CHANGE_CONTROL_ENTITY_TYPES)})`),
    check("ck_change_controls_submitted", sql`${t.status} in ('draft', 'cancelled') or (${t.submittedBy} is not null and ${t.submittedAt} is not null and ${t.impactAssessment} is not null and ${t.riskLevel} is not null)`),
    check("ck_change_controls_implemented", sql`${t.status} not in ('implemented', 'closed') or (${t.implementedBy} is not null and ${t.implementedAt} is not null and ${t.implementationNote} is not null)`),
    check("ck_change_controls_closed", sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null)`),
    check("ck_change_controls_closer", sql`${t.closedBy} is null or ${t.closedBy} <> ${t.implementedBy}`),
    check("ck_change_controls_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

export const changeControlStateTransitions = pgTable(
  "change_control_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    changeControlId: uuid("change_control_id").notNull().references(() => changeControls.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_change_control_transitions_cc").on(t.changeControlId, t.occurredAt)],
);

/* ------------------------------------------------------------------ recall cases (FR-quality-08, W07-08..10) */

/** Recall case state machine (`RECALL_CASE_TRANSITIONS` in src/modules/quality/recall-cases-rules.ts). */
export const RECALL_CASE_STATUSES = ["draft", "submitted", "approved", "notifying", "recovering", "closed", "cancelled"] as const;
export const RECALL_KINDS = ["recall", "withdrawal", "mock"] as const;
export const RECALL_LOT_OUTCOMES = ["pending", "recalled", "already_recalled", "not_marked"] as const;

/**
 * Recall / withdrawal / mock recall case (rule RC), organization-wide; `origin_site_id` is the site of the
 * subject it was opened from. Scope (lots, boxes, customers per shipment and lot) is copied from the recall
 * explorer's forward trace at opening and stored. Approval: `qa_qc` then `owner_director` by default
 * (approval_rules `recall_case`). Classification and notification obligations are free text entered by
 * QA / regulatory personnel; the system never computes them.
 */
export const recallCases = pgTable(
  "recall_cases",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    originSiteId: uuid("origin_site_id").references(() => sites.id),
    recallNumber: text("recall_number").notNull(),
    status: text("status").notNull().default("draft"),
    recallKind: text("recall_kind").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** Company classification (free text, QA/regulatory responsibility; flagged for review). */
    classification: text("classification"),
    /** Notification obligations and authority contacts as decided by QA/regulatory (free text). */
    regulatoryNotes: text("regulatory_notes"),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    /** The code the scope was traced from (lot, box, batch or supplier lot) and the trace direction. */
    subjectCode: text("subject_code").notNull(),
    subjectKind: text("subject_kind").notNull(),
    traceMode: text("trace_mode").notNull(),
    scopeAsOf: timestamp("scope_as_of", { withTimezone: true }).notNull(),
    /** Linked records at sites outside the opener's access when the scope was captured. */
    hiddenAtOpening: integer("hidden_at_opening").notNull().default(0),
    openedBy: uuid("opened_by").notNull().references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    markedBy: uuid("marked_by").references(() => users.id),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    recoveryStartedAt: timestamp("recovery_started_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureReport: text("closure_report"),
    /** Required when shipped − returned − accounted is not zero for some customer line at closure (W07-10). */
    reconciliationExplanation: text("reconciliation_explanation"),
    cancelReason: text("cancel_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_recall_cases_org_number").on(t.organizationId, t.recallNumber),
    uniqueIndex("uq_recall_cases_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_recall_cases_status").on(t.organizationId, t.status),
    check("ck_recall_cases_status", sql`${t.status} in (${inList(RECALL_CASE_STATUSES)})`),
    check("ck_recall_cases_kind", sql`${t.recallKind} in (${inList(RECALL_KINDS)})`),
    check("ck_recall_cases_mode", sql`${t.traceMode} in ('forward', 'reverse')`),
    check("ck_recall_cases_submitted", sql`${t.status} in ('draft', 'cancelled') or (${t.submittedBy} is not null and ${t.submittedAt} is not null)`),
    check("ck_recall_cases_approved", sql`${t.status} not in ('approved', 'notifying', 'recovering', 'closed') or ${t.approvedAt} is not null`),
    check("ck_recall_cases_closed", sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null and ${t.closureReport} is not null)`),
    check("ck_recall_cases_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/** Lots in the case scope; `disposition_id` is the `recall` disposition written by "Mark recalled". */
export const recallCaseLots = pgTable(
  "recall_case_lots",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recallCaseId: uuid("recall_case_id").notNull().references(() => recallCases.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    /** start | downstream (the trace role at opening). */
    traceRole: text("trace_role").notNull(),
    statusAtOpening: text("status_at_opening").notNull(),
    onHandAtOpening: numeric("on_hand_at_opening", QTY).notNull().default("0"),
    uomBase: text("uom_base").notNull(),
    outcome: text("outcome").notNull().default("pending"),
    dispositionId: uuid("disposition_id").references(() => dispositions.id),
    markedBy: uuid("marked_by").references(() => users.id),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("uq_recall_case_lots").on(t.recallCaseId, t.lotId),
    index("ix_recall_case_lots_lot").on(t.lotId),
    check("ck_recall_case_lots_outcome", sql`${t.outcome} in (${inList(RECALL_LOT_OUTCOMES)})`),
    check("ck_recall_case_lots_role", sql`${t.traceRole} in ('start', 'downstream')`),
    check("ck_recall_case_lots_marked", sql`${t.outcome} <> 'recalled' or (${t.dispositionId} is not null and ${t.markedBy} is not null and ${t.markedAt} is not null)`),
  ],
);

/** Affected boxes from the forward trace (data-model §10.3), stored at opening (W07-08). */
export const recallCaseContainers = pgTable(
  "recall_case_containers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recallCaseId: uuid("recall_case_id").notNull().references(() => recallCases.id),
    containerId: uuid("container_id").notNull().references(() => containers.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    statusAtOpening: text("status_at_opening").notNull(),
  },
  (t) => [uniqueIndex("uq_recall_case_containers").on(t.recallCaseId, t.containerId)],
);

/**
 * Customer notification list and return reconciliation (W07-08, W07-10): one row per customer, shipment
 * and lot from the forward trace. Reconciliation = shipped − returned − accounted; `returned` is refreshed
 * from posted customer returns, `accounted` (destroyed at the customer, consumed, confirmed not sold) is
 * entered by QA with a note.
 */
export const recallCaseCustomers = pgTable(
  "recall_case_customers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recallCaseId: uuid("recall_case_id").notNull().references(() => recallCases.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    drNumber: text("dr_number").notNull(),
    qtyShippedBase: numeric("qty_shipped_base", QTY).notNull(),
    qtyReturnedBase: numeric("qty_returned_base", QTY).notNull().default("0"),
    qtyAccountedBase: numeric("qty_accounted_base", QTY).notNull().default("0"),
    uomBase: text("uom_base").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notifiedBy: uuid("notified_by").references(() => users.id),
    notificationMethod: text("notification_method"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    accountedNote: text("accounted_note"),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("uq_recall_case_customers").on(t.recallCaseId, t.customerId, t.shipmentId, t.lotId),
    index("ix_recall_case_customers_case").on(t.recallCaseId),
    check("ck_recall_case_customers_qty", sql`${t.qtyShippedBase} >= 0 and ${t.qtyReturnedBase} >= 0 and ${t.qtyAccountedBase} >= 0`),
    check("ck_recall_case_customers_ack", sql`${t.acknowledgedAt} is null or ${t.notifiedAt} is not null`),
    check("ck_recall_case_customers_accounted", sql`${t.qtyAccountedBase} = 0 or ${t.accountedNote} is not null`),
  ],
);

export const recallCaseStateTransitions = pgTable(
  "recall_case_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recallCaseId: uuid("recall_case_id").notNull().references(() => recallCases.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_recall_case_transitions_case").on(t.recallCaseId, t.occurredAt)],
);
