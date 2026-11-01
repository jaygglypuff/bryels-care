import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { waitingLine } from "./waiting-words";

/**
 * "Waiting for Rosa Lim (Purchasing) to send it for approval." (ADR-088 NextStep, UX audit round 2 part 2): the
 * active colleagues who hold `permission` at the record's site (who-can-do directory, ADR-073; same organization,
 * the viewer left out). Falls back to the role words when nobody holds it. Who may act is still decided by the
 * service; this only says whom we wait for.
 */
export async function waitingFor(ctx: AuthContext, permission: string, siteId: string | null, verb: string, fallbackRole: string): Promise<string> {
  const who = await whoCanDo(ctx, permission, siteId).catch(() => ({ roles: [] as string[], people: [] as { name: string; role: string }[] }));
  return waitingLine(who.people, verb, fallbackRole);
}
