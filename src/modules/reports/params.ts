import { DomainError } from "@/lib/errors";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset, type ReportDefinition, type ResolvedPeriod } from "./types";

/**
 * Parameter parsing and period resolution for reports. Periods are local calendar dates of the
 * organization's time zone, half-open [from, toExclusive) (docs/analytics-kpis.md §1.6); weeks run
 * Monday to Sunday. Presets resolve against the run time, so a schedule with "previous_week" always
 * reports the week before its delivery.
 */

const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function localDate(now: Date, tz: string): string {
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}

/** ISO weekday 1 = Monday … 7 = Sunday of a YYYY-MM-DD date. */
export function isoWeekday(iso: string): number {
  const d = new Date(iso + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

/** ISO week key, e.g. 2026-W43, of a YYYY-MM-DD date. */
export function isoWeekKey(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const thursday = new Date(d.getTime() + (4 - isoWeekday(iso)) * DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}

function nextMonthStart(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function prevMonthStart(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

export function resolvePeriod(preset: PeriodPreset, today: string, custom?: { from?: string; to?: string }): ResolvedPeriod {
  const fmt = (from: string, toEx: string) => (addDays(toEx, -1) === from ? from : `${from} to ${addDays(toEx, -1)}`);
  let from: string;
  let toExclusive: string;
  switch (preset) {
    case "today":
      [from, toExclusive] = [today, addDays(today, 1)];
      break;
    case "yesterday":
      [from, toExclusive] = [addDays(today, -1), today];
      break;
    case "last_7_days":
      [from, toExclusive] = [addDays(today, -6), addDays(today, 1)];
      break;
    case "last_30_days":
      [from, toExclusive] = [addDays(today, -29), addDays(today, 1)];
      break;
    case "this_week": {
      const monday = addDays(today, 1 - isoWeekday(today));
      [from, toExclusive] = [monday, addDays(monday, 7)];
      break;
    }
    case "previous_week": {
      const monday = addDays(today, 1 - isoWeekday(today) - 7);
      [from, toExclusive] = [monday, addDays(monday, 7)];
      break;
    }
    case "this_month":
      [from, toExclusive] = [monthStart(today), nextMonthStart(today)];
      break;
    case "previous_month":
      [from, toExclusive] = [prevMonthStart(today), monthStart(today)];
      break;
    case "custom": {
      const f = custom?.from ?? "";
      const t = custom?.to ?? "";
      const fieldErrors: Record<string, string> = {};
      if (!DATE_RE.test(f) || Number.isNaN(Date.parse(f))) fieldErrors.from = "Enter a start date (YYYY-MM-DD).";
      if (!DATE_RE.test(t) || Number.isNaN(Date.parse(t))) fieldErrors.to = "Enter an end date (YYYY-MM-DD).";
      if (!fieldErrors.from && !fieldErrors.to && t < f) fieldErrors.to = "The end date is before the start date.";
      if (!fieldErrors.from && !fieldErrors.to && (Date.parse(t) - Date.parse(f)) / DAY > 366 * 3) fieldErrors.to = "Choose at most three years.";
      if (Object.keys(fieldErrors).length) throw new DomainError("validation", "Check the dates.", { fieldErrors });
      [from, toExclusive] = [f, addDays(t, 1)];
      break;
    }
  }
  return { preset, from, toExclusive, label: `${PERIOD_LABELS[preset]} · ${fmt(from, toExclusive)}` };
}

export type ParsedParams = {
  values: Record<string, string | number>;
  period: ResolvedPeriod | null;
  /** Requested site, or null for every site the viewer may see for this report. */
  siteId: string | null;
  /** Canonical, storable form (for schedules and links). */
  canonical: Record<string, string>;
};

const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : v === undefined || v === null ? "" : String(v)).trim();

/** Validates raw values (URL search params or stored schedule parameters) against the report's fields. */
export function parseParams(def: ReportDefinition, raw: Record<string, unknown>, today: string): ParsedParams {
  const fieldErrors: Record<string, string> = {};
  const values: Record<string, string | number> = {};
  const canonical: Record<string, string> = {};
  const site = str(raw.site);
  if (site && site !== "all" && !UUID_RE.test(site)) fieldErrors.site = "Choose a site from the list.";
  if (site && site !== "all") canonical.site = site;
  let period: ResolvedPeriod | null = null;
  for (const f of def.params) {
    const v = str(raw[f.name]);
    if (f.kind === "period") {
      const preset = (v || f.default) as PeriodPreset;
      if (!(PERIOD_PRESETS as readonly string[]).includes(preset)) {
        fieldErrors.period = "Choose a period from the list.";
        continue;
      }
      try {
        period = resolvePeriod(preset, today, { from: str(raw.from), to: str(raw.to) });
        canonical.period = preset;
        if (preset === "custom") {
          canonical.from = str(raw.from);
          canonical.to = str(raw.to);
        }
      } catch (e) {
        if (e instanceof DomainError && e.details?.fieldErrors) Object.assign(fieldErrors, e.details.fieldErrors as Record<string, string>);
        else throw e;
      }
    } else if (f.kind === "select") {
      const value = v || f.default;
      if (!f.options.some((o) => o.value === value)) fieldErrors[f.name] = `Choose a ${f.label.toLowerCase()} from the list.`;
      else {
        values[f.name] = value;
        if (value !== f.default) canonical[f.name] = value;
      }
    } else if (f.kind === "text") {
      if (v.length > f.maxLength) fieldErrors[f.name] = `Use at most ${f.maxLength} characters.`;
      else if (v) {
        values[f.name] = v;
        canonical[f.name] = v;
      }
    } else {
      const n = v === "" ? f.default : Number(v);
      if (!Number.isInteger(n) || n < f.min || n > f.max) fieldErrors[f.name] = `Enter a whole number from ${f.min} to ${f.max}.`;
      else {
        values[f.name] = n;
        if (n !== f.default) canonical[f.name] = String(n);
      }
    }
  }
  const known = new Set(["site", "from", "to", "format", ...def.params.map((p) => p.name)]);
  for (const k of Object.keys(raw)) if (!known.has(k)) fieldErrors[k] = "Unknown filter.";
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", "Check the report filters.", { fieldErrors });
  return { values, period, siteId: site && site !== "all" ? site : null, canonical };
}

/** Human description of the filters as entered, for the output header. */
export function describeFilters(def: ReportDefinition, p: ParsedParams, siteLabel: string): [string, string][] {
  const out: [string, string][] = [["Sites", siteLabel]];
  if (p.period) out.push(["Period", p.period.label]);
  for (const f of def.params) {
    if (f.kind === "period") continue;
    const v = p.values[f.name];
    if (f.kind === "select") out.push([f.label, f.options.find((o) => o.value === v)?.label ?? String(v)]);
    else if (f.kind === "text") out.push([f.label, v === undefined ? "any" : String(v)]);
    else out.push([f.label, String(v)]);
  }
  return out;
}
