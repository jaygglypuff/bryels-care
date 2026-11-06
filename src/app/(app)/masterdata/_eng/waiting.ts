import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { nextActors } from "@/modules/governance";

/**
 * "Waiting for Ana Cruz (QA) to check it." for a version waiting at an approval step (ADR-088 NextStep, ADR-109):
 * the people `nextActors` lists for the step's permission and roles, without the creator and submitter (`who.exclude`)
 * and without anyone who decided an earlier step (`who.prior`). A step that names QA keeps the independent second
 * person; other steps follow ADR-091 (a top role may approve their own version). Step roles stay as configured (no
 * owner stand-in), as `canDecideStep` does. Falls back to the role words when no colleague is found.
 */
export async function waitingForApprover(
  ctx: AuthContext,
  permission: string,
  step: { step: number; label: string; roles: string[] } | null | undefined,
  totalSteps: number,
  who: { exclude?: readonly (string | null | undefined)[]; prior?: readonly (string | null | undefined)[]; siteId?: string | null } = {},
): Promise<string> {
  if (!step) return "Waiting for approval.";
  const of = totalSteps > 1 ? ` (OK ${step.step} of ${totalSteps})` : "";
  const verb = step.roles.includes("qa_qc") ? "to check it" : "to say OK";
  const qa = step.roles.includes("qa_qc");
  const next = await nextActors(
    ctx,
    { kind: `revision.${permission}`, permission: permission as Permission, does: verb, doBase: verb, where: TO_APPROVE, fallback: "the approvers", independent: qa, operational: !qa, prefer: ["qa_qc", "site_manager", "owner_director"] },
    { siteId: who.siteId ?? null, roleCodes: step.roles, excludeUserIds: who.exclude, priorApproverIds: who.prior, roleStandIn: false },
  ).catch(() => null);
  const people = (next?.people ?? []).slice(0, 3);
  if (people.length) return `Waiting for ${people.map((p) => `${p.name} (${p.role})`).join(" or ")} ${verb}${of}.`;
  const words = next?.roleWords && next.roleWords !== "the approvers" ? next.roleWords : "someone allowed to approve";
  return `Waiting for ${words} ${verb}${of}.`;
}

const TO_APPROVE = "in To approve";
