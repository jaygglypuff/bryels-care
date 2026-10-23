/**
 * Inline SVG charts drawn to scale (zero baseline, linear). Colours follow the style tile chart palette
 * (--chart-1 green, viz set for good/neutral). Each chart carries a text alternative with the values.
 */

const CHART_GREEN = "#2F8A54";

export function Sparkline({ values, labels, ariaLabel }: { values: number[]; labels: string[]; ariaLabel: string }) {
  const W = 240;
  const H = 48;
  const x0 = 4;
  const x1 = W - 4;
  const base = 42;
  const top = 6;
  const max = Math.max(0, ...values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? x1 : x0 + (i * (x1 - x0)) / (n - 1));
  const y = (v: number) => (max === 0 ? base : base - (v / max) * (base - top));
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[n - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={ariaLabel}>
      <title>{values.map((v, i) => `${labels[i]}: ${v}`).join(", ")}</title>
      <line x1={x0} y1={base} x2={x1} y2={base} stroke="var(--border)" strokeWidth={1} />
      {n > 0 && (
        <>
          <polygon points={`${x0},${base} ${pts} ${x1},${base}`} fill={CHART_GREEN} fillOpacity={0.1} />
          <polyline points={pts} fill="none" stroke={CHART_GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(last)} r={4} fill={CHART_GREEN} stroke="var(--surface)" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}

export type DonutSegment = { key: string; label: string; value: number; color: string };

export function Donut({ segments, centre, centreLabel, ariaLabel }: { segments: DonutSegment[]; centre: string; centreLabel: string; ariaLabel: string }) {
  const r = 58;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
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
              const el = (
                <circle key={s.key} cx={80} cy={80} r={r} fill="none" stroke={s.color} strokeWidth={18} strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`} strokeDashoffset={(-offset).toFixed(2)} />
              );
              offset += len;
              return el;
            })}
        </g>
      )}
      <text x={80} y={80} textAnchor="middle" dominantBaseline="central" fill="var(--fg)" fontWeight={600} fontSize={28}>
        {centre}
      </text>
      <text x={80} y={106} textAnchor="middle" fill="var(--fg-muted)" fontSize={11} fontWeight={500} letterSpacing=".04em">
        {centreLabel.toUpperCase()}
      </text>
    </svg>
  );
}

/** Horizontal meter; `pct` is computed by the caller with Decimal and clamped to 0..100 for display only. */
export function Meter({ pct, ariaLabel }: { pct: number; ariaLabel: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-primary-soft" role="img" aria-label={ariaLabel}>
      <i className="block h-full rounded-full bg-primary" style={{ width: `${w.toFixed(1)}%` }} />
    </div>
  );
}
