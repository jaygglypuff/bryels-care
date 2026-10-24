import "server-only";
import type { DbOrTx } from "@/db/client";
import { getSetting } from "@/lib/settings";

/**
 * Read-only maintenance mode (US-2-30, A-DEP-21, docs/operations-runbook.md §17a.2).
 *
 * Setting `platform.maintenance.read_only` = `{enabled, allowed_role_codes}`. While enabled, the
 * AuthContext of a user holding none of the allowed roles is built read-only: every mutating
 * permission check (`ctx.require` of an action other than view/export), `ctx.assertWritable()`
 * (stock ledger, job enqueue, /api/v1 commands) refuses with `read_only` (HTTP 503
 * `READ_ONLY_MODE`) before any write. Reads, sign-in, `/api/health` and `/api/ready` keep
 * working. Distinct from `MAINTENANCE_MODE=1` (full 503 for restores), which is unchanged.
 */
export type MaintenanceState = { enabled: boolean; allowedRoleCodes: string[] };

export const READ_ONLY_MESSAGE = "Read-only for maintenance: changes are paused while the system is being prepared. Your entries were not saved; try again when the banner is gone.";

export async function getMaintenanceState(q: DbOrTx, organizationId: string): Promise<MaintenanceState> {
  const v = await getSetting(q, organizationId, "platform.maintenance.read_only");
  return { enabled: v.enabled, allowedRoleCodes: v.allowed_role_codes };
}

/** True when the mode is on and the user holds none of the allow-listed roles. */
export function isReadOnlyFor(state: MaintenanceState, roleCodes: readonly string[]): boolean {
  return state.enabled && !roleCodes.some((r) => state.allowedRoleCodes.includes(r));
}

/** Permission actions that never change data (the read-only mode lets them through). */
export function isReadAction(permission: string): boolean {
  const action = permission.slice(permission.lastIndexOf(".") + 1);
  return action === "view" || action === "export";
}
