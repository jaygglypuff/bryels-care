import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { nextActors } from "@/modules/governance";
import { waitingLine } from "./waiting-words";

/**
 * "Waiting for Rosa Lim (finance) to send it for approval." (ADR-088 NextStep, ADR-109): the people `nextActors` lists
 * for `permission` at the record's site — the viewer left out, and `exclude` (the requester, the approver who may not
 * also post, …) left out under the same-person rule (`operational` = ADR-091: a top role at the site may still act on
 * their own record). Falls back to the role words when nobody holds it. Who may act is still decided by the service.
 */
export async function waitingFor(
  ctx: AuthContext,
  permission: string,
  siteId: string | null,
  verb: string,
  fallbackRole: string,
  opts: { exclude?: readonly (string | null | undefined)[]; roleCodes?: readonly string[]; operational?: boolean; priorApproverIds?: readonly (string | null | undefined)[] } = {},
): Promise<string> {
  const next = await nextActors(
    ctx,
    { kind: `waiting.${permission}`, permission: permission as Permission, does: verb, doBase: verb, where: "", fallback: fallbackRole, operational: opts.operational, independent: !opts.operational },
    { siteId, excludeUserIds: opts.exclude, roleCodes: opts.roleCodes, priorApproverIds: opts.priorApproverIds },
  ).catch(() => null);
  return waitingLine(next?.people ?? [], verb, fallbackRole);
}
