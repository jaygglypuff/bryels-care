/**
 * ADR-088 §2: how a record names an approver who approved their own request (a top role under the setting
 * `approvals.top_roles_self_approve`, or the ADR-073 owner override). Read models use it so every screen that
 * prints "Approved by <name>" prints "Approved by <name> (own request)" without screen changes.
 */
export const OWN_REQUEST_SUFFIX = " (own request)";

export function approverLabel(name: string | null | undefined, approverId: string | null | undefined, requesterIds: readonly (string | null | undefined)[]): string | null {
  if (!name) return name ?? null;
  return approverId && requesterIds.some((r) => !!r && r === approverId) ? `${name}${OWN_REQUEST_SUFFIX}` : name;
}
