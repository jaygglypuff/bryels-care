"use client";
import { useActionState } from "react";
import type { PortalDemoAccount } from "@/modules/portal";
import { FormMessage, SubmitButton } from "@/ui/form";
import { portalDemoSignIn } from "../../actions";

/**
 * "Try the demo" on the portal sign-in page (demo mode only, ADR-055): the fictional customer
 * accounts with a one-click sign-in. The server action checks demo mode and the demo address again.
 */
export function PortalDemoList({ accounts, password, highlight }: { accounts: PortalDemoAccount[]; password: string; highlight?: string | null }) {
  const [state, action] = useActionState(portalDemoSignIn, null);
  return (
    <section aria-labelledby="portal-demo-title" className="mt-5 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-card)]">
      <h2 id="portal-demo-title" className="text-[15px] font-semibold text-fg">
        Try the demo
      </h2>
      <p className="mb-3 text-[12px] text-muted">
        Fictional customers and data. Every demo account uses the password <code className="rounded bg-[var(--lime-100)] px-1.5 py-0.5 font-mono text-[12px]">{password}</code>.
      </p>
      <FormMessage state={state} />
      {accounts.length === 0 ? (
        <p className="text-[13px] text-muted">The demo data is still loading or was cleared. Wait a minute and reload this page.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {accounts.map((a) => (
            <li key={a.email}>
              <form action={action}>
                <input type="hidden" name="email" value={a.email} />
                <SubmitButton
                  variant={highlight && highlight.toLowerCase() === a.email.toLowerCase() ? "primary" : "secondary"}
                  size="sm"
                  pendingText={`Signing in as ${a.displayName}…`}
                  className="w-full justify-between text-left"
                  aria-label={`Sign in to the portal as ${a.displayName}, ${a.roleName} at ${a.customerName}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{a.displayName}</span> · {a.customerName}
                  </span>
                  <span className="shrink-0 text-[11.5px] opacity-80">{a.roleName}</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
