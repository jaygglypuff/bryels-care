import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getOperationsCenter, getOwnerHome, getWorkFlowCounts } from "@/modules/analytics";
import { myApprovalCount } from "@/modules/action-centre";
import { notInvoicedShipments } from "@/modules/finance";
import { orderCounts } from "@/modules/sales";
import { EmptyState, PageHeader, cx } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { homeIntro } from "@/ui/role-names";
import { HomeCards, NeedsAttention, ProductionByStage, RecentActivity, SalesWeek, attentionItems } from "./simple-home";
import { firstActionable, salesItems } from "./home-next";

/** The one button of the "What to do next" line, by the attention item it comes from. */
const NEXT_LABEL: Record<string, string> = {
  approve: "Open To approve",
  dispatch: "See the late orders",
  production: "See the late batches",
  low: "See what is low",
  expected: "See the late deliveries",
  qc: "See the batches",
  hold: "See what QA stopped",
  expiring: "See what expires",
  invoice: "Make the invoices",
  invoice_save: "Save them to the books",
  so_confirm: "Open the orders",
  so_short: "See the short orders",
  so_set_aside: "See the orders",
};

/**
 * Owner / manager Home (ADR-083 §4, mockup panel 1 "Owner Dashboard"), in the mockup's order:
 * greeting; four cards (Sales today, Production progress, Stock alerts, Waiting for your approval);
 * Needs your attention (5 rows + See all); Sales this week; Production by stage; Recent activity.
 * Every number is computed on the server for the caller's sites (`getOwnerHome`) and opens the list it
 * was counted from. The detailed overview stays under Money › Reports.
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
  // Live check 2026-11-06: the sales person's own work (orders to confirm, short orders, orders ready to set aside).
  const salesDesk = ctx.roleCodes.includes("sales_cs") && ctx.can("sales.sales_order.view") && !all;
  const [oc, approvals, unbilled, soCounts, soFlow] = await Promise.all([
    getOperationsCenter(ctx, { all }),
    myApprovalCount(ctx).catch(() => 0),
    ctx.can("finance.invoice.view") ? notInvoicedShipments(ctx).catch(() => null) : Promise.resolve(null),
    salesDesk ? orderCounts(ctx).catch(() => null) : Promise.resolve(null),
    salesDesk ? getWorkFlowCounts(ctx, ["so_short", "so_can_set_aside"]).catch(() => []) : Promise.resolve([]),
  ]);
  const notBilled = unbilled ? { count: unbilled.count, toMake: unbilled.toMake, waitingApproval: unbilled.waitingApproval, toSave: unbilled.toSave, oldestDays: unbilled.oldestDispatchedAt ? Math.floor((Date.now() - unbilled.oldestDispatchedAt.getTime()) / 86_400_000) : null } : null;
  const qs = all ? "?scope=all" : "";
  const stockHref = `/dashboard/details/stock${qs}`;
  const flowN = (k: string) => soFlow.find((c) => c.key === k)?.count ?? 0;
  const sales = soCounts ? salesItems({ toConfirm: (soCounts.draft ?? 0) + (soCounts.submitted ?? 0), short: flowN("so_short"), canSetAside: flowN("so_can_set_aside") }) : [];
  const items = [...attentionItems(oc, approvals, home.stock, stockHref, notBilled), ...sales];
  // "What to do next" is the first line the viewer can act on; everything else stays in "Needs your attention".
  const next = firstActionable(items, (p) => ctx.can(p as Parameters<typeof ctx.can>[0]));
  const rest = items.filter((i) => i !== next);
  const pill = (href: string, active: boolean, label: string) => (
    <Link key={label} href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-[44px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium", active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2")}>
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
        subtitle={`${today} · ${all ? "All your sites" : ctx.currentSite.name}`}
        actions={
          ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view") ? (
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Sites">
              {pill("/dashboard", !all, "This site")}
              {pill("/dashboard?scope=all", all, "All my sites")}
            </div>
          ) : undefined
        }
      />
      <PageIntro>{homeIntro(ctx.roleCodes)}</PageIntro>
      {/* UX audit C #1/#2: one "What to do next" line (the most urgent item); the rest stay in "Needs your attention". */}
      {next ? (
        <NextStep text={`Next: ${next.text}.`} action={{ label: NEXT_LABEL[next.key] ?? "Open it", href: next.href }} />
      ) : (
        <NextStep text={items.length ? "Nothing waits for you to do. Below is what others are working on." : "Nothing needs you right now. The numbers below are for today."} />
      )}
      <HomeCards home={home} approvals={approvals} stockHref={stockHref} batchesHref={`/dashboard/details/batches${qs}`} />
      {/* Live check 2026-11-06 (desktop): "Needs your attention" and "Sales this week" stack in the left column beside
          the taller "Production by stage", so the two columns end close together instead of ~300 px apart. On phones
          and tablets the order is unchanged: attention, sales, production. */}
      {(rest.length > 0 || home.salesWeek || oc.stages.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          {(rest.length > 0 || home.salesWeek) && (
            <div className="flex min-w-0 flex-col gap-4">
              {rest.length > 0 && <NeedsAttention items={rest} />}
              {home.salesWeek && <SalesWeek week={home.salesWeek} scopeLabel={home.scope.label} generatedAt={home.generatedAt} />}
            </div>
          )}
          <ProductionByStage oc={oc} all={all} />
        </div>
      )}
      {home.activity && <RecentActivity rows={home.activity} showSite={all} />}
      <p className="text-[14px] text-fg-2">
        More numbers and charts:{" "}
        <Link href={all ? "/analytics?scope=all" : "/analytics"} className="inline-flex min-h-[44px] items-center font-medium text-primary-text underline">
          Reports
        </Link>
      </p>
    </div>
  );
}
