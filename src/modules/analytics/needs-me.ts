import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import { listMyApprovals } from "@/modules/action-centre";
import { openActionMessages } from "@/modules/platform";
import { checksWaitingForMe, type CheckItem } from "./my-checks";
import { countNeedsMe, type NeedsMeCount } from "./needs-me-count";

export type NeedsMe = NeedsMeCount & {
  checkItems: CheckItem[];
  /** Where a tap on the number goes: approvals first, then the first check, then the messages. */
  href: string;
};

/**
 * The one source of "Needs me" (ADR-132 §1): the menu badge and Home's "Needs you" card both call this. Everything is
 * the signed-in person's own data at their current site: their approvals (`listMyApprovals`, which the decide services
 * check again), the checks they may sign (`checksWaitingForMe`) and their own messages. `checks: false` for the owner
 * (not a floor checker, B report #9) and the sales desk. A part that fails counts as zero; the frame must still load.
 */
export async function needsMeSummary(ctx: AuthContext, opts: { checks?: boolean } = {}): Promise<NeedsMe> {
  const [approvals, checkItems, messages] = await Promise.all([
    listMyApprovals(ctx).catch(() => []),
    opts.checks === false ? Promise.resolve([] as CheckItem[]) : checksWaitingForMe(ctx).catch(() => [] as CheckItem[]),
    openActionMessages(ctx).catch(() => []),
  ]);
  const n = countNeedsMe({ approvals, checks: checkItems, messages });
  const href = n.approvals > 0 ? "/approvals" : n.checks > 0 ? checkItems[0].href : n.messages > 0 ? "/notifications" : "/approvals";
  return { ...n, checkItems, href };
}
