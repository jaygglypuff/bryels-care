import Decimal from "decimal.js";

/** KPI value formatting from exact decimal strings (docs/analytics-kpis.md §1.6: n/a, never 0 %, for an empty denominator). */
export type Unit = "count" | "qty_g" | "qty_pcs" | "money" | "ratio" | "hours" | "days" | "minutes";

const n = (v: Decimal, dp: number) => v.toNumber().toLocaleString("en-PH", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function fmtKpi(unit: string, value: string | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const d = new Decimal(value);
  switch (unit as Unit) {
    case "ratio":
      return `${n(d.mul(100), 1)} %`;
    case "money":
      return `₱${n(d, 2)}`;
    case "qty_g":
      return d.abs().gte(1000) ? `${n(d.div(1000), 1)} kg` : `${n(d, 0)} g`;
    case "qty_pcs":
      return `${n(d, 0)} pcs`;
    case "hours":
      return `${n(d, 1)} h`;
    case "days":
      return `${n(d, 1)} d`;
    case "minutes":
      return `${n(d, 0)} min`;
    default:
      return n(d, 0);
  }
}

/** Short axis labels for chart geometry (numbers only, already in the KPI unit). */
export function axisFmt(unit: string): (v: number) => string {
  return (v: number) => {
    if (unit === "ratio") return `${Math.round(v * 100)} %`;
    if (unit === "money") return v >= 1000 ? `₱${(v / 1000).toLocaleString("en-PH", { maximumFractionDigits: 1 })}k` : `₱${Math.round(v)}`;
    if (unit === "qty_g") return v >= 1000 ? `${(v / 1000).toLocaleString("en-PH", { maximumFractionDigits: 1 })} kg` : `${Math.round(v)} g`;
    if (unit === "hours" || unit === "days") return v.toLocaleString("en-PH", { maximumFractionDigits: 1 });
    return v.toLocaleString("en-PH", { maximumFractionDigits: v < 10 ? 1 : 0 });
  };
}

export type Delta = { text: string; tone: "good" | "bad" | "neutral"; direction: "up" | "down" | "flat" };

/**
 * Change against the comparison period: percentage points for ratios, the unit difference plus the
 * relative change otherwise. Tone follows the KPI's direction (`better`).
 */
export function deltaOf(unit: string, better: "up" | "down" | null, cur: string | null | undefined, prev: string | null | undefined, prevLabel: string): Delta | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const c = new Decimal(cur);
  const p = new Decimal(prev);
  const diff = c.minus(p);
  const direction = diff.gt(0) ? "up" : diff.lt(0) ? "down" : "flat";
  const tone = direction === "flat" || better === null ? "neutral" : (direction === "up") === (better === "up") ? "good" : "bad";
  const sign = diff.gt(0) ? "+" : diff.lt(0) ? "−" : "±";
  let text: string;
  if (unit === "ratio") text = `${sign}${n(diff.abs().mul(100), 1)} points vs ${prevLabel}`;
  else {
    const abs = fmtKpi(unit, diff.abs().toString());
    const rel = p.isZero() ? "" : ` (${sign}${n(diff.abs().div(p.abs()).mul(100), 0)} %)`;
    text = direction === "flat" ? `Same as ${prevLabel}` : `${sign}${abs}${rel} vs ${prevLabel}`;
  }
  return { text, tone, direction };
}

export const LABEL_TEXT: Record<string, string> = { actual: "Actual", estimate: "Estimate", forecast: "Forecast", overridden: "Overridden" };

/** "HH:MM" in Manila time (the organization time zone; A-KPI-01). */
export function hhmm(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
}

export function shortDate(isoDate: string): string {
  return new Date(isoDate + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function monthLabel(isoDate: string): string {
  return new Date(isoDate + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}
