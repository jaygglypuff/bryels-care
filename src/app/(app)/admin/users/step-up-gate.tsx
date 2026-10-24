import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { stepUpStatus } from "@/modules/identity";
import { Banner } from "@/ui/status";
import { ReauthCard } from "../../account/reauth";

/**
 * Above restricted admin forms: nothing when step-up will pass, the "Confirm it's you" card when the
 * re-authentication window has lapsed, an enrolment banner when TOTP is overdue. The services enforce
 * the same rules; this only tells the person what to do first.
 */
export async function StepUpGate({ ctx, purpose }: { ctx: AuthContext; purpose: string }) {
  const s = await stepUpStatus(ctx);
  if (s.ready) return null;
  if (s.mfa.overdue)
    return (
      <div className="mb-4">
        <Banner tone="bad" title="Two-step sign-in required" action={<Link href="/account" className="text-[13px] font-semibold underline">Set it up</Link>}>
          Your role requires two-step sign-in before you can {purpose}.
        </Banner>
      </div>
    );
  return (
    <div className="mb-4">
      <ReauthCard purpose={purpose} needsCode={s.needsCode} />
    </div>
  );
}
