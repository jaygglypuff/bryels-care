import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { whoCanDo } from "@/modules/identity";

/** Short role words for the "Waiting for <name> (QA)" line. */
const SHORT: Record<string, string> = { qa_qc: "QA", site_manager: "manager", owner_director: "owner", production_planner: "planner", system_admin: "IT" };

/**
 * "Waiting for Ana Cruz (QA) to check it." for a version waiting at an approval step (ADR-088 NextStep):
 * the colleagues who hold the approve right and one of the step's roles (who-can-do directory, same
 * organization). The approval rules themselves (QA independence, ADR-091) stay in the service; this is
 * only who to ask. Falls back to the role words when no colleague is found.
 */
export async function waitingForApprover(
  ctx: AuthContext,
  permission: string,
  step: { step: number; label: string; roles: string[] } | null | undefined,
  totalSteps: number,
): Promise<string> {
  if (!step) return "Waiting for approval.";
  const of = totalSteps > 1 ? ` (OK ${step.step} of ${totalSteps})` : "";
  const roleNames = new Map(step.roles.map((r) => [ROLE_BUNDLES[r]?.name ?? r, SHORT[r] ?? r.replace(/_/g, " ")]));
  const who = await whoCanDo(ctx, permission, null).catch(() => ({ roles: [] as string[], people: [] as { name: string; role: string }[] }));
  const people = who.people.filter((p) => roleNames.has(p.role)).slice(0, 3);
  const verb = step.roles.includes("qa_qc") ? "to check it" : "to say OK";
  if (people.length) return `Waiting for ${people.map((p) => `${p.name} (${roleNames.get(p.role)})`).join(" or ")} ${verb}${of}.`;
  const words = [...roleNames.values()].join(" or ");
  return `Waiting for ${words ? `the ${words}` : "someone allowed to approve"} ${verb}${of}.`;
}
