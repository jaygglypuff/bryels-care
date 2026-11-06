import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { getOperatorHome, getPlannerNext, getWorkFlowCounts } from "@/modules/analytics";
import { floorTaskCounts, myFloorTasks } from "@/modules/production";
import { PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { homeIntro } from "@/ui/role-names";
import { homeHref } from "../nav";
import { OperatorHome, TasksToday } from "./operator-home";
import { OwnerHomePage } from "./owner-home";
import { PROCUREMENT_LINES, WAREHOUSE_LINES, WorkList } from "./work-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

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
    // ADR-110 C11/C13: buyers and the warehouse get their work list on Home (the "How work flows" counts).
    const buyer = ctx.can("procurement.purchase_order.create");
    const warehouse = ctx.can("inventory.movement.post") && ctx.can("sales.pick.view");
    const [tiles, tasks, plan, buying, dispatch] = await Promise.all([
      getOperatorHome(ctx),
      floor ? myFloorTasks(ctx) : Promise.resolve([]),
      planner ? getPlannerNext(ctx) : Promise.resolve(null),
      buyer ? getWorkFlowCounts(ctx, PROCUREMENT_LINES.map((l) => l.key)) : Promise.resolve([]),
      warehouse ? getWorkFlowCounts(ctx, WAREHOUSE_LINES.map((l) => l.key)) : Promise.resolve([]),
    ]);
    return (
      <>
        <PageHeader title={`Good day, ${ctx.displayName.split(" ")[0]}`} subtitle={ctx.currentSite.name} />
        <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
        {plan && <PlannerNext plan={plan} canApprove={ctx.can("production.work_order.approve")} />}
        {buyer && <BuyerNext counts={buying} />}
        {buyer && <WorkList title="Your buying work" lines={PROCUREMENT_LINES} counts={buying} testId="procurement-work" />}
        {warehouse && <WorkList title="Orders to send out" lines={WAREHOUSE_LINES} counts={dispatch} testId="warehouse-work" />}
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

/** ADR-110 C11: the buyer's one next step — approved requests to order first, then orders to send, else ask to buy. */
function BuyerNext({ counts }: { counts: { key: string; count: number }[] }) {
  const n = (k: string) => counts.find((c) => c.key === k)?.count ?? 0;
  if (n("pr_to_order") > 0)
    return <NextStep text={`Next: ${n("pr_to_order") === 1 ? "1 approved request waits" : `${n("pr_to_order")} approved requests wait`} to be ordered from the supplier.`} action={{ label: "Make the purchase orders", href: "/procurement/requests?status=approved" }} />;
  if (n("po_to_send") > 0)
    return <NextStep text={`Next: ${n("po_to_send") === 1 ? "1 purchase order is" : `${n("po_to_send")} purchase orders are`} approved. Send ${n("po_to_send") === 1 ? "it" : "them"} to the supplier.`} action={{ label: "Send them", href: "/procurement/orders?status=approved" }} />;
  return <NextStep text="Nothing waits for you. Ask to buy something when stock runs low." action={{ label: "Ask to buy something", href: "/procurement/requests/new" }} />;
}
