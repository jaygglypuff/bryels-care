/**
 * Wave 3 W3B demo seed: default notification rules for the action centre (A-W3B-08: who hears about
 * which exception and when it escalates — owner to confirm) and one demo scheduled report (weekly
 * QA dispositions from the demo site manager to himself and the QA lead). Fictional data only.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";

type Db = PostgresJsDatabase<typeof s>;

/** [kind, name, severity, owner roles, escalate after hours, escalation roles] — demo defaults, configuration not policy. */
const RULES: [string, string, "info" | "warning" | "critical", string[], number | null, string[]][] = [
  ["failed_job", "Failed jobs to administrators", "critical", ["system_admin"], 4, ["owner_director"]],
  ["failed_import", "Failed imports to administrators", "critical", ["system_admin"], 8, ["owner_director"]],
  ["reconciliation_difference", "Stock differences to administrators and site managers", "critical", ["system_admin", "site_manager"], 24, ["owner_director"]],
  ["expired_stock", "Expired stock to QA and site managers", "critical", ["qa_qc", "site_manager"], 24, ["owner_director"]],
  ["expiring_lot", "Lots expiring soon to site managers", "warning", ["site_manager"], null, []],
  ["open_hold", "Open holds to QA", "warning", ["qa_qc"], 72, ["site_manager"]],
  ["open_deviation", "Open deviations to QA", "warning", ["qa_qc"], 72, ["owner_director"]],
  ["late_work_order", "Late work orders to planners and site managers", "warning", ["production_planner", "site_manager"], 48, ["owner_director"]],
  ["low_stock", "Low finished-goods stock to planners", "warning", ["production_planner"], null, []],
  ["unacknowledged_dr", "Unacknowledged delivery receipts to sales", "warning", ["sales_cs"], 48, ["site_manager"]],
  ["unshipped_order", "Late orders to sales and site managers", "warning", ["sales_cs", "site_manager"], 24, ["owner_director"]],
  ["approval.batch_disposition", "Batches waiting for QA", "warning", ["qa_qc"], 24, ["site_manager"]],
  ["approval.stock_adjustment", "Adjustments to approve", "info", ["site_manager"], 48, ["owner_director"]],
];

/** Next Monday 07:00 Asia/Manila (UTC+8, no daylight saving). */
function nextMondaySeven(now: Date): Date {
  const manila = new Date(now.getTime() + 8 * 3_600_000);
  const dow = manila.getUTCDay() === 0 ? 7 : manila.getUTCDay();
  const candidate = Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() + (8 - dow), 7 - 8, 0);
  return new Date(candidate);
}

export async function seedW3b(db: Db) {
  const [org] = await db.select().from(s.organizations).limit(1);
  if (!org) return;
  const O = org.id;
  const user = async (email: string) => (await db.select().from(s.users).where(and(eq(s.users.organizationId, O), eq(s.users.email, email))).limit(1))[0]?.id;
  const admin = (await user("admin@bryels-care.test"))!;
  const manager = (await user("manager.nfd@bryels-care.test"))!;
  const qa = (await user("qa.nfd@bryels-care.test"))!;
  await db.insert(s.notificationRules).values(
    RULES.map(([itemKind, name, severity, ownerRoleCodes, escalateAfterHours, escalationRoleCodes]) => ({
      organizationId: O,
      itemKind,
      name,
      severity,
      ownerRoleCodes,
      escalateAfterHours,
      escalationRoleCodes,
      createdBy: admin,
      updatedBy: admin,
    })),
  );
  const [nfd] = await db.select().from(s.sites).where(and(eq(s.sites.organizationId, O), eq(s.sites.code, "NFD"))).limit(1);
  const [sched] = await db
    .insert(s.scheduledReports)
    .values({
      organizationId: O,
      siteId: nfd.id,
      name: "Weekly QA decisions (demo)",
      reportCode: "RPT-QUA-DISPOSITIONS",
      ownerUserId: manager,
      cadence: "weekly",
      runAtTime: "07:00",
      weekday: 1,
      format: "xlsx",
      parameters: { period: "previous_week" },
      nextRunAt: nextMondaySeven(new Date()),
      createdBy: manager,
      updatedBy: manager,
    })
    .returning();
  await db.insert(s.scheduledReportRecipients).values([
    { scheduledReportId: sched.id, userId: manager },
    { scheduledReportId: sched.id, userId: qa },
  ]);
}
