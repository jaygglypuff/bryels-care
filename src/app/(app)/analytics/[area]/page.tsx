import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { AREAS, type AreaDashboard, type AreaKey, DASHBOARD_KPIS, canSeeCrossSite, getAreaDashboard } from "@/modules/analytics";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { fmtKpi } from "@/ui/charts/format";
import { BreakdownChart, DailyChart } from "../charts";
import { KpiCard, RecordList, ScopePeriodBar, StaleNotice } from "../kpi-ui";

export const dynamic = "force-dynamic";

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[17px] font-semibold text-fg">{title}</h2>
        {aside && <div className="text-[12px] text-muted">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

function ListSection({ d, list, code, title, empty, valueHeader, unit }: { d: AreaDashboard; list: string; code: string; title: string; empty: string; valueHeader?: string; unit?: string }) {
  const rows = d.lists[list];
  if (!rows) return null;
  const tile = d.tiles[code];
  return (
    <Section title={title} aside={tile ? <Link href={tile.href} className="font-medium text-primary-text hover:underline">All records</Link> : undefined}>
      <RecordList rows={rows} showSite={d.scope.all} empty={empty} valueHeader={valueHeader} value={unit ? (r) => fmtKpi(unit, r.num) : undefined} />
    </Section>
  );
}

function Body({ d }: { d: AreaDashboard }) {
  const c = { scope: d.scope, period: d.period, generatedAt: d.generatedAt };
  const t = d.tiles;
  const cards = DASHBOARD_KPIS[d.area].filter((code) => t[code]);
  return (
    <div className="flex flex-col gap-4">
      <StaleNotice freshness={d.freshness} />
      {d.ledgerCheck && (
        <Banner tone={d.ledgerCheck.every((x) => x.agrees) ? "ok" : "bad"} title={d.ledgerCheck.every((x) => x.agrees) ? "Stock totals agree with the ledger" : "Stock totals differ from the ledger"}>
          Usable and blocked stock on the cards come from the balance projection; the same totals recomputed from every posted stock movement give{" "}
          {d.ledgerCheck.map((x) => `${x.code} ${x.ledger ?? "n/a"}`).join(" · ")}.
          {!d.ledgerCheck.every((x) => x.agrees) && " Run the stock reconciliation in Diagnostics; nothing is corrected automatically."}
        </Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((code) => (
          <KpiCard key={code} tile={t[code]} {...c} updated={d.generatedAt} visual={t[code].kind === "period" && t[code].aggregate === "ratio" && code === "KPI-OPS-01" ? "meter" : "sparkline"} />
        ))}
      </div>
      {d.area === "operations" && (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <DailyChart {...c} tile={t["KPI-OPS-01"]} title="Output vs plan per day" subtitle="Planned mass of work orders due that day and output mass posted that day" split={{ numerator: "Output posted", denominator: "Planned (due)" }} />
            <DailyChart {...c} tile={t["KPI-OPS-02"]} title="Yield per day" subtitle="Actual ÷ theoretical output mass, batches by first yield record" />
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <BreakdownChart {...c} tile={t["KPI-OPS-05"]} title="Open work orders by status" />
            <BreakdownChart {...c} tile={t["KPI-OPS-07"]} title="Step overrun by step kind" measure="num" empty="No completed step has an expected duration in its routing yet, so no overrun can be measured." />
          </div>
          <ListSection d={d} list="late_work_orders" code="KPI-OPS-14" title="Late work orders" empty="No open work order is past its planned end." />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <ListSection d={d} list="yield_outside" code="KPI-OPS-02" title="Batches outside yield limits" empty="Every batch in the period is within its yield limits." />
            <ListSection d={d} list="dispense_exceptions" code="KPI-OPS-16" title="Weighings outside tolerance" empty="Every original weighing was within tolerance." />
          </div>
        </>
      )}
      {d.area === "inventory" && (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <BreakdownChart {...c} tile={t["KPI-INV-02"]} title="Blocked lots by status" empty="No blocked lot has stock on hand." />
            <BreakdownChart {...c} tile={t["KPI-INV-07"]} title="Material coverage of planned work orders" donut empty="No planned or released work order." />
          </div>
          <ListSection d={d} list="fefo_risk" code="KPI-INV-04" title="FEFO risk: released lots expiring soon" empty="No released lot with stock expires within the window." />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <ListSection d={d} list="expired" code="KPI-INV-04E" title="Expired lots on hand" empty="No expired stock on hand." />
            <ListSection d={d} list="coverage_short" code="KPI-INV-07" title="Work orders short of material" empty="Every planned work order is covered by released stock." />
          </div>
        </>
      )}
      {d.area === "quality" && (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <DailyChart {...c} tile={t["KPI-QUA-01"]} title="QC turnaround per day (median hours)" />
            <BreakdownChart {...c} tile={t["KPI-QUA-06"]} title="Deviations raised by severity" empty="No deviation raised in the period." />
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <BreakdownChart {...c} tile={t["KPI-QUA-02"]} title="Finished-product outcomes" donut empty="No finished-product inspection reviewed in the period." />
            <BreakdownChart {...c} tile={t["KPI-QUA-11"]} title="Incoming backlog by status" empty="No incoming inspection is open." />
          </div>
          <ListSection d={d} list="open_holds" code="KPI-QUA-03A" title="Open holds, oldest first" empty="No quality hold is open." valueHeader="Age" unit="days" />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <ListSection d={d} list="incoming_backlog" code="KPI-QUA-11" title="Incoming inspections waiting" empty="No incoming inspection is waiting." />
            <ListSection d={d} list="oos" code="KPI-QUA-04" title="Out-of-specification results" empty="No result out of specification in the period." />
          </div>
        </>
      )}
      {d.area === "sales" && (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <DailyChart {...c} tile={t["KPI-SAL-01"]} title="Orders per day" kind="column" />
            <BreakdownChart {...c} tile={t["KPI-SAL-02"]} title="On time in full" donut empty="No order due in the period." />
          </div>
          <DailyChart {...c} tile={t["KPI-SAL-04"]} title="Order-to-ship time per day (median days)" />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <ListSection d={d} list="overdue_orders" code="KPI-SAL-11" title="Orders past their requested date" empty="No order is past its requested date." />
            <ListSection d={d} list="otif_missed" code="KPI-SAL-02" title="Orders late or not shipped in full" empty="Every order due in the period was on time in full." />
          </div>
        </>
      )}
    </div>
  );
}

export default async function AreaDashboardPage({ params, searchParams }: { params: Promise<{ area: string }>; searchParams: Promise<{ scope?: string; period?: string }> }) {
  const { area } = await params;
  if (!(area in AREAS)) notFound();
  const ctx = await requireContext();
  const sp = await searchParams;
  const meta = AREAS[area as AreaKey];
  if (!ctx.can("analytics.dashboard.view"))
    return (
      <>
        <PageHeader title={`${meta.title} dashboard`} />
        <EmptyState title={`You don't have access to dashboards at ${ctx.currentSite.code}`}>Ask your site manager, or switch site.</EmptyState>
      </>
    );
  let d: AreaDashboard;
  try {
    d = await getAreaDashboard(ctx, area as AreaKey, { scope: sp.scope ?? null, period: sp.period ?? null });
  } catch (e) {
    if (e instanceof DomainError && (e.code === "forbidden" || e.code === "not_found"))
      return (
        <>
          <PageHeader title={`${meta.title} dashboard`} />
          <EmptyState title="This view isn't available to you" action={<Link href={`/analytics/${area}`} className="font-medium text-primary-text hover:underline">Open your site&apos;s view</Link>}>
            {e.message}
          </EmptyState>
        </>
      );
    throw e;
  }
  return (
    <>
      <PageHeader title={`${meta.title} dashboard`} subtitle={`${d.scope.label} · ${d.period.label} · ${meta.intro}`} actions={<ScopePeriodBar basePath={`/analytics/${area}`} scope={d.scope} period={d.period} sites={ctx.allowedSites} canAll={canSeeCrossSite(ctx)} />} />
      <Body d={d} />
    </>
  );
}
