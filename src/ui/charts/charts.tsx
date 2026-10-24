import Link from "next/link";
import type { ReactNode } from "react";
import { VIZ, slotColor } from "./palette";

/**
 * Accessible inline SVG charts (docs/ux-system.md §2.6, rules 5.12). No chart library: every chart
 * is drawn to scale from a zero baseline (no truncated axes), carries a text alternative with the
 * values (`role="img"` + `aria-label`), direct value labels on the extremes or last point, and is
 * always paired with a table twin by the caller (ChartFrame). Geometry uses JavaScript numbers;
 * every label shown is formatted from the exact decimal string by the caller's `fmt`.
 */

export type Fmt = (v: number) => string;

/** A "nice" axis maximum ≥ v (1, 2, 2.5, 5 × 10^n). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** X labels every `every` points plus the last one, skipping a regular label that would collide with the last. */
function showLabel(i: number, n: number, every: number) {
  if (i === n - 1) return true;
  return i % every === 0 && n - 1 - i >= Math.max(1, Math.ceil(every / 2));
}

// ---------------------------------------------------------------- sparkline

export function Sparkline({ values, labels, ariaLabel, color = slotColor(1), dashed = false }: { values: (number | null)[]; labels: string[]; ariaLabel: string; color?: string; dashed?: boolean }) {
  const W = 240;
  const H = 44;
  const x0 = 4;
  const x1 = W - 6;
  const base = 40;
  const top = 6;
  const nums = values.filter((v): v is number => v !== null);
  const max = Math.max(0, ...nums);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? x1 : x0 + (i * (x1 - x0)) / (n - 1));
  const y = (v: number) => (max === 0 ? base : base - (v / max) * (base - top));
  const segs: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segs.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur.join(" "));
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={ariaLabel}>
      <title>{values.map((v, i) => `${labels[i]}: ${v === null ? "no snapshot" : v}`).join(", ")}</title>
      <line x1={x0} y1={base} x2={x1} y2={base} stroke={VIZ.axis} strokeWidth={1} />
      {segs.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {lastIdx !== undefined && <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
    </svg>
  );
}

// ---------------------------------------------------------------- line chart

export type LineSeries = { key: string; label: string; color: string; dashed?: boolean; muted?: boolean; values: (number | null)[]; hrefs?: (string | null)[] };

export function LineChart({ series, labels, fmt, ariaLabel, height = 200, max: fixedMax }: { series: LineSeries[]; labels: string[]; fmt: Fmt; ariaLabel: string; height?: number; max?: number }) {
  const W = 640;
  const H = height;
  const left = 56;
  const right = 16;
  const top = 14;
  const bottom = 28;
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = fixedMax ?? niceMax(Math.max(0, ...all));
  const x = (i: number) => (n <= 1 ? left + (W - left - right) / 2 : left + (i * (W - left - right)) / (n - 1));
  const y = (v: number) => H - bottom - (Math.max(0, v) / max) * (H - top - bottom);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={1} />
          <text x={left - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={11} fill={VIZ.text}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        showLabel(i, n, labelEvery) ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={VIZ.text}>
            {l}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const segs: string[] = [];
        let cur: string[] = [];
        s.values.forEach((v, i) => {
          if (v === null) {
            if (cur.length > 0) segs.push(cur.join(" "));
            cur = [];
          } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        });
        if (cur.length) segs.push(cur.join(" "));
        const lastIdx = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
        return (
          <g key={s.key}>
            {segs.map((pts, i) =>
              pts.includes(" ") ? (
                <polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth={s.muted ? 1.5 : 2} strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinejoin="round" strokeLinecap="round" opacity={s.muted ? 0.8 : 1} />
              ) : (
                <circle key={i} cx={Number(pts.split(",")[0])} cy={Number(pts.split(",")[1])} r={3} fill={s.color} />
              ),
            )}
            {s.values.map((v, i) => {
              if (v === null) return null;
              const dot = <circle cx={x(i)} cy={y(v)} r={i === lastIdx ? 4.5 : 3.5} fill={s.muted ? "var(--surface)" : s.color} stroke={s.muted ? s.color : "var(--surface)"} strokeWidth={2} />;
              const title = <title>{`${s.label}, ${labels[i]}: ${fmt(v)}`}</title>;
              const href = s.hrefs?.[i];
              return href ? (
                <Link key={i} href={href} aria-label={`${s.label}, ${labels[i]}: ${fmt(v)}. Open the records`}>
                  {title}
                  <circle cx={x(i)} cy={y(v)} r={10} fill="transparent" />
                  {dot}
                </Link>
              ) : (
                <g key={i}>
                  {title}
                  {dot}
                </g>
              );
            })}
            {lastIdx !== undefined && !s.muted && (
              <text x={Math.min(x(lastIdx), W - right - 2)} y={y(s.values[lastIdx]!) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--fg)">
                {fmt(s.values[lastIdx]!)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------- column chart

export type ColumnSeries = { key: string; label: string; color: string; values: number[] };

export function ColumnChart({ series, labels, fmt, ariaLabel, height = 200 }: { series: ColumnSeries[]; labels: string[]; fmt: Fmt; ariaLabel: string; height?: number }) {
  const W = 640;
  const H = height;
  const left = 56;
  const right = 12;
  const top = 18;
  const bottom = 28;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const band = (W - left - right) / Math.max(1, n);
  const barW = Math.min(24, (band - 4) / Math.max(1, series.length));
  const y = (v: number) => H - bottom - (Math.max(0, v) / max) * (H - top - bottom);
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const extremes = new Set<string>();
  for (const s of series) {
    const m = Math.max(...s.values);
    const i = s.values.indexOf(m);
    if (m > 0) extremes.add(`${s.key}:${i}`);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={1} />
          <text x={left - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={11} fill={VIZ.text}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <g key={i}>
          {series.map((s, k) => {
            const v = s.values[i] ?? 0;
            const x = left + i * band + (band - barW * series.length) / 2 + k * barW;
            const h = H - bottom - y(v);
            return (
              <g key={s.key}>
                <title>{`${s.label}, ${l}: ${fmt(v)}`}</title>
                {h > 0 && <rect x={x + 1} y={y(v)} width={Math.max(1, barW - 2)} height={h} rx={Math.min(4, (barW - 2) / 2)} fill={s.color} />}
                {extremes.has(`${s.key}:${i}`) && (
                  <text x={x + barW / 2} y={y(v) - 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--fg)">
                    {fmt(v)}
                  </text>
                )}
              </g>
            );
          })}
          {showLabel(i, n, labelEvery) && (
            <text x={left + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={VIZ.text}>
              {l}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- horizontal bars

export type BarItem = { key: string; label: string; value: number; display: string; color: string; href?: string };

/** Horizontal bars with direct labels (categories, statuses, severities); never colour alone. */
export function BarList({ items, ariaLabel, empty = "Nothing to show." }: { items: BarItem[]; ariaLabel: string; empty?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-4 text-center text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="grid gap-2" aria-label={ariaLabel}>
      {items.map((i) => {
        const pct = max > 0 ? (i.value / max) * 100 : 0;
        const body: ReactNode = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="min-w-0 truncate text-fg">{i.label}</span>
              <span className="tabular shrink-0 font-semibold text-fg">{i.display}</span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <i className="block h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, background: i.color }} />
            </div>
          </>
        );
        return <li key={i.key}>{i.href ? <Link href={i.href} className="block rounded-[8px] px-1 py-0.5 hover:bg-surface-2">{body}</Link> : <div className="px-1 py-0.5">{body}</div>}</li>;
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- donut and meter

export type DonutSegment = { key: string; label: string; value: number; color: string };

/** Part-to-whole only, ≤ 4 segments, 2 px surface gaps, centre shows the total. */
export function Donut({ segments, centre, centreLabel, ariaLabel }: { segments: DonutSegment[]; centre: string; centreLabel: string; ariaLabel: string }) {
  const r = 58;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <svg viewBox="0 0 160 160" className="h-[160px] w-[160px] max-w-full shrink-0" role="img" aria-label={ariaLabel}>
      <circle cx={80} cy={80} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={18} />
      {total > 0 && (
        <g transform="rotate(-90 80 80)">
          {segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * C;
              const el = <circle key={s.key} cx={80} cy={80} r={r} fill="none" stroke={s.color} strokeWidth={18} strokeDasharray={`${Math.max(0, len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}`} strokeDashoffset={(-offset).toFixed(2)} />;
              offset += len;
              return el;
            })}
        </g>
      )}
      <text x={80} y={78} textAnchor="middle" dominantBaseline="central" fill="var(--fg)" fontWeight={600} fontSize={26}>
        {centre}
      </text>
      <text x={80} y={104} textAnchor="middle" fill="var(--fg-muted)" fontSize={11} fontWeight={500} letterSpacing=".04em">
        {centreLabel.toUpperCase()}
      </text>
    </svg>
  );
}

/** Horizontal meter against a plan; `pct` is display-only (the caller computes it with decimal.js). */
export function Meter({ pct, ariaLabel, color = slotColor(1) }: { pct: number; ariaLabel: string; color?: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-primary-soft" role="img" aria-label={ariaLabel}>
      <i className="block h-full rounded-full" style={{ width: `${w.toFixed(1)}%`, background: color }} />
    </div>
  );
}
