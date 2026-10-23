import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome, getOwnerDashboard, resolveScope } from "@/modules/analytics";
import { PageHeader, cx } from "@/ui/core";
import { OperatorHome } from "./operator-home";
import { OwnerOverview } from "./owner-overview";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;

  // Operators (no analytics.dashboard.view) get a task home instead of the analytics overview.
  if (!ctx.can("analytics.dashboard.view")) {
    const tiles = await getOperatorHome(ctx);
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · What do you need to do?`} />
        <OperatorHome tiles={tiles} siteLabel={ctx.currentSite.code} updated={fmtDateTime(new Date())} />
      </>
    );
  }

  const scope = resolveScope(ctx, sp.scope === "all");
  const data = await getOwnerDashboard(ctx, scope);
  const multi = ctx.allowedSites.length > 1;

  return (
    <>
      <PageHeader
        title={ctx.roleCodes.includes("owner_director") ? "Owner overview" : "Overview"}
        subtitle={`${scope.label} · every number links to the list behind it`}
        actions={
          multi && (
            <nav aria-label="Dashboard scope" className="inline-flex rounded-full border border-line-strong bg-surface p-0.5">
              <ScopeLink href="/dashboard" active={!scope.all}>
                {ctx.currentSite.code} only
              </ScopeLink>
              <ScopeLink href="/dashboard?scope=all" active={scope.all}>
                All my sites
              </ScopeLink>
            </nav>
          )
        }
      />
      <OwnerOverview data={data} canAudit={ctx.can("platform.audit.view")} />
    </>
  );
}

function ScopeLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx("inline-flex min-h-[40px] items-center rounded-full px-3.5 text-[13px] font-medium", active ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}
    >
      {children}
    </Link>
  );
}
