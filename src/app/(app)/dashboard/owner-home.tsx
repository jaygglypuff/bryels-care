import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getOperationsCenter, getOwnerHome } from "@/modules/analytics";
import { myApprovalCount } from "@/modules/action-centre";
import { EmptyState, PageHeader, cx } from "@/ui/core";
import { HomeCards, NeedsAttention, ProductionByStage, RecentActivity, SalesWeek, attentionItems } from "./simple-home";

/**
 * Owner / manager Home (ADR-083 §4, mockup panel 1 "Owner Dashboard"), in the mockup's order:
 * greeting; four cards (Sales today, Production progress, Stock alerts, Waiting for your approval);
 * Needs your attention (5 rows + See all); Sales this week; Production by stage; Recent activity.
 * Every number is computed on the server for the caller's sites (`getOwnerHome`) and opens the list it
 * was counted from. The detailed overview stays under Management → Reports & analytics.
 */
export async function OwnerHomePage({ ctx, scope }: { ctx: AuthContext; scope?: string }) {
  const all = scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  let home;
  try {
    home = await getOwnerHome(ctx, { all });
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
  const [oc, approvals] = await Promise.all([getOperationsCenter(ctx, { all }), myApprovalCount(ctx).catch(() => 0)]);
  const qs = all ? "?scope=all" : "";
  const stockHref = `/dashboard/details/stock${qs}`;
  const items = attentionItems(oc, approvals, home.stock, stockHref);
  const pill = (href: string, active: boolean, label: string) => (
    <Link key={label} href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium", active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2")}>
      {label}
    </Link>
  );
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = new Date(home.today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${ctx.displayName.split(" ")[0]}`}
        subtitle={`Here is what is happening in your business today · ${today} · ${all ? "All your sites" : ctx.currentSite.name}`}
        actions={
          ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view") ? (
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Sites">
              {pill("/dashboard", !all, "This site")}
              {pill("/dashboard?scope=all", all, "All my sites")}
            </div>
          ) : undefined
        }
      />
      <HomeCards home={home} approvals={approvals} stockHref={stockHref} batchesHref={`/dashboard/details/batches${qs}`} />
      <NeedsAttention items={items} />
      {(home.salesWeek || oc.stages.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          {home.salesWeek && <SalesWeek week={home.salesWeek} scopeLabel={home.scope.label} generatedAt={home.generatedAt} />}
          <ProductionByStage oc={oc} all={all} />
        </div>
      )}
      {home.activity && <RecentActivity rows={home.activity} showSite={all} />}
      <p className="text-[14px] text-fg-2">
        More numbers and charts:{" "}
        <Link href={all ? "/analytics/overview?scope=all" : "/analytics/overview"} className="font-medium text-primary-text underline">
          Business overview
        </Link>
      </p>
    </div>
  );
}
