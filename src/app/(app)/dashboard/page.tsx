import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome, getPlannerNext } from "@/modules/analytics";
import { floorTaskCounts, myFloorTasks } from "@/modules/production";
import { PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { homeIntro } from "@/ui/role-names";
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
    const planner = ctx.can("production.work_order.create");
    const [tiles, tasks, plan] = await Promise.all([getOperatorHome(ctx), floor ? myFloorTasks(ctx) : Promise.resolve([]), planner ? getPlannerNext(ctx) : Promise.resolve(null)]);
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={ctx.currentSite.name} />
        <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
        {plan && <PlannerNext plan={plan} canApprove={ctx.can("production.work_order.approve")} />}
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

/** The planner's one next step (UX audit 2026-10-31): orders waiting for approval, else approved orders not started, else make a new one. */
function PlannerNext({ plan, canApprove }: { plan: { toApprove: number; approvedNotStarted: number }; canApprove: boolean }) {
  const orders = (n: number) => `${n} production order${n === 1 ? "" : "s"}`;
  if (plan.toApprove > 0)
    return canApprove ? (
      <NextStep text={`Next: ${orders(plan.toApprove)} wait for approval.`} action={{ label: "Open To approve", href: "/approvals" }} />
    ) : (
      <NextStep text={`${orders(plan.toApprove)} wait for approval.`} action={{ label: "See the orders", href: "/production/orders" }} waitingFor="Waiting for the site manager or the owner to approve." />
    );
  if (plan.approvedNotStarted > 0) return <NextStep text={`Next: ${orders(plan.approvedNotStarted)} are approved but not started. Check that materials are ready.`} action={{ label: "See the orders", href: "/production/orders" }} />;
  return <NextStep text="Nothing waits for you. Plan the next production order when stock runs low." action={{ label: "New production order", href: "/production/orders/new" }} />;
}
