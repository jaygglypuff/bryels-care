import { getContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { EmptyState, LinkButton } from "@/ui/core";
import { PERMISSIONS } from "@/lib/permissions";
import { doingPermission, forbiddenAskLine } from "./forbidden-words";

/**
 * "You don't have access" (UX audit B #8, round 2 part 2). With `permission` the message names the colleagues
 * who can do it at this site (who-can-do directory, ADR-073), so a site manager is never told to "ask your site
 * manager". Without it, the fallback still depends on who is asking. Access itself is decided by the page and the
 * service; this only says whom to ask. The people named are those who can DO the work (`doingPermission`: a
 * `.view` permission is read as the entity's create/post/approve), never people who may only look.
 */
export async function Forbidden({ what = "this page", permission, siteId }: { what?: string; permission?: string; siteId?: string | null }) {
  const ctx = await getContext();
  const people = ctx && permission ? (await whoCanDo(ctx, doingPermission(permission, PERMISSIONS), siteId ?? null).catch(() => ({ roles: [], people: [] }))).people : [];
  return (
    <EmptyState title="You don't have access" action={<LinkButton href="/dashboard" variant="secondary">Back to overview</LinkButton>}>
      Your role does not include access to {what}. {forbiddenAskLine(ctx?.roleCodes ?? [], people)}
    </EmptyState>
  );
}
