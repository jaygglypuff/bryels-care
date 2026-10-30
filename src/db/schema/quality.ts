import { boolean, check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * QA decisions on a lot or a batch. decision: release | reject | hold | release_from_hold |
 * conditional_release (W2C) | hold_lifted | expire. Only qa_qc may decide; the decider must differ
 * from the person who submitted the work (SoD). Wave 2 W2C adds the requester (conditional release:
 * the first qa_qc user requests, a second decides), conditions + review date and the inspection basis.
 */
export const dispositions = pgTable(
  "dispositions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    /** lot | batch */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    decision: text("decision").notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    decidedBy: uuid("decided_by").notNull().references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    // Wave 2 W2C (US-3-15): basis and conditional release (docs/data-model.md §3.6)
    requestedBy: uuid("requested_by").references(() => users.id),
    conditions: text("conditions"),
    reviewDate: date("review_date"),
    inspectionId: uuid("inspection_id"),
  },
  (t) => [
    index("dispositions_subject_idx").on(t.subjectType, t.subjectId),
    check("ck_dispositions_requester_not_decider", sql`${t.requestedBy} is null or ${t.requestedBy} <> ${t.decidedBy}`),
    check("ck_dispositions_conditional", sql`${t.decision} <> 'conditional_release' or (${t.conditions} is not null and ${t.reviewDate} is not null and ${t.requestedBy} is not null)`),
  ],
);

/**
 * Check quality (ADR-080 §8, stage G3): one row per decision on the one-page check of a finished batch.
 * decision: pass | not_yet | fail. The "batch record reviewed" tick, the exceptions shown at the time,
 * the owner-override reason when the releaser worked on the batch (printed on the BMR), and whether the
 * releaser also entered the test results (setting quality.release.tester_may_release). Append-only.
 * `batch_id` has no foreign key on purpose: quality never constrains production rows (same as dispositions).
 */
export const batchQualityChecks = pgTable(
  "batch_quality_checks",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull(),
    decision: text("decision").notNull(),
    recordReviewed: boolean("record_reviewed").notNull(),
    /** The "Exceptions in this batch" box as shown to the decider (kind, text). */
    exceptions: jsonb("exceptions").notNull().default(sql`'[]'::jsonb`),
    reason: text("reason"),
    /** Not yet: the date QA checks again. */
    checkAgainOn: date("check_again_on"),
    /** Owner override past "the releaser worked on this batch": the typed reason (printed on the BMR). */
    overrideReason: text("override_reason"),
    /** The releaser entered test results of this batch (allowed by quality.release.tester_may_release). */
    testerReleased: boolean("tester_released").notNull().default(false),
    dispositionId: uuid("disposition_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    decidedBy: uuid("decided_by").notNull().references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("batch_quality_checks_batch_idx").on(t.batchId, t.decidedAt),
    uniqueIndex("batch_quality_checks_key_uq").on(t.organizationId, t.idempotencyKey),
    check("ck_batch_quality_checks_decision", sql`${t.decision} in ('pass', 'not_yet', 'fail')`),
    check("ck_batch_quality_checks_reviewed", sql`${t.decision} <> 'pass' or ${t.recordReviewed}`),
    check("ck_batch_quality_checks_reason", sql`${t.decision} = 'pass' or ${t.reason} is not null`),
  ],
);
