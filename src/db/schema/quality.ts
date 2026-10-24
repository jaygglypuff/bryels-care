import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
