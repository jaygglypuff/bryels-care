import { checkReset, completeReset } from "../account-actions";
import { AuthFrame } from "../frame";
import { TokenPasswordForm } from "../token-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return (
    <AuthFrame>
      <TokenPasswordForm mode="reset" check={checkReset} submit={completeReset} />
    </AuthFrame>
  );
}
