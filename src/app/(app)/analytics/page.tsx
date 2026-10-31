import Link from "next/link";
import Decimal from "decimal.js";
import { ArrowRight, Boxes, Factory, PhilippinePeso } from "lucide-react";
import type { ReactNode } from "react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtQty } from "@/lib/qty";
import { type KpiTile, getKpiTile, getTopProducts, listStockAlerts, listWeekBatches, stockAlertCounts } from "@/modules/analytics";
import { Card, EmptyState, PageHeader, cx } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { deltaOf, fmtKpi } from "@/ui/charts/format";
import { slotColor } from "@/ui/charts/palette";
import { Forbidden } from "../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

/** Four weeks of sales; the chart groups the days into four weeks so it reads on a phone. */
const DAYS = 28;

const peso = (v: string) => `₱${new Decimal(v).toDecimalPlaces(0).toNumber().toLocaleString("en-PH")}`;
const dayLabel = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Reports landing page (ADR-088 grade-5 business overview): three numbers, one chart, the best-selling
 * products, then the other reports in plain words. No KPI codes on screen. Every number opens the records
 * it is made of; each part is shown only when the caller may see it (same reads as Home).
 */
export default async function ReportsHome({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireContext();
  const canDash = ctx.can("analytics.dashboard.view");
  const canReports = ctx.can("analytics.report.view");
  if (!canDash && !canReports) return <Forbidden what="reports" />;
  const sp = await searchParams;
  const all = sp.scope === "all" && ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view");
  const qs = all ? "?scope=all" : "";

  let data: Awaited<ReturnType<typeof load>> | null = null;
  if (canDash) {
    try {
      data = await load(ctx, all);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      data = null;
    }
  }

  const links: { href: string; title: string; text: string; show: boolean }[] = [
    { href: `/analytics/sales${qs}`, title: "Sales", text: "Orders per day, orders sent on time, orders that are late.", show: canDash },
    { href: `/analytics/operations${qs}`, title: "Making products", text: "How much we made against the plan, and batches that came out short.", show: canDash },
    { href: `/analytics/inventory${qs}`, title: "Stock", text: "What we can use, what is stopped, what expires soon.", show: canDash },
    { href: `/analytics/quality${qs}`, title: "Quality", text: "How fast QA checks things, problems found, stock stopped by QA.", show: canDash },
    { href: "/reports", title: "Lists to download or print", text: "Ready-made lists (stock, batches, orders, QA) as Excel, CSV or paper.", show: canReports },
    { href: "/analytics/trends", title: "Compare over time", text: "Put up to six numbers on one chart, by day, week or month.", show: canDash },
    { href: `/analytics/overview${qs}`, title: "Every number on one page", text: "The full business overview: all cards, sites side by side.", show: canDash },
  ];
  const visible = links.filter((l) => l.show);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle={canDash ? `${all ? "All your sites" : ctx.currentSite.name} · last 4 weeks` : undefined}
        actions={
          ctx.allowedSites.length > 1 && ctx.can("analytics.owner_dashboard.view") ? (
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Sites">
              <Pill href="/analytics" active={!all}>This site</Pill>
              <Pill href="/analytics?scope=all" active={all}>All my sites</Pill>
            </div>
          ) : undefined
        }
      />
      <PageIntro>This screen is for the owner and managers: how the business is doing in three numbers, sales per week and what sells best. Tap any number to see the orders or batches behind it.</PageIntro>

      {data && (
        <>
          <section aria-label="The business in three numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.sales && <SalesTile tile={data.sales} />}
            {data.batches && (
              <Tile
                title="Batches done this week"
                icon={<Factory size={16} />}
                tone="blue"
                href={`/dashboard/details/batches${qs}`}
                value={`${data.batches.done} of ${data.batches.total}`}
              >
                {data.batches.total === 0 ? "No batch is planned this week." : "Done = checked and OK'd by QA."}
              </Tile>
            )}
            {data.stock && (
              <Tile title="Stock to look at" icon={<Boxes size={16} />} tone="orange" href={`/dashboard/details/stock${qs}`} value={data.stock.total.toLocaleString("en-PH")}>
                {[
                  data.stock.lowStock !== null ? `${data.stock.lowStock} running low` : null,
                  data.stock.expiring !== null ? `${data.stock.expiring} expire within 30 days` : null,
                  data.stock.onHold !== null ? `${data.stock.onHold} stopped by QA` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Tile>
            )}
          </section>

          {data.sales && <WeeklySales tile={data.sales} />}

          {data.top && <TopProductsCard top={data.top} ordersHref={data.sales?.href ?? "/sales"} />}
        </>
      )}
      {canDash && !data && (
        <EmptyState title="The numbers could not be shown">Try again in a minute. If it keeps happening, tell the owner or the IT person.</EmptyState>
      )}

      <section aria-labelledby="more-reports-h">
        <h2 id="more-reports-h" className="mb-2 font-display text-[18px] font-semibold text-fg">More reports</h2>
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
          {visible.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-fg">{l.title}</span>
                  <span className="block text-[13px] text-fg-2">{l.text}</span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {ctx.can("analytics.kpi_definition.view") && (
        <MoreDetails title="How the numbers are worked out (for checking)">
          <p className="text-[14px] text-fg-2">
            Every number comes from records that were saved and posted: confirmed customer orders, batches OK&apos;d by QA, stock on hand. Nothing is typed in by hand.{" "}
            <Link href="/analytics/definitions" className="font-medium text-primary-text underline">What each number means</Link>
          </p>
        </MoreDetails>
      )}
    </div>
  );
}

async function load(ctx: Awaited<ReturnType<typeof requireContext>>, all: boolean) {
  const seesOrders = ctx.can("sales.sales_order.view");
  const scope = all ? "all" : ctx.currentSiteId;
  // The best-sellers read model fixes the 4-week window in the organization's time zone; the sales tile uses the same days.
  const top = seesOrders ? await getTopProducts(ctx, { all, days: DAYS, limit: 5 }) : null;
  const [value, count, week, alerts] = await Promise.all([
    top ? getKpiTile(ctx, "KPI-SAL-01V", { scope, from: top.from, to: top.to, daily: true }) : null,
    top ? getKpiTile(ctx, "KPI-SAL-01", { scope, from: top.from, to: top.to, daily: true }) : null,
    ctx.can("production.batch.view") ? listWeekBatches(ctx, { all }) : null,
    ctx.can("inventory.lot.view") || ctx.can("inventory.balance.view") ? listStockAlerts(ctx, { all }) : null,
  ]);
  const sales = value && count ? (value.masked ? count : value) : null;
  return {
    sales,
    batches: week ? { done: week.rows.filter((r) => r.done).length, total: week.rows.length } : null,
    stock: alerts ? stockAlertCounts(alerts) : null,
    top,
  };
}

function Pill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cx("flex min-h-[40px] items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium", active ? "bg-cta text-white" : "text-fg-2 hover:bg-surface-2")}>
      {children}
    </Link>
  );
}

const TONES = {
  green: "border-[var(--ok-bd)] bg-[var(--ok-bg)]",
  blue: "border-[var(--info-bd)] bg-[var(--info-bg)]",
  orange: "border-[var(--warn-bd)] bg-[var(--warn-bg)]",
} as const;

function Tile({ title, icon, tone, href, value, children }: { title: string; icon: ReactNode; tone: keyof typeof TONES; href: string; value: ReactNode; children?: ReactNode }) {
  return (
    <Link href={href} className={cx("group flex min-w-0 flex-col rounded-[18px] border p-4 transition-shadow hover:shadow-[var(--shadow-pop)]", TONES[tone])}>
      <span className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-fg-2" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-semibold text-fg">{title}</span>
        <ArrowRight size={16} className="shrink-0 text-muted" aria-hidden />
      </span>
      <span className="mt-3 block break-words font-display text-[28px] font-semibold leading-none text-fg tabular">{value}</span>
      {children && <span className="mt-2 block text-[13px] leading-snug text-fg-2">{children}</span>}
    </Link>
  );
}

function SalesTile({ tile }: { tile: KpiTile }) {
  const money = tile.unit === "money";
  const cur = tile.current?.value ?? "0";
  const d = deltaOf(tile.unit, "up", tile.current?.value, tile.previous?.value, "the 4 weeks before");
  return (
    <Tile title="Sales, last 4 weeks" icon={<PhilippinePeso size={16} />} tone="green" href={tile.href} value={money ? peso(cur) : `${Number(cur).toLocaleString("en-PH")} orders`}>
      {money ? `${(tile.current?.rowCount ?? 0).toLocaleString("en-PH")} orders confirmed` : "Confirmed customer orders"}
      {d && <span className={cx("block", d.tone === "good" ? "text-[var(--ok-fg)]" : d.tone === "bad" ? "text-[var(--bad-fg)]" : "")}>{d.text}</span>}
    </Tile>
  );
}

/** One chart: sales per week (four bars, HTML so the labels stay readable on a 390 px phone). */
function WeeklySales({ tile }: { tile: KpiTile }) {
  const money = tile.unit === "money";
  const daily = tile.daily ?? [];
  const weeks = [0, 1, 2, 3].map((w) => {
    const part = daily.slice(w * 7, w * 7 + 7);
    const total = part.reduce((s, p) => s.plus(p.value ?? 0), new Decimal(0));
    const orders = part.reduce((s, p) => s + (p.rowCount ?? 0), 0);
    return { label: part[0] ? `${dayLabel(part[0].date)} – ${dayLabel(part[part.length - 1].date)}` : "", short: w === 3 ? "This week" : `${3 - w} wk ago`, total, orders };
  });
  const max = Decimal.max(1, ...weeks.map((w) => w.total));
  const show = (v: Decimal) => (money ? peso(v.toString()) : v.toNumber().toLocaleString("en-PH"));
  return (
    <Card aria-labelledby="weekly-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="weekly-h" className="font-display text-[18px] font-semibold text-fg">Sales per week</h2>
        <Link href={tile.href} className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">See the orders</Link>
      </div>
      <p className="text-[13px] text-fg-2">{money ? "Value of confirmed customer orders, at order price." : "Number of confirmed customer orders."} Real figures, no estimates.</p>
      <div className="mt-4 flex h-[180px] items-end gap-3 border-b border-line-strong" role="img" aria-label={`Sales per week: ${weeks.map((w) => `${w.label} ${show(w.total)}`).join(", ")}`}>
        {weeks.map((w) => (
          <div key={w.short} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[12px] font-semibold tabular text-fg">{show(w.total)}</span>
            <span className="block w-full max-w-[64px] rounded-t-[6px]" style={{ height: `${Math.max(2, w.total.div(max).toNumber() * 80)}%`, background: slotColor(1) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-3">
        {weeks.map((w) => (
          <span key={w.short} className="min-w-0 flex-1 text-center text-[12px] text-fg-2">{w.short}</span>
        ))}
      </div>
      <div className="mt-3">
        <MoreDetails title="See the numbers as a table">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">Week</th>
                <th className="py-1 text-right font-medium">Orders</th>
                {money && <th className="py-1 text-right font-medium">Value</th>}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.short} className="border-t border-line">
                  <td className="py-1">{w.label}</td>
                  <td className="py-1 text-right tabular">{w.orders}</td>
                  {money && <td className="py-1 text-right tabular">{fmtKpi("money", w.total.toString())}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </MoreDetails>
      </div>
    </Card>
  );
}

function TopProductsCard({ top, ordersHref }: { top: NonNullable<Awaited<ReturnType<typeof getTopProducts>>>; ordersHref: string }) {
  const max = Decimal.max(1, ...top.rows.map((r) => new Decimal(top.masked ? r.units : (r.value ?? "0"))));
  return (
    <Card aria-labelledby="top-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="top-h" className="font-display text-[18px] font-semibold text-fg">What sells best</h2>
        <Link href={ordersHref} className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">See the orders</Link>
      </div>
      <p className="text-[13px] text-fg-2">Top {top.rows.length || 5} products in confirmed customer orders, last 4 weeks{top.masked ? " (by pieces; money is hidden for your role)" : ""}.</p>
      {top.rows.length === 0 ? (
        <p className="mt-3 text-[14px] text-fg-2">No confirmed customer order in the last 4 weeks yet. When the sales team confirms orders, the products appear here.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {top.rows.map((r, i) => {
            const v = new Decimal(top.masked ? r.units : (r.value ?? "0"));
            return (
              <li key={r.productId} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="min-w-0 break-words font-medium text-fg">
                    {i + 1}. {r.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular text-fg">{top.masked ? `${fmtQty(r.units, "", 0)} pcs` : peso(r.value ?? "0")}</span>
                </div>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(3, v.div(max).toNumber() * 100)}%`, background: slotColor(2) }} />
                </span>
                <span className="mt-0.5 block text-[12px] text-fg-2">
                  {fmtQty(r.units, "", 0)} pieces · in {r.orders} {r.orders === 1 ? "order" : "orders"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
