"use client";
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import type { DemoAccountGroup } from "@/modules/identity/demo";
import type { PortalDemoAccount } from "@/modules/portal/demo";
import { signInAsDemo } from "./actions";

/**
 * "Try the demo" (ADR-055): rendered by the sign-in page only in demo mode. A switch reveals the
 * fictional accounts grouped by role, each with a one-click "Sign in as …" (server action
 * `signInAsDemo`, which checks demo mode and the demo address again).
 */
export function DemoPanel({
  groups,
  sandboxGroups = [],
  password,
  portalAccounts = [],
}: {
  groups: DemoAccountGroup[];
  sandboxGroups?: DemoAccountGroup[];
  password: string;
  portalAccounts?: PortalDemoAccount[];
}) {
  const [open, setOpen] = useState(false);
  // ADR-072: "Sample company" (full fictional data) or "Start from scratch" (the empty sandbox company).
  const [view, setView] = useState<"demo" | "sandbox">("demo");
  const [state, action] = useActionState(signInAsDemo, null);
  const id = useId();
  const shown = view === "sandbox" ? sandboxGroups : groups;
  const count = shown.reduce((n, g) => n + g.accounts.length, 0);
  return (
    <section aria-labelledby={`${id}-title`} className="mt-5 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold text-fg">
            Try the demo
          </h2>
          <p className="text-[12px] text-muted">Fictional company and data. Nothing here is real.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-controls={`${id}-list`}
          aria-label="Try the demo"
          onClick={() => setOpen((v) => !v)}
          className={cx("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", open ? "bg-[var(--brand-600)]" : "bg-[var(--border-strong)]")}
        >
          <span className={cx("inline-block size-5 rounded-full bg-white shadow transition-transform", open ? "translate-x-6" : "translate-x-1")} />
        </button>
      </div>
      {open && (
        <div id={`${id}-list`} className="mt-4">
          {sandboxGroups.length > 0 && (
            <div role="tablist" aria-label="Which company" className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
              {(
                [
                  ["demo", "Sample company"],
                  ["sandbox", "Start from scratch"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cx("min-h-[34px] rounded-full px-3 text-[13px] font-semibold transition-colors", view === v ? "bg-[var(--brand-600)] text-white" : "text-muted hover:text-fg")}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="mb-3 rounded-[12px] bg-[var(--lime-100)] px-3 py-2 text-[12.5px] text-[var(--brand-800)]">
            {view === "sandbox" ? (
              <>
                An <span className="font-semibold">empty practice company</span>: no materials, products, customers or stock. Build everything yourself, step by
                step, with <span className="font-semibold">Help &amp; guides → Getting started</span> (start as Sandbox Owner). Every account uses the password{" "}
              </>
            ) : (
              <>A fictional company already full of sample data. Pick a role to see the system through that person&apos;s eyes. Every demo account uses the password </>
            )}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px]">{password}</code>.
          </p>
          <FormMessage state={state} />
          {count === 0 ? (
            <p className="text-[13px] text-muted">The demo data is still loading or was cleared. Wait a minute and reload this page.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map((g) => (
                <div key={g.roleCode} role="group" aria-label={g.roleName}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.roleName}</p>
                  <ul className="flex flex-col gap-1.5">
                    {g.accounts.map((a) => (
                      <li key={a.email}>
                        {/* One form per account, so only the pressed button shows its pending text. */}
                        <form action={action}>
                          <input type="hidden" name="email" value={a.email} />
                          <SubmitButton
                            variant="secondary"
                            size="sm"
                            pendingText={`Signing in as ${a.displayName}…`}
                            className="w-full justify-between text-left"
                            aria-label={`Sign in as ${a.displayName}, ${a.roles.join(" and ")}`}
                          >
                            <span className="min-w-0 truncate">
                              Sign in as <span className="font-semibold">{a.displayName}</span>
                            </span>
                            <span className="shrink-0 text-[11.5px] text-muted">{a.scope}</span>
                          </SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* W4E: customers sign in on the separate customer portal, never here. */}
              {view === "demo" && portalAccounts.length > 0 && (
                <div role="group" aria-label="Customer portal">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Customer portal</p>
                  <ul className="flex flex-col gap-1.5">
                    {portalAccounts.map((a) => (
                      <li key={a.email}>
                        <Link
                          href={`/portal/sign-in?email=${encodeURIComponent(a.email)}`}
                          className="flex min-h-[34px] w-full items-center justify-between gap-2 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-fg hover:border-line-strong hover:bg-surface-2"
                          aria-label={`Open the customer portal sign-in as ${a.displayName}, ${a.roleName} at ${a.customerName}`}
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">{a.displayName}</span> · {a.customerName}
                          </span>
                          <span className="shrink-0 text-[11.5px] text-muted">{a.roleName} →</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
