import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome } from "@/modules/analytics";
import { listProductionOrders } from "@/modules/production";
import { PageHeader } from "@/ui/core";
import { NextTaskCard, OperatorHome } from "./operator-home";
import { OwnerHomePage } from "./owner-home";

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

  // ADR-083: Home answers "what needs me, how are we doing, what is happening" — nothing else (mockup
  // panel 1; owner-home.tsx). The detailed overview is under Management → Reports & analytics.
  return <OwnerHomePage ctx={ctx} scope={sp.scope} />;
}
