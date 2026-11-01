import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { bomLines, materials } from "./masterdata";
import { batchMaterials, batches, testResults } from "./production";

/**
 * ADR-104 floor decisions (owner request 2026-11-01; docs/production-flow-v2.md §4.5). Migration 0035.
 * Every table here is append-only except the `status` / decision columns of the two request tables, which
 * move once from `pending` (src/db/sql/adr104.sql guards the rest).
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * The recipe's approved alternatives for one ingredient line (ADR-104 §1b): part of the recipe revision, so they
 * are approved with it (QA step of the recipe approval) and fixed once the revision is approved. `ratio` scales
 * the line's amount (1 = the same grams). Draft lines are replaced as a whole on save, so the rows cascade.
 */
export const bomLineAlternatives = pgTable(
  "bom_line_alternatives",
  {
    id: id(),
    bomLineId: uuid("bom_line_id")
      .notNull()
      .references(() => bomLines.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    ratio: numeric("ratio", QTY).notNull().default("1"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bom_line_alternatives_line_material_uq").on(t.bomLineId, t.materialId), check("ck_bom_line_alternatives_ratio", sql`${t.ratio} > 0 and ${t.ratio} <= 10`)],
);

export const SUBSTITUTION_REQUEST_STATUSES = ["pending", "approved", "refused", "withdrawn"] as const;
export type SubstitutionRequestStatus = (typeof SUBSTITUTION_REQUEST_STATUSES)[number];

/**
 * "Ask to use something else" (ADR-104 §1b, A-FD-02): another ingredient for one batch line, asked on the floor
 * and decided by a QA person (approval kind `approval.material_substitution`). The requester can never decide;
 * the owner override and the top-role self-approval (ADR-091) do not apply. Approval swaps the line for this
 * batch only (batch_material_substitutions kind `approved_other`).
 */
export const materialSubstitutionRequests = pgTable(
  "material_substitution_requests",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    batchId: uuid("batch_id")
      .notNull()
      .references((): AnyPgColumn => batches.id),
    batchMaterialId: uuid("batch_material_id")
      .notNull()
      .references((): AnyPgColumn => batchMaterials.id),
    /** The recipe's ingredient on the line. */
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id),
    substituteMaterialId: uuid("substitute_material_id")
      .notNull()
      .references(() => materials.id),
    /** Amount of the other ingredient, in its base unit. */
    qtyBase: numeric("qty_base", QTY).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("material_substitution_requests_batch_idx").on(t.batchId),
    index("material_substitution_requests_site_status_idx").on(t.siteId, t.status),
    uniqueIndex("material_substitution_requests_one_pending_uq").on(t.batchMaterialId).where(sql`${t.status} = 'pending'`),
    uniqueIndex("material_substitution_requests_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("ck_material_substitution_requests_status", sql`${t.status} in (${inList(SUBSTITUTION_REQUEST_STATUSES)})`),
    check("ck_material_substitution_requests_qty", sql`${t.qtyBase} > 0`),
    check("ck_material_substitution_requests_reason", sql`length(btrim(${t.reason})) >= 5`),
    check("ck_material_substitution_requests_other", sql`${t.substituteMaterialId} <> ${t.materialId}`),
    check("ck_material_substitution_requests_decider", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    check("ck_material_substitution_requests_decided", sql`(${t.status} in ('approved', 'refused')) = (${t.decidedBy} is not null and ${t.decidedAt} is not null)`),
  ],
);

export const RESULT_CORRECTION_STATUSES = ["pending", "approved", "refused", "withdrawn"] as const;
export type ResultCorrectionStatus = (typeof RESULT_CORRECTION_STATUSES)[number];

/**
 * Correcting a QA test result AFTER the decision (ADR-104 §3, A-FD-04): a request with the new value and the
 * reason, decided by a second QA person (never the requester; the owner override never applies). Approval adds
 * the superseding result row and re-opens the decision (batch and lot back to the quality check, the decision's
 * stock moves reversed). Refused when stock of the lot has already moved on (`blocked_reason` explains).
 * Corrections BEFORE a decision need no request: they are a superseding test_results row directly.
 */
export const qaResultCorrections = pgTable(
  "qa_result_corrections",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    batchId: uuid("batch_id")
      .notNull()
      .references((): AnyPgColumn => batches.id),
    testResultId: uuid("test_result_id")
      .notNull()
      .references((): AnyPgColumn => testResults.id),
    /** The new value as typed (numeric or text), and the pass/fail for free-form and pass/fail tests. */
    value: text("value").notNull(),
    conforms: boolean("conforms"),
    uom: text("uom"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** The superseding result written on approval. */
    newResultId: uuid("new_result_id").references((): AnyPgColumn => testResults.id),
    /** What the approval re-opened (batch from/to, lot from/to, movements reversed). */
    reopened: jsonb("reopened"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("qa_result_corrections_batch_idx").on(t.batchId),
    index("qa_result_corrections_site_status_idx").on(t.siteId, t.status),
    uniqueIndex("qa_result_corrections_one_pending_uq").on(t.testResultId).where(sql`${t.status} = 'pending'`),
    uniqueIndex("qa_result_corrections_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("ck_qa_result_corrections_status", sql`${t.status} in (${inList(RESULT_CORRECTION_STATUSES)})`),
    check("ck_qa_result_corrections_reason", sql`length(btrim(${t.reason})) >= 5`),
    check("ck_qa_result_corrections_decider", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    check("ck_qa_result_corrections_decided", sql`(${t.status} in ('approved', 'refused')) = (${t.decidedBy} is not null and ${t.decidedAt} is not null)`),
    check("ck_qa_result_corrections_approved", sql`${t.status} <> 'approved' or ${t.newResultId} is not null`),
  ],
);

/**
 * "Stop for today" (ADR-104 §5): where the batch stopped (prefilled from the step) and a short note. The batch
 * stays "Being made"; the next day's task reads "Continue … · step 4 · started yesterday". Append-only.
 */
export const batchPauses = pgTable(
  "batch_pauses",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id),
    batchId: uuid("batch_id")
      .notNull()
      .references((): AnyPgColumn => batches.id),
    stepNo: integer("step_no").notNull(),
    whereStopped: text("where_stopped").notNull(),
    note: text("note"),
    pausedBy: uuid("paused_by")
      .notNull()
      .references(() => users.id),
    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("batch_pauses_batch_idx").on(t.batchId, t.pausedAt),
    uniqueIndex("batch_pauses_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("ck_batch_pauses_where", sql`length(btrim(${t.whereStopped})) >= 2`),
  ],
);
