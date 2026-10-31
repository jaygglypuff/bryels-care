import type { ReactNode } from "react";
import type { Freshness, KpiScope, KpiTile, PeriodDto } from "@/modules/analytics";
import { Table, Td } from "@/ui/core";
import { BarList, ColumnChart, Donut, LineChart } from "@/ui/charts/charts";
import { ChartFrame } from "@/ui/charts/chart-frame";
import { axisFmt, fmtKpi, hhmm, shortDate } from "@/ui/charts/format";
import { slotColor, toneColor } from "@/ui/charts/palette";
import { LockedCard, periodText, plainKpi, scopeText } from "./kpi-ui";

/** Dashboard charts built from KPI tiles; every chart renders its table twin from the same numbers. */

const meta = (generatedAt: string, scope: KpiScope, period: PeriodDto, tile: KpiTile) =>
  `Updated ${hhmm(generatedAt)} · ${scopeText(scope)} · ${tile.kind === "asof" ? `as of ${hhmm(tile.asOf)}` : periodText(period)}`;

type Common = { tile: KpiTile; scope: KpiScope; period: PeriodDto; generatedAt: string; title: string; subtitle?: ReactNode; stale?: string | null };

/** Per-day values of a period KPI as a line (ratios, durations) or columns (counts, quantities). */
export function DailyChart({ tile, scope, period, generatedAt, title, subtitle, kind = "line", split }: Common & { kind?: "line" | "column"; split?: { numerator: string; denominator: string } }) {
  if (tile.masked) return <LockedCard title={title} />;
  const days = tile.daily ?? [];
  const labels = days.map((d) => shortDate(d.date));
  const unit = split ? "qty_g" : tile.unit;
  const fmt = axisFmt(unit);
  const href = (date: string) => `/analytics/kpi/${tile.code}?scope=${scope.key}&from=${date}&to=${new Date(Date.parse(date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10)}`;
  const chart = split ? (
    <ColumnChart
      labels={labels}
      fmt={fmt}
      ariaLabel={`${title} per day`}
      series={[
        { key: "planned", label: split.denominator, color: slotColor(2), values: days.map((d) => Number(d.denominator ?? 0)) },
        { key: "actual", label: split.numerator, color: slotColor(1), values: days.map((d) => Number(d.numerator)) },
      ]}
    />
  ) : kind === "column" ? (
    <ColumnChart labels={labels} fmt={fmt} ariaLabel={`${title} per day`} series={[{ key: "v", label: plainKpi(tile.code, tile.short), color: slotColor(1), values: days.map((d) => Number(d.value ?? 0)) }]} />
  ) : (
    <LineChart
      labels={labels}
      fmt={fmt}
      ariaLabel={`${title} per day: ${days.map((d) => `${d.date} ${fmtKpi(unit, d.value)}`).join(", ")}`}
      max={tile.unit === "ratio" ? Math.max(1, ...days.map((d) => Number(d.value ?? 0))) : undefined}
      series={[{ key: "v", label: plainKpi(tile.code, tile.short), color: slotColor(1), dashed: tile.label !== "actual", values: days.map((d) => (d.value === null ? null : Number(d.value))), hrefs: days.map((d) => href(d.date)) }]}
    />
  );
  const table = (
    <Table head={split ? ["Day", split.denominator, split.numerator, "Share"] : ["Day", plainKpi(tile.code, tile.short), "Records"]}>
      {days.map((d) => (
        <tr key={d.date}>
          <Td>{shortDate(d.date)}</Td>
          {split ? (
            <>
              <Td className="text-right tabular">{fmtKpi("qty_g", d.denominator)}</Td>
              <Td className="text-right tabular">{fmtKpi("qty_g", d.numerator)}</Td>
              <Td className="text-right tabular">{fmtKpi("ratio", d.value)}</Td>
            </>
          ) : (
            <>
              <Td className="text-right tabular">{fmtKpi(tile.unit, d.value)}</Td>
              <Td className="text-right tabular">{d.rowCount}</Td>
            </>
          )}
        </tr>
      ))}
      <tr className="font-semibold">
        <Td>Period</Td>
        {split ? (
          <>
            <Td className="text-right tabular">{fmtKpi("qty_g", tile.current?.denominator)}</Td>
            <Td className="text-right tabular">{fmtKpi("qty_g", tile.current?.numerator)}</Td>
            <Td className="text-right tabular">{fmtKpi("ratio", tile.current?.value)}</Td>
          </>
        ) : (
          <>
            <Td className="text-right tabular">{fmtKpi(tile.unit, tile.current?.value)}</Td>
            <Td className="text-right tabular">{tile.current?.rowCount}</Td>
          </>
        )}
      </tr>
    </Table>
  );
  const legend = split ? (
    <ul className="flex flex-wrap gap-3 text-[12px] text-fg-2">
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-[3px]" style={{ background: slotColor(2) }} aria-hidden /> {split.denominator}
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded-[3px]" style={{ background: slotColor(1) }} aria-hidden /> {split.numerator}
      </li>
    </ul>
  ) : undefined;
  return <ChartFrame title={title} subtitle={subtitle} chart={days.length ? chart : <p className="py-6 text-center text-[13px] text-muted">No days in this period.</p>} table={table} legend={legend} meta={meta(generatedAt, scope, period, tile)} />;
}

/** The rows of a KPI grouped by category as labelled bars (or a donut for part-to-whole with ≤ 4 parts). */
export function BreakdownChart({ tile, scope, period, generatedAt, title, subtitle, measure = "rows", donut = false, empty }: Common & { measure?: "rows" | "num"; donut?: boolean; empty?: string }) {
  if (tile.masked) return <LockedCard title={title} />;
  const items = tile.breakdown ?? [];
  const valueOf = (b: (typeof items)[number]) => (measure === "rows" ? b.rows : Number(b.num));
  const display = (b: (typeof items)[number]) => (measure === "rows" ? String(b.rows) : fmtKpi(tile.unit, b.num));
  const total = items.reduce((a, b) => a + valueOf(b), 0);
  const chart =
    donut && items.length > 0 && items.length <= 4 ? (
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Donut segments={items.map((b, i) => ({ key: b.key, label: b.label, value: valueOf(b), color: toneColor(b.tone === "neutral" ? undefined : b.tone, i + 1) }))} centre={fmtKpi(tile.unit, tile.current?.value)} centreLabel={plainKpi(tile.code, tile.short)} ariaLabel={`${title}: ${items.map((b) => `${b.label} ${display(b)}`).join(", ")}`} />
        <ul className="grid w-full gap-1.5 text-[13px]">
          {items.map((b, i) => (
            <li key={b.key} className="grid grid-cols-[12px_1fr_auto] items-center gap-2">
              <span className="size-3 rounded-[3px]" style={{ background: toneColor(b.tone === "neutral" ? undefined : b.tone, i + 1) }} aria-hidden />
              <span className="capitalize text-fg">{b.label}</span>
              <span className="tabular font-medium">{display(b)}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <BarList ariaLabel={title} empty={empty} items={items.map((b, i) => ({ key: b.key, label: b.label.charAt(0).toUpperCase() + b.label.slice(1), value: valueOf(b), display: display(b), color: b.tone === "neutral" ? slotColor(i + 1 > 6 ? 1 : i + 1) : toneColor(b.tone), href: tile.href }))} />
    );
  const table = (
    <Table head={["Category", measure === "rows" ? "Records" : plainKpi(tile.code, tile.short), "Share"]}>
      {items.map((b) => (
        <tr key={b.key}>
          <Td className="capitalize">{b.label}</Td>
          <Td className="text-right tabular">{display(b)}</Td>
          <Td className="text-right tabular">{total ? `${((valueOf(b) / total) * 100).toFixed(0)} %` : "—"}</Td>
        </tr>
      ))}
      <tr className="font-semibold">
        <Td>Total</Td>
        <Td className="text-right tabular">{measure === "rows" ? items.reduce((a, b) => a + b.rows, 0) : fmtKpi(tile.unit, tile.current?.value)}</Td>
        <Td />
      </tr>
    </Table>
  );
  return <ChartFrame title={title} subtitle={subtitle} chart={chart} table={table} meta={meta(generatedAt, scope, period, tile)} />;
}

export function FreshnessLine({ freshness }: { freshness: Freshness }) {
  return (
    <span>
      Nightly snapshot {freshness.lastSnapshotAt ? `${hhmm(freshness.lastSnapshotAt)}${freshness.lastBusinessDate ? ` (to ${shortDate(freshness.lastBusinessDate)})` : ""}` : "not run yet"}
      {freshness.stale && <span className="ml-1 font-medium text-[var(--warn-fg)]">· Stale</span>}
    </span>
  );
}

