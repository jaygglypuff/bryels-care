import Decimal from "decimal.js";

/**
 * Baseline forecast methods of docs/analytics-kpis.md §6.2–6.3, pure and transparent (no hidden tuning):
 * MA-3, MA-6, simple exponential smoothing (α shown), seasonal naive (≥ 24 periods and lag-12
 * autocorrelation ≥ 0.3). Backtest: rolling holdout of the last 3 periods (one-step-ahead), metrics MAE,
 * WAPE (Σ|error| / Σ actual) and bias (Σ error / Σ actual); the lowest WAPE wins. Band: empirical P10–P90
 * of one-step residuals, only with ≥ 12 periods. Nothing here is a business rule; thresholds are the
 * documented defaults (A-KPI-13).
 */

export type MethodId = "ma3" | "ma6" | "ses" | "seasonal_naive";
export const METHOD_LABEL: Record<MethodId, string> = { ma3: "Moving average (3 months)", ma6: "Moving average (6 months)", ses: "Simple exponential smoothing", seasonal_naive: "Seasonal naive (12 months)" };

const mean = (xs: Decimal[]) => xs.reduce((s, x) => s.plus(x), new Decimal(0)).div(xs.length);

export function forecastNext(method: MethodId, history: Decimal[], alpha: number): Decimal | null {
  const n = history.length;
  if (method === "ma3") return n >= 3 ? mean(history.slice(-3)) : null;
  if (method === "ma6") return n >= 6 ? mean(history.slice(-6)) : null;
  if (method === "ses") {
    if (n < 1) return null;
    let level = history[0];
    for (let i = 1; i < n; i++) level = new Decimal(alpha).mul(history[i]).plus(new Decimal(1 - alpha).mul(level));
    return level;
  }
  // seasonal naive: same period one season ago, scaled by the trailing-12 mean ratio
  if (n < 24) return null;
  const last12 = mean(history.slice(-12));
  const prev12 = mean(history.slice(-24, -12));
  const ratio = prev12.isZero() ? new Decimal(1) : last12.div(prev12);
  return history[n - 12].mul(ratio);
}

/** Lag-12 autocorrelation of a series (null when undefined). */
export function autocorrelation(xs: Decimal[], lag: number): number | null {
  if (xs.length <= lag + 1) return null;
  const m = mean(xs);
  let num = new Decimal(0);
  let den = new Decimal(0);
  for (let i = 0; i < xs.length; i++) {
    den = den.plus(xs[i].minus(m).pow(2));
    if (i >= lag) num = num.plus(xs[i].minus(m).mul(xs[i - lag].minus(m)));
  }
  return den.isZero() ? null : num.div(den).toNumber();
}

export type Backtest = { method: MethodId; mae: string; wape: string | null; bias: string | null };

/** One-step-ahead backtest over the last `holdout` periods. */
export function backtest(method: MethodId, history: Decimal[], alpha: number, holdout = 3): Backtest | null {
  if (history.length <= holdout) return null;
  let absSum = new Decimal(0);
  let errSum = new Decimal(0);
  let actSum = new Decimal(0);
  for (let k = history.length - holdout; k < history.length; k++) {
    const f = forecastNext(method, history.slice(0, k), alpha);
    if (f === null) return null;
    const e = f.minus(history[k]);
    absSum = absSum.plus(e.abs());
    errSum = errSum.plus(e);
    actSum = actSum.plus(history[k]);
  }
  return {
    method,
    mae: absSum.div(holdout).toDecimalPlaces(2).toFixed(2),
    wape: actSum.isZero() ? null : absSum.div(actSum).mul(100).toDecimalPlaces(1).toFixed(1),
    bias: actSum.isZero() ? null : errSum.div(actSum).mul(100).toDecimalPlaces(1).toFixed(1),
  };
}

function quantile(sorted: Decimal[], q: number): Decimal {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo].plus(sorted[hi].minus(sorted[lo]).mul(pos - lo));
}

export type ForecastResult =
  | { sufficient: false; historyMonths: number; text: string }
  | {
      sufficient: true;
      historyMonths: number;
      method: MethodId;
      methodLabel: string;
      alpha: number | null;
      next: string;
      band: { p10: string; p90: string } | null;
      bandText: string | null;
      metrics: Backtest;
      others: Backtest[];
      intermittent: boolean;
    };

/**
 * Chooses the method and forecasts the next period. `history` = complete months, oldest first, starting at
 * the first month with any demand.
 */
export function forecastSeries(history: Decimal[], alpha: number): ForecastResult {
  const n = history.length;
  if (n < 6) return { sufficient: false, historyMonths: n, text: `Insufficient history (${n} of 6 months needed)` };
  const zeros = history.filter((x) => x.isZero()).length;
  const intermittent = zeros / n > 0.5;
  const candidates: MethodId[] = intermittent ? ["ma3", "ma6"] : ["ma3", "ma6"];
  if (!intermittent && n >= 12) candidates.push("ses");
  if (!intermittent && n >= 24 && (autocorrelation(history, 12) ?? 0) >= 0.3) candidates.push("seasonal_naive");
  const tests = candidates.map((m) => backtest(m, history, alpha)).filter((b): b is Backtest => !!b);
  if (!tests.length) return { sufficient: false, historyMonths: n, text: `Insufficient history (${n} of 6 months needed)` };
  const w = (b: Backtest) => (b.wape === null ? Number.POSITIVE_INFINITY : Number(b.wape));
  const best = [...tests].sort((a, b) => w(a) - w(b) || Number(a.mae) - Number(b.mae))[0];
  const next = forecastNext(best.method, history, alpha)!;
  let band: { p10: string; p90: string } | null = null;
  let bandText: string | null = null;
  if (n >= 12 && !intermittent) {
    const residuals: Decimal[] = [];
    for (let k = 6; k < n; k++) {
      const f = forecastNext(best.method, history.slice(0, k), alpha);
      if (f !== null) residuals.push(history[k].minus(f));
    }
    if (residuals.length >= 3) {
      const sorted = residuals.sort((a, b) => a.comparedTo(b));
      band = { p10: Decimal.max(next.plus(quantile(sorted, 0.1)), 0).toDecimalPlaces(0).toFixed(0), p90: Decimal.max(next.plus(quantile(sorted, 0.9)), 0).toDecimalPlaces(0).toFixed(0) };
    }
  }
  if (!band) bandText = intermittent ? "Intermittent demand: wide uncertainty, no band shown" : "no confidence band: too little history";
  return {
    sufficient: true,
    historyMonths: n,
    method: best.method,
    methodLabel: METHOD_LABEL[best.method],
    alpha: best.method === "ses" ? alpha : null,
    next: Decimal.max(next, 0).toDecimalPlaces(0).toFixed(0),
    band,
    bandText,
    metrics: best,
    others: tests.filter((t) => t.method !== best.method),
    intermittent,
  };
}
