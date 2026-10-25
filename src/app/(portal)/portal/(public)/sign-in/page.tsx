import { redirect } from "next/navigation";
import { DEMO_PASSWORD } from "@/lib/demo";
import { getPortalContext, listPortalDemoAccounts } from "@/modules/portal";
import { PortalFrame } from "../../frame";
import { PortalDemoList } from "./demo-list";
import { PortalSignInForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer portal sign-in" };

const NOTICES: Record<string, string> = {
  password_set: "Your password is set. Sign in to continue.",
  signed_out: "You were signed out of the customer portal.",
  expired: "Your portal session ended. Sign in again.",
};

/** Portal sign-in (US-8-01): separate from the staff sign-in; demo accounts only in demo mode. */
export default async function PortalSignInPage({ searchParams }: { searchParams: Promise<{ notice?: string; email?: string }> }) {
  if (await getPortalContext()) redirect("/portal");
  const sp = await searchParams;
  const notice = NOTICES[sp.notice ?? ""] ?? null;
  const email = typeof sp.email === "string" && /^[^\s@]{1,80}@[^\s@]{1,120}$/.test(sp.email) ? sp.email : null;
  const demo = await listPortalDemoAccounts();
  return (
    <PortalFrame below={demo && <PortalDemoList accounts={demo} password={DEMO_PASSWORD} highlight={email} />}>
      <PortalSignInForm notice={notice} email={email} />
    </PortalFrame>
  );
}
