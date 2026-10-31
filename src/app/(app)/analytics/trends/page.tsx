import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { type Comparison, type Grain, type Trends, COMPARISONS, TREND_MAX_SERIES, TREND_SPANS, canSeeCrossSite, getTrends, listTrendViews, resolveKpiScope, trendCatalogue } from "@/modules/analytics";
import { Card, EmptyState, PageHeader, Table, Td, buttonClass, inputClass } from "@/ui/core";
import { LineChart } from "@/ui/charts/charts";
import { ChartFrame } from "@/ui/charts/chart-frame";
import { axisFmt, fmtKpi, hhmm, monthLabel, shortDate } from "@/ui/charts/format";
import { VIZ, slotColor } from "@/ui/charts/palette";
import { StaleNotice, ValueLabelChip, plainKpi, rangeText } from "../kpi-ui";
import { PageIntro } from "@/ui/guide";
import { DeleteViewForm, SaveViewForm } from "./forms";

export const dynamic = "force-dynamic";

const GRAINS: Grain[] = ["day", "week", "month"];
const GRAIN_TEXT: Record<Grain, string> = { day: "Day", week: "Week", month: "Month" };
const COMPARISON_TEXT: Record<Comparison, string> = { none: "No comparison", previous: "Previous period", last_year: "Same period last year" };
const DEFAULT_CODES = ["KPI-SAL-01", "KPI-OPS-02", "KPI-SAL-02", "KPI-INV-04"];

type SP = { k?: string | string[]; grain?: string; span?: string; comparison?: string; scope?: string };

const bucketLabel = (start: string, grain: Grain) => (grain === "month" ? monthLabel(start) : grain === "week" ? `Wk ${shortDate(start)}` : shortDate(start));

function Picker({ catalogue, codes, grain, span, comparison, scopeKey, sites, canAll }: { catalogue: { code: string; name: string; label: string }[]; codes: string[]; grain: Grain; span: number; comparison: Comparison; scopeKey: string; sites: { id: string; code: string }[]; canAll: boolean }) {
  return (
    <Card>
      <form method="get" action="/analytics/trends" className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-[14px] font-medium text-fg">Numbers to show (up to {TREND_MAX_SERIES})</legend>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {catalogue.map((k) => (
              <label key={k.code} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="checkbox" name="k" value={k.code} defaultChecked={codes.includes(k.code)} className="size-4 accent-[var(--brand-600)]" />
                <span className="min-w-0">
                  {plainKpi(k.code, k.name)} {k.label !== "actual" && <span className="text-[11px] font-semibold uppercase text-[var(--warn-fg)]">Estimate</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Grain
            <select name="grain" defaultValue={grain} className={inputClass}>
              {GRAINS.map((g) => (
                <option key={g} value={g}>
                  {GRAIN_TEXT[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Length
            <select name="span" defaultValue={String(span)} className={inputClass}>
              {GRAINS.flatMap((g) =>
                TREND_SPANS[g].map((n) => (
                  <option key={`${g}-${n}`} value={n} disabled={g !== grain}>
                    {n} {g}s{g !== grain ? ` (pick grain ${g})` : ""}
                  </option>
                )),
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Compare with
            <select name="comparison" defaultValue={comparison} className={inputClass}>
              {COMPARISONS.map((c) => (
                <option key={c} value={c}>
                  {COMPARISON_TEXT[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            Sites
            <select name="scope" defaultValue={scopeKey} className={inputClass}>
              {canAll && <option value="all">All sites</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <button type="submit" className={buttonClass("primary", "md")}>
            Show trends
          </button>
        </div>
      </form>
    </Card>
  );
}

function TrendCharts({ t }: { t: Trends }) {
  const labels = t.buckets.map((b) => bucketLabel(b.start, t.grain));
  const compLabel = t.comparison === "previous" ? "Previous period" : "Same period last year";
  const updated = `Updated ${t.computedAt ? hhmm(t.computedAt) : "—"} · ${t.scope.all ? "All sites" : t.scope.sites[0].code} · ${rangeText(t.buckets[0].start, t.buckets[t.buckets.length - 1].end)} · by ${t.grain}`;
  const charts = (
    <div className="grid gap-5 lg:grid-cols-2">
      {t.series.map((s, si) => (
        <figure key={s.code} className="min-w-0">
          <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="size-3 rounded-full" style={{ background: slotColor(s.slot) }} aria-hidden />
            <span className="font-medium text-fg" title={`${s.definition} Calculation: ${s.formula}. Time basis: ${s.timeBasis}.`}>
              {s.name}
            </span>
            <ValueLabelChip label={s.label} />
          </figcaption>
          {s.note ? (
            <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-6 text-center text-[13px] text-muted">{s.note}</p>
          ) : s.points.every((p) => p === null) ? (
            <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-6 text-center text-[13px] text-muted">No nightly snapshot in this range yet.</p>
          ) : (
            <LineChart
              labels={labels}
              fmt={axisFmt(s.unit)}
              height={180}
              ariaLabel={`${s.name} by ${t.grain}: ${s.points.map((p, i) => `${labels[i]} ${fmtKpi(s.unit, p?.value)}`).join(", ")}`}
              max={s.unit === "ratio" ? Math.max(1, ...s.points.map((p) => Number(p?.value ?? 0)), ...(s.comparison ?? []).map((p) => Number(p?.value ?? 0))) : undefined}
              series={[
                ...(s.comparison ? [{ key: "cmp", label: compLabel, color: VIZ.comparison, muted: true, values: s.comparison.map((p) => (p?.value == null ? null : Number(p.value))) }] : []),
                { key: "cur", label: s.name, color: slotColor(s.slot), dashed: s.label !== "actual", values: s.points.map((p) => (p?.value == null ? null : Number(p.value))), hrefs: t.buckets.map((b) => b.href[si]) },
              ]}
            />
          )}
          <p className="mt-1 text-[12px] text-muted">{s.definition}</p>
        </figure>
      ))}
    </div>
  );
  const table = (
    <Table head={[GRAIN_TEXT[t.grain], ...t.series.flatMap((s) => (t.comparison === "none" ? [s.short] : [s.short, `${s.short} (${t.comparison === "previous" ? "prev." : "last yr"})`]))]}>
      {t.buckets.map((b, i) => (
        <tr key={b.start}>
          <Td className="whitespace-nowrap">{bucketLabel(b.start, t.grain)}</Td>
          {t.series.flatMap((s, si) => {
            const cells = [
              <Td key={`${s.code}-v`} className="whitespace-nowrap text-right tabular">
                {s.points[i] ? (
                  <Link href={b.href[si] ?? "#"} className="text-primary-text hover:underline">
                    {fmtKpi(s.unit, s.points[i]!.value)}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>,
            ];
            if (t.comparison !== "none")
              cells.push(
                <Td key={`${s.code}-c`} className="whitespace-nowrap text-right tabular text-fg-2">
                  {s.comparison?.[i] ? fmtKpi(s.unit, s.comparison[i]!.value) : "—"}
                </Td>,
              );
            return cells;
          })}
        </tr>
      ))}
    </Table>
  );
  const legend = (
    <ul className="flex flex-wrap gap-3 text-[12px] text-fg-2">
      {t.comparison !== "none" && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: VIZ.comparison }} aria-hidden /> {compLabel}
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#8a8f86]" aria-hidden /> Estimate (dashed)
      </li>
      <li>Click a point to open its records.</li>
    </ul>
  );
  return <ChartFrame title="The charts" subtitle="One small chart per number, each starting at zero; figures saved each night" chart={charts} table={table} legend={legend} meta={updated} stale={t.freshness.stale ? t.freshness.reason : null} />;
}

/** US-5-16 trends page (docs/ux-system.md §9.15). */
export default async function TrendsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("analytics.dashboard.view"))
    return (
      <>
        <PageHeader title="Compare over time" />
        <EmptyState title={`You don't have access to dashboards at ${ctx.currentSite.code}`}>Ask your site manager, or switch site.</EmptyState>
      </>
    );
  const sp = await searchParams;
  const grain: Grain = GRAINS.includes(sp.grain as Grain) ? (sp.grain as Grain) : "day";
  const span = TREND_SPANS[grain].includes(Number(sp.span)) ? Number(sp.span) : grain === "day" ? 30 : 12;
  const comparison: Comparison = (COMPARISONS as readonly string[]).includes(sp.comparison ?? "") ? (sp.comparison as Comparison) : "none";
  let scope;
  try {
    scope = await resolveKpiScope(ctx, sp.scope ?? null);
  } catch (e) {
    if (e instanceof DomainError) return <EmptyState title="This view isn't available to you" action={<Link href="/analytics/trends" className="font-medium text-primary-text hover:underline">Open your site&apos;s trends</Link>}>{e.message}</EmptyState>;
    throw e;
  }
  const catalogue = trendCatalogue(ctx, scope);
  const requested = sp.k === undefined ? DEFAULT_CODES : Array.isArray(sp.k) ? sp.k : [sp.k];
  const codes = requested.filter((c) => catalogue.some((k) => k.code === c));
  let trends: Trends | null = null;
  let error: string | null = null;
  if (requested.length > TREND_MAX_SERIES) error = `Pick at most ${TREND_MAX_SERIES} KPIs; ${requested.length} are selected.`;
  else if (codes.length === 0) error = "Pick at least one KPI.";
  else {
    try {
      trends = await getTrends(ctx, { codes, grain, span, comparison, scope: scope.key });
    } catch (e) {
      if (e instanceof DomainError) error = e.message;
      else throw e;
    }
  }
  const views = await listTrendViews(ctx);
  const config = JSON.stringify({ codes, grain, span, comparison, scope: scope.key });
  const viewHref = (c: { codes: string[]; grain: string; span: number; comparison: string; scope: string | null }) => {
    const q = new URLSearchParams({ grain: c.grain, span: String(c.span), comparison: c.comparison, scope: c.scope ?? "" });
    for (const k of c.codes) q.append("k", k);
    return `/analytics/trends?${q.toString()}`;
  };
  return (
    <>
      <PageHeader title="Compare over time" subtitle={`${scope.label} · per ${grain}`} />
      <PageIntro>This screen is for seeing how numbers change over time: tick up to six numbers, choose day, week or month, and press the button. The figures are saved each night.</PageIntro>
      <div className="flex flex-col gap-4">
        <Picker catalogue={catalogue} codes={codes} grain={grain} span={span} comparison={comparison} scopeKey={scope.key} sites={ctx.allowedSites} canAll={canSeeCrossSite(ctx)} />
        {trends && <StaleNotice freshness={trends.freshness} />}
        {error ? <EmptyState title="Check the selection">{error}</EmptyState> : trends && <TrendCharts t={trends} />}
        <Card>
          <h2 className="mb-2 font-display text-[17px] font-semibold">Saved views</h2>
          {views.length === 0 ? (
            <p className="text-[13px] text-muted">No saved view yet. Views are private to you.</p>
          ) : (
            <ul className="mb-3 divide-y divide-line">
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={viewHref(v.config as Parameters<typeof viewHref>[0])} className="font-medium text-primary-text hover:underline">
                    {v.name}
                  </Link>
                  <DeleteViewForm viewId={v.id} name={v.name} />
                </li>
              ))}
            </ul>
          )}
          {trends && <SaveViewForm config={config} defaultName={`${trends.series.map((s) => s.short).slice(0, 3).join(", ")} by ${grain}`} />}
          {ctx.can("analytics.scheduled_report.view") ? (
            <p className="mt-2 text-[12px] text-muted">
              Saved views stay on screen. To receive a report by email on a schedule, use{" "}
              <Link href="/reports/schedules" className="text-primary-text hover:underline">scheduled reports</Link> (trend views are not schedulable yet).
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-muted">Saved views stay on screen; trend views are not schedulable as reports yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
