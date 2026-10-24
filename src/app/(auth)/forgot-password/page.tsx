import { emailSetupStatus } from "@/lib/email";
import { AuthFrame } from "../frame";
import { ForgotForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  const email = emailSetupStatus();
  return (
    <AuthFrame>
      <ForgotForm emailReady={email.ready} />
    </AuthFrame>
  );
}
