import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { AuthFrame } from "../frame";
import { SignInForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const DEMO = ["owner", "manager.nfd", "operator.nfd", "checker.nfd", "warehouse.nfd", "qa.nfd", "sales", "warehouse.rvs"];

const NOTICES: Record<string, string> = {
  password_set: "Your password is set. Sign in to continue.",
  password_reset: "Your password was changed and every device was signed out. Sign in with the new password.",
  signed_out: "You were signed out.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (await getContext()) redirect("/dashboard");
  const notice = NOTICES[(await searchParams).notice ?? ""] ?? null;
  return (
    <AuthFrame
      below={
        process.env.ALLOW_DEMO_SEED === "true" && (
          <div className="mt-5 rounded-[20px] bg-surface p-5 text-[12px] text-fg-2 shadow-[var(--shadow-card)]">
            <p className="mb-2 font-semibold text-fg">
              Demo accounts · fictional data · password <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">demo1234</code>
            </p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {DEMO.map((u) => (
                <li key={u} className="font-mono text-[11.5px]">{u}@bryels-care.test</li>
              ))}
            </ul>
          </div>
        )
      }
    >
      <SignInForm notice={notice} />
    </AuthFrame>
  );
}
