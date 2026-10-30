import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome } from "@/modules/analytics";
import { floorTaskCounts, myFloorTasks } from "@/modules/production";
import { PageHeader } from "@/ui/core";
import { homeHref } from "../nav";
import { OperatorHome, TasksToday } from "./operator-home";
import { OwnerHomePage } from "./owner-home";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  // ADR-084: the production TV account (Floor display role only) has the floor screen as its home.
  if (homeHref(ctx.roleCodes) !== "/dashboard") redirect(homeHref(ctx.roleCodes));

  // Operators (no analytics.dashboard.view) get a task home instead of the analytics overview.
  if (!ctx.can("analytics.dashboard.view")) {
    // UX review "Your tasks today": one card per batch the operator can act on (with or without an order), then quick actions.
    const floor = ctx.can("production.batch.view") && (ctx.can("production.dispense_record.create") || ctx.can("production.daily_log.create"));
    const [tiles, tasks] = await Promise.all([getOperatorHome(ctx), floor ? myFloorTasks(ctx) : Promise.resolve([])]);
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · ${floor ? "Here is what to do next." : "What do you need to do?"}`} />
        {floor ? (
          <TasksToday tasks={tasks} counts={floorTaskCounts(tasks)} tiles={tiles} canDailyCount={ctx.can("production.daily_log.view")} />
        ) : (
          <OperatorHome tiles={tiles} siteLabel={ctx.currentSite.code} updated={fmtDateTime(new Date())} />
        )}
      </>
    );
  }

  // ADR-083: Home answers "what needs me, how are we doing, what is happening" — nothing else (mockup
  // panel 1; owner-home.tsx). The detailed overview is under Management → Reports & analytics.
  return <OwnerHomePage ctx={ctx} scope={sp.scope} />;
}
