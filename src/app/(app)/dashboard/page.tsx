import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome, getOwnerDashboard, getOwnerOverview } from "@/modules/analytics";
import { EmptyState, PageHeader } from "@/ui/core";
import { ScopePeriodBar } from "../analytics/kpi-ui";
import { OperatorHome } from "./operator-home";
import { OwnerOverview } from "./owner-overview";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
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

  let kpi;
  try {
    kpi = await getOwnerOverview(ctx, { scope: sp.scope ?? null, period: sp.period ?? null });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "forbidden" || e.code === "not_found"))
      return (
        <>
          <PageHeader title="Overview" />
          <EmptyState title={e.code === "forbidden" ? "You don't have access to the all-sites view" : "This site isn't available to you"} action={<Link href="/dashboard" className="font-medium text-primary-text hover:underline">Open your site&apos;s overview</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  // The Batch journey board, near-expiry lots and activity come from the live operational read model, in the same scope.
  const data = await getOwnerDashboard(ctx, { all: kpi.scope.all, siteIds: kpi.scope.siteIds, sites: kpi.scope.sites, label: kpi.scope.label });

  return (
    <>
      <PageHeader
        title={ctx.roleCodes.includes("owner_director") ? "Owner overview" : "Overview"}
        subtitle={`${kpi.scope.label} · ${kpi.period.label} · every number opens the records behind it`}
        actions={<ScopePeriodBar basePath="/dashboard" scope={kpi.scope} period={kpi.period} sites={ctx.allowedSites} canAll={kpi.canCrossSite} />}
      />
      <OwnerOverview data={data} kpi={kpi} canAudit={ctx.can("platform.audit.view")} />
    </>
  );
}
