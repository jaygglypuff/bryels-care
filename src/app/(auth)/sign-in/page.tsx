import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { DEMO_PASSWORD } from "@/lib/demo";
import { listDemoAccounts } from "@/modules/identity";
import { AuthFrame } from "../frame";
import { DemoPanel } from "./demo-panel";
import { SignInForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  password_set: "Your password is set. Sign in to continue.",
  password_reset: "Your password was changed and every device was signed out. Sign in with the new password.",
  signed_out: "You were signed out.",
  demo_reset: "The demo data was reset to a fresh copy and everyone was signed out. Pick an account below to continue.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (await getContext()) redirect("/dashboard");
  const notice = NOTICES[(await searchParams).notice ?? ""] ?? null;
  // Demo mode only (ADR-044): null when off, so no demo panel and no demo query exist outside the demo.
  const demoGroups = await listDemoAccounts();
  return (
    <AuthFrame below={demoGroups && <DemoPanel groups={demoGroups} password={DEMO_PASSWORD} />}>
      <SignInForm notice={notice} />
    </AuthFrame>
  );
}
