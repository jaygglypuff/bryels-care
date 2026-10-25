import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { equipment, idempotencyKeys, maintenancePlans, rolePermissions, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { syncMaintenanceDueDate } from "@/modules/masterdata";

/** Today in Asia/Manila (YYYY-MM-DD), the plant's business date (ADR-019). */
export function manilaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Active users who hold `permission` at the site (directly or organization-wide), for owner / technician pickers. */
export async function usersWithPermissionAt(q: DbOrTx, organizationId: string, permission: Permission, siteId: string) {
  return q
    .selectDistinct({ id: users.id, name: users.displayName })
    .from(userSiteAssignments)
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, permission),
        activeAssignment(),
        or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, siteId)),
      ),
    )
    .orderBy(asc(users.displayName));
}

export async function assertTechnician(q: DbOrTx, ctx: AuthContext, userId: string | null, siteId: string, field: string) {
  if (!userId) return;
  const ok = (await usersWithPermissionAt(q, ctx.organizationId, "maintenance.work_order.edit", siteId)).some((u) => u.id === userId);
  if (!ok) throw new DomainError("validation", "Choose an active technician who can work on maintenance orders at this site.", { field, fieldErrors: { [field]: "Not a technician at this site." } });
}

/** Equipment of the organization at one of the caller's sites (404 otherwise). */
export async function equipmentInScope(q: DbOrTx, ctx: AuthContext, equipmentId: string) {
  const [e] = await q.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.organizationId, ctx.organizationId))).limit(1);
  if (!e || !ctx.allowedSiteIds.includes(e.siteId)) throw new DomainError("not_found", "Equipment not found in your sites.");
  return e;
}

/**
 * Keeps the equipment's stored next-maintenance date equal to the earliest due date of its active
 * time-based PM plans (W1D derives `maintenance_due` from it). `previousDue` is cleared from the equipment
 * when no time-based plan is left and the stored date was that plan's.
 */
export async function syncEquipmentDue(tx: Tx, ctx: AuthContext, equipmentId: string, reason: string, previousDue: string | null = null) {
  const plans = await tx
    .select({ due: maintenancePlans.nextDueOn })
    .from(maintenancePlans)
    .where(and(eq(maintenancePlans.equipmentId, equipmentId), eq(maintenancePlans.status, "active"), eq(maintenancePlans.triggerKind, "time")));
  const dues = plans.map((p) => p.due).filter((d): d is string => !!d).sort();
  return syncMaintenanceDueDate(tx, ctx, equipmentId, dues[0] ?? null, { clearIfEquals: previousDue, reason });
}

export async function namesOf(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Idempotent command wrapper (ADR-009, same contract as the quality and production helpers): the first call
 * stores its result under the key inside the caller's transaction; a repeat returns the stored result.
 */
export async function withIdempotency<T extends object>(tx: Tx, ctx: AuthContext, key: string | null | undefined, command: string, fn: () => Promise<T>): Promise<T & { replayed?: boolean }> {
  if (!key) return fn();
  const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key, command }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
  if (inserted.length === 0) {
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key))).limit(1);
    if (!row || row.command !== command) throw new DomainError("conflict", "This request key was already used for a different action. Reload the page and try again.");
    if (!row.result) throw new DomainError("conflict", "This request is still being processed. Reload the page in a moment.");
    return { ...(row.result as T), replayed: true };
  }
  const result = await fn();
  await tx.update(idempotencyKeys).set({ result: sql`${JSON.stringify(result)}::jsonb` }).where(eq(idempotencyKeys.id, inserted[0].id));
  return result;
}
