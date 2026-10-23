import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * QA decisions on a lot or a batch. decision: release | reject | hold | release_from_hold.
 * Only qa_qc may decide; the decider must differ from the person who submitted the work (SoD).
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
  },
  (t) => [index("dispositions_subject_idx").on(t.subjectType, t.subjectId)],
);
