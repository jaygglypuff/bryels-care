import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { isDemoMode } from "@/lib/demo";
import { requirePortalContext } from "@/modules/portal";
import { Logo } from "@/ui/brand";
import { DemoBanner } from "@/ui/demo-banner";
import { NavigationProgress } from "@/ui/navigation-progress";
import { portalSignOut } from "../actions";
import { PortalNav } from "./portal-nav";

export const dynamic = "force-dynamic";

/**
 * Signed-in customer portal shell (US-8-01, docs/ux-system.md brand look): the customer's name, four
 * navigation pills, account and sign-out. Built from the PortalAuthContext only — no staff navigation,
 * no site switcher, nothing internal. Signed-out visitors are sent to /portal/sign-in.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortalContext();
  return (
    <div className="min-h-dvh bg-bg">
      <NavigationProgress />
      {isDemoMode() && <DemoBanner canReset={false} />}
      <header className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-3" aria-label="Customer portal home">
            <Logo className="h-9 w-auto shrink-0" />
            <span className="hidden rounded-full bg-[var(--lime-100)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-800)] sm:inline">Customer portal</span>
          </Link>
          <div className="flex min-w-0 items-center gap-1.5">
            <Link href="/portal/account" className="flex min-h-[40px] min-w-0 items-center gap-2 rounded-full px-3 text-[13px] text-fg-2 hover:bg-surface-2" aria-label={`Your account: ${ctx.displayName}, ${ctx.customerName}`}>
              <UserRound size={16} aria-hidden="true" className="shrink-0" />
              <span className="hidden min-w-0 flex-col leading-tight sm:flex">
                <span className="truncate font-medium text-fg">{ctx.displayName}</span>
                <span className="truncate text-[11.5px] text-muted">{ctx.customerName}</span>
              </span>
            </Link>
            <form action={portalSignOut}>
              <button type="submit" className="flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-fg-2 hover:bg-surface-2" aria-label="Sign out of the customer portal">
                <LogOut size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-[1100px] px-4 pb-3 sm:px-6">
          <p className="mb-2 truncate text-[12px] text-muted sm:hidden">
            {ctx.displayName} · {ctx.customerName}
          </p>
          <PortalNav canCatalog={ctx.can("portal.catalog.view")} />
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      <footer className="no-print mx-auto max-w-[1100px] px-4 pb-8 text-[11.5px] text-muted sm:px-6">Bryel&apos;s Care customer portal · questions about an order? Contact your sales representative.</footer>
    </div>
  );
}
