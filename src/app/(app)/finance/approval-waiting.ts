import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { waitingLine } from "../waiting-words";
import { roleWords } from "./finance-ui";

type Progress = { steps: { step: number }[]; next: { step: number; label: string; roleCodes: string[] } | null } | null | undefined;

/**
 * "Waiting for Rosa Lim (Finance) to approve (step 1 of 2)." on finance documents (UX audit C #10): the colleagues
 * who hold the approve right and one of the next step's roles, by name; else the role words as before. The
 * approval rules (poster ≠ approver, own claims) stay in the finance service.
 */
export async function approvalWaiting(ctx: AuthContext, permission: string, progress: Progress): Promise<string> {
  const n = progress?.next;
  if (!n) return "Waiting for approval.";
  const of = progress!.steps.length > 1 ? ` (step ${n.step} of ${progress!.steps.length})` : "";
  const names = new Set(n.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r));
  const who = await whoCanDo(ctx, permission, null).catch(() => ({ roles: [] as string[], people: [] as { name: string; role: string }[] }));
  const people = n.roleCodes.length ? who.people.filter((p) => names.has(p.role)) : who.people;
  return waitingLine(people, `to approve${of}`, n.roleCodes.length ? roleWords(n.roleCodes) : n.label).replace(/ Nobody at this site.*$/, "");
}
