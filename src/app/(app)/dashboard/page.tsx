import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getOperationsCenter, getOperatorHome, getOwnerDashboard, getOwnerOverview } from "@/modules/analytics";
import { listProductionOrders } from "@/modules/production";
import { EmptyState, PageHeader } from "@/ui/core";
import { PipelineStrip } from "@/ui/pipeline";
import { ScopePeriodBar } from "../analytics/kpi-ui";
import { NextTaskCard, OperatorHome } from "./operator-home";
import { OwnerOverview } from "./owner-overview";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;

  // Operators (no analytics.dashboard.view) get a task home instead of the analytics overview.
  if (!ctx.can("analytics.dashboard.view")) {
    // ADR-082: the operator's next task first — their own order (else one nobody took) that has a step to do.
    const [tiles, orders] = await Promise.all([
      getOperatorHome(ctx),
      ctx.can("production.work_order.view") && ctx.can("production.daily_log.create") ? listProductionOrders(ctx, { mine: true }) : Promise.resolve([]),
    ]);
    const next = orders.find((o) => o.nextAction.kind === "link") ?? null;
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · What do you need to do?`} />
        {next && <NextTaskCard order={next} more={orders.filter((o) => o.assignedToMe).length} />}
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
  const [data, pipeline] = await Promise.all([
    getOwnerDashboard(ctx, { all: kpi.scope.all, siteIds: kpi.scope.siteIds, sites: kpi.scope.sites, label: kpi.scope.label }),
    // ADR-081: "what is happening right now" first — the live pipeline, same scope as the figures below.
    getOperationsCenter(ctx, { all: kpi.scope.all }),
  ]);

  return (
    <>
      <PageHeader
        title={ctx.roleCodes.includes("owner_director") ? "Owner overview" : "Overview"}
        subtitle={`${kpi.scope.label} · ${kpi.period.label} · every number opens the records behind it`}
        actions={<ScopePeriodBar basePath="/dashboard" scope={kpi.scope} period={kpi.period} sites={ctx.allowedSites} canAll={kpi.canCrossSite} />}
      />
      {pipeline.stages.length > 0 && (
        <section aria-labelledby="now-h" className="mb-6 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="now-h" className="font-display text-[18px] font-semibold">Right now</h2>
            <Link href={kpi.scope.all ? "/operations?scope=all" : "/operations"} className="text-[13px] font-medium text-primary-text hover:underline">Open the Operations Center</Link>
          </div>
          <PipelineStrip stages={pipeline.stages} compact />
        </section>
      )}
      <OwnerOverview data={data} kpi={kpi} canAudit={ctx.can("platform.audit.view")} />
    </>
  );
}
