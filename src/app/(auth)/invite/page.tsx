import { acceptInvite, checkInvitation } from "../account-actions";
import { AuthFrame } from "../frame";
import { TokenPasswordForm } from "../token-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation", referrer: "no-referrer" };

export default function InvitePage() {
  return (
    <AuthFrame>
      <TokenPasswordForm mode="invite" check={checkInvitation} submit={acceptInvite} />
    </AuthFrame>
  );
}
