/**
 * Wave 2 W2F demo data (fictional only; runs inside the ALLOW_DEMO_SEED-guarded seed):
 * - today's default approval rules (docs/permissions-matrix.md §5.2, A-PM-15) as `approval_rules` rows;
 * - a second system administrator ("Tess Ocampo", password demo1234) so a setting change request
 *   or a numbering version can be approved by a different administrator (S1-03, A-DM-25);
 * - one pending setting change request (export row limit) waiting for the owner or the second admin.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../schema";
import { DEFAULT_APPROVAL_RULES } from "../../modules/governance/default-rules";

type Db = PostgresJsDatabase<typeof s>;

export async function seedW2f(db: Db, a: { organizationId: string; passwordHash: string }) {
  const O = a.organizationId;
  const existing = await db.select({ id: s.approvalRules.id }).from(s.approvalRules).where(eq(s.approvalRules.organizationId, O)).limit(1);
  if (existing.length === 0) {
    await db.insert(s.approvalRules).values(DEFAULT_APPROVAL_RULES.map((r) => ({ ...r, organizationId: O, effectiveFrom: "2026-01-01" })));
  }

  const [adminRole] = await db.select().from(s.roles).where(and(eq(s.roles.organizationId, O), eq(s.roles.code, "system_admin")));
  const [admin] = await db.select().from(s.users).where(eq(s.users.email, "admin@bryels-care.test"));
  let [admin2] = await db.select().from(s.users).where(eq(s.users.email, "admin2@bryels-care.test"));
  if (!admin2 && adminRole) {
    [admin2] = await db.insert(s.users).values({ organizationId: O, email: "admin2@bryels-care.test", displayName: "Tess Ocampo", passwordHash: a.passwordHash }).returning();
    await db.insert(s.userSiteAssignments).values({ userId: admin2.id, roleId: adminRole.id, isOrganizationWide: true });
  }

  if (admin) {
    await db.insert(s.settingChangeRequests).values({
      organizationId: O,
      scope: "organization",
      key: "platform.rate_limits",
      oldValue: null,
      newValue: { api_per_minute: 900, scan_lookups_per_minute: 120, login_ip_per_minute: 20, login_ip_per_hour: 200 },
      reason: "Demo: the packing line tablets refresh often; raise the API limit (fictional request).",
      requiresApproval: true,
      status: "submitted",
      submittedBy: admin.id,
    });
  }
}
