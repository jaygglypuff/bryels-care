import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sites, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { AuthContext } from "./context";

/**
 * The system actor (ADR-029). Each organization has ONE `users` row with status `system`:
 * - it can never sign in (status is not `active`, the password hash `!` matches nothing, it has
 *   no role assignments) and it is hidden from the user administration list;
 * - it exists so rows that require a person by foreign key (dispositions.decided_by,
 *   stock_movements.posted_by, reservations…) can be attributed to scheduled work;
 * - audit events of a system context carry actor_id null, actor_label `system:<job code>` and
 *   on_behalf_of = the user who triggered the work, if any (architecture §8 rule 4).
 */
export const SYSTEM_ACTOR_EMAIL = "system@bryels-care.invalid";
export const SYSTEM_USER_STATUS = "system";

/** Id of the organization's system user; created on first use (the seed also creates it). */
export async function systemActorId(organizationId: string): Promise<string> {
  const find = () =>
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.email, SYSTEM_ACTOR_EMAIL)))
      .limit(1);
  const [u] = await find();
  if (u) return u.id;
  const [created] = await db
    .insert(users)
    .values({ organizationId, email: SYSTEM_ACTOR_EMAIL, displayName: "System (scheduled jobs)", passwordHash: "!", status: SYSTEM_USER_STATUS })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (created) return created.id;
  const [again] = await find();
  return again.id;
}

/**
 * Context for work no user triggered (scheduled jobs) or that must be attributed to the system
 * (expiry check): every active site of the organization, only the permissions the job declares.
 */
export async function systemContext(
  organizationId: string,
  def: { code: string; systemPermissions?: Permission[] },
  opts: { correlationId?: string | null; onBehalfOf?: string | null } = {},
): Promise<AuthContext> {
  const siteRows = await db
    .select({ id: sites.id, code: sites.code, name: sites.name })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.isActive, true)))
    .orderBy(asc(sites.code));
  if (siteRows.length === 0) throw new DomainError("not_found", "The organization has no active site.");
  const userId = await systemActorId(organizationId);
  return new AuthContext(userId, organizationId, `System (${def.code})`, SYSTEM_ACTOR_EMAIL, [], new Set(def.systemPermissions ?? []), siteRows, siteRows[0].id, {
    actor: { kind: "system", code: def.code, onBehalfOf: opts.onBehalfOf ?? null },
    correlationId: opts.correlationId ?? null,
  });
}
