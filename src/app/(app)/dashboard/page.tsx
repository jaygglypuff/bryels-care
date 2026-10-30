import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getOperationsCenter, getOperatorHome, getOwnerOverview } from "@/modules/analytics";
import { myApprovalCount } from "@/modules/action-centre";
import { floorTaskCounts, myFloorTasks } from "@/modules/production";
import { lowStockItems } from "@/modules/inventory";
import { EmptyState, PageHeader, cx } from "@/ui/core";
import { OperatorHome, TasksToday } from "./operator-home";
import { HeadlineNumbers, NeedsAttention, RightNow, attentionItems } from "./simple-home";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ scope?: string; period?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;

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

  // ADR-083: Home answers "what needs me, how are we doing, what is happening" — nothing else. The
  // detailed overview moved to Management → Reports & analytics → Business overview.
  const all = sp.scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  const period = sp.period === "today" || sp.period === "month" ? sp.period : "week";
  let kpi;
  try {
    kpi = await getOwnerOverview(ctx, { scope: all ? "all" : ctx.currentSiteId, period });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "forbidden" || e.code === "not_found"))
      return (
        <>
          <PageHeader title="Home" />
          <EmptyState title="This view isn't available to you" action={<Link href="/dashboard" className="font-medium text-primary-text hover:underline">Open your site&apos;s home</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  const [oc, approvals, low] = await Promise.all([
    getOperationsCenter(ctx, { all }),
    myApprovalCount(ctx).catch(() => 0),
    ctx.can("inventory.balance.view") ? lowStockItems(ctx, { siteIds: all ? ctx.allowedSiteIds : [ctx.currentSiteId] }).catch(() => null) : Promise.resolve(null),
  ]);
  const items = attentionItems(oc, approvals, low ? low.length : null);
  const q = (over: Record<string, string>) => {
    const u = new URLSearchParams({ ...(all ? { scope: "all" } : {}), ...(period !== "week" ? { period } : {}), ...over });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    const str = u.toString();
    return str ? `/dashboard?${str}` : "/dashboard";
  };
  const pill = (href: string, active: boolean, label: string) => (
    <Link key={label} href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium", active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2")}>
      {label}
    </Link>
  );
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${ctx.displayName.split(" ")[0]}`}
        subtitle={`${all ? "All your sites" : `${ctx.currentSite.name}`} · here is what needs you and how things are going`}
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Period">
              {pill(q({ period: "today" }), period === "today", "Today")}
              {pill(q({ period: "" }), period === "week", "This week")}
              {pill(q({ period: "month" }), period === "month", "This month")}
            </div>
            {ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view") && (
              <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Sites">
                {pill(q({ scope: "" }), !all, "This site")}
                {pill(q({ scope: "all" }), all, "All my sites")}
              </div>
            )}
          </div>
        }
      />
      <NeedsAttention items={items} />
      <HeadlineNumbers kpi={kpi} />
      <RightNow oc={oc} all={all} />
      <p className="text-[14px] text-fg-2">
        More numbers and charts:{" "}
        <Link href={all ? "/analytics/overview?scope=all" : "/analytics/overview"} className="font-medium text-primary-text underline">
          Business overview
        </Link>
      </p>
    </div>
  );
}
