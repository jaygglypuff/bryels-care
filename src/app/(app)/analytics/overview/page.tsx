import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getOwnerDashboard, getOwnerOverview } from "@/modules/analytics";
import { EmptyState, PageHeader } from "@/ui/core";
import { ScopePeriodBar } from "../kpi-ui";
import { OwnerOverview } from "../../dashboard/owner-overview";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business overview" };

/**
 * The detailed owner overview (ADR-083): every KPI card, the batch journey, near-expiry lots, order
 * fulfilment, exceptions and the site comparison. It moved here from Home, which now shows only what
 * needs attention and four headline numbers.
 */
export default async function BusinessOverviewPage({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.dashboard.view")) return <Forbidden what="the business overview" />;
  const sp = await searchParams;
  let kpi;
  try {
    kpi = await getOwnerOverview(ctx, { scope: sp.scope ?? null, period: sp.period ?? null });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "forbidden" || e.code === "not_found"))
      return (
        <>
          <PageHeader title="Business overview" />
          <EmptyState title={e.code === "forbidden" ? "You don't have access to the all-sites view" : "This site isn't available to you"} action={<Link href="/analytics/overview" className="font-medium text-primary-text hover:underline">Open your site&apos;s overview</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  const data = await getOwnerDashboard(ctx, { all: kpi.scope.all, siteIds: kpi.scope.siteIds, sites: kpi.scope.sites, label: kpi.scope.label });
  return (
    <>
      <PageHeader
        title="Business overview"
        subtitle={`${kpi.scope.label} · ${kpi.period.label} · every number opens the records behind it`}
        actions={<ScopePeriodBar basePath="/analytics/overview" scope={kpi.scope} period={kpi.period} sites={ctx.allowedSites} canAll={kpi.canCrossSite} />}
      />
      <OwnerOverview data={data} kpi={kpi} canAudit={ctx.can("platform.audit.view")} />
    </>
  );
}
