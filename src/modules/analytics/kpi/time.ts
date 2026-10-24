/**
 * Period arithmetic of the KPI engine (docs/analytics-kpis.md §1.6). Pure functions, no database and
 * no `server-only`, so the demo seed and the jobs share them. Periods are half-open [from, to) in the
 * scope's time zone (site time zone for one site, organization time zone across sites, A-KPI-01).
 * Day = calendar day, week = Monday to Sunday, month = calendar month.
 */

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(instant: Date, tz: string): string {
  return instant.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Calendar arithmetic on YYYY-MM-DD strings (time-zone free). */
export function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY_MS);
}

export function addMonths(isoDate: string, n: number): string {
  const [y, m] = isoDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Offset (ms) of a time zone from UTC at an instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant local midnight of `isoDate` begins in `tz`. */
export function zonedStart(isoDate: string, tz: string): Date {
  const guess = Date.parse(isoDate + "T00:00:00Z");
  let t = guess - tzOffsetMs(new Date(guess), tz);
  // A second pass settles a DST transition between the guess and the answer.
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Monday of the ISO week containing the date. */
export function weekStart(isoDate: string): string {
  const dow = new Date(isoDate + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((dow + 6) % 7));
}

export function monthStart(isoDate: string): string {
  return isoDate.slice(0, 8) + "01";
}

export type Grain = "day" | "week" | "month";

/** Bucket start of a date for a grain. */
export function bucketStart(isoDate: string, grain: Grain): string {
  return grain === "day" ? isoDate : grain === "week" ? weekStart(isoDate) : monthStart(isoDate);
}

/** Exclusive end of the bucket starting at `start`. */
export function bucketEnd(start: string, grain: Grain): string {
  return grain === "day" ? addDays(start, 1) : grain === "week" ? addDays(start, 7) : addMonths(start, 1);
}

/** A resolved period: local dates [fromDate, toDate) and the instants they begin. */
export type Period = {
  key: string;
  label: string;
  fromDate: string;
  /** Exclusive. */
  toDate: string;
  from: Date;
  to: Date;
  tz: string;
};

export function periodOf(fromDate: string, toDate: string, tz: string, key: string, label: string): Period {
  return { key, label, fromDate, toDate, from: zonedStart(fromDate, tz), to: zonedStart(toDate, tz), tz };
}

export const PERIOD_KEYS = ["today", "week", "month", "last_week", "last_month", "last_30"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  last_week: "Last week",
  last_month: "Last month",
  last_30: "Last 30 days",
};

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === "string" && (PERIOD_KEYS as readonly string[]).includes(v);
}

/**
 * A named dashboard period and the comparison period of the same length immediately before it
 * (week to date → the same weekdays of last week; month to date → the same days of last month).
 */
export function resolvePeriod(key: PeriodKey, now: Date, tz: string): { current: Period; previous: Period } {
  const today = localDate(now, tz);
  const tomorrow = addDays(today, 1);
  const mk = (f: string, t: string, k: string, label: string) => periodOf(f, t, tz, k, label);
  switch (key) {
    case "today":
      return { current: mk(today, tomorrow, key, "Today"), previous: mk(addDays(today, -1), today, "prev", "yesterday") };
    case "week": {
      const ws = weekStart(today);
      return { current: mk(ws, tomorrow, key, "This week"), previous: mk(addDays(ws, -7), addDays(tomorrow, -7), "prev", "the same days last week") };
    }
    case "month": {
      const ms = monthStart(today);
      const pms = addMonths(ms, -1);
      const days = diffDays(tomorrow, ms);
      const prevEnd = addDays(pms, Math.min(days, diffDays(ms, pms)));
      return { current: mk(ms, tomorrow, key, "This month"), previous: mk(pms, prevEnd, "prev", "the same days last month") };
    }
    case "last_week": {
      const ws = addDays(weekStart(today), -7);
      return { current: mk(ws, addDays(ws, 7), key, "Last week"), previous: mk(addDays(ws, -7), ws, "prev", "the week before") };
    }
    case "last_month": {
      const ms = addMonths(monthStart(today), -1);
      return { current: mk(ms, addMonths(ms, 1), key, "Last month"), previous: mk(addMonths(ms, -1), ms, "prev", "the month before") };
    }
    case "last_30":
      return { current: mk(addDays(today, -29), tomorrow, key, "Last 30 days"), previous: mk(addDays(today, -59), addDays(today, -29), "prev", "the 30 days before") };
  }
}

/** As-of instant of a period: its end, or now when the period is still running. */
export function asOfFor(period: Period, now: Date): Date {
  return period.to.getTime() < now.getTime() ? period.to : now;
}

/** Validated YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
}
