import { getContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { FALLBACK_HREF, notificationHref } from "@/lib/record-links";
import { markNotificationRead } from "@/modules/platform";

export const dynamic = "force-dynamic";

/** Same-site relative redirect (the public origin behind the proxy is not always req.url's). */
const go = (href: string) => new Response(null, { status: 303, headers: { Location: href, "Cache-Control": "private, no-store" } });

/**
 * Tapping a notification (ADR-075): marks it read (the signed-in user's own only) and opens the
 * record it is about (src/lib/record-links.ts). Linked with a plain <a>, never prefetched. Someone
 * else's or an unknown notification opens the action centre.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return go("/sign-in");
  const { id } = await params;
  let href = FALLBACK_HREF;
  try {
    const n = await markNotificationRead(ctx, id);
    href = notificationHref(n);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
  }
  return go(href);
}
