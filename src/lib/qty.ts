import Decimal from "decimal.js";

/** Decimal helpers: never use floating point for quantities or money (ADR-010). */
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

export function fmtQty(v: Decimal.Value | null | undefined, uom = "", dp = 1): string {
  const d = D(v);
  const s = d.toNumber().toLocaleString("en-PH", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return uom ? `${s} ${uom}` : s;
}

/** Shows grams as kg when ≥ 1,000 g. */
export function fmtMass(g: Decimal.Value | null | undefined): string {
  const d = D(g);
  return d.abs().gte(1000) ? fmtQty(d.div(1000), "kg", 2) : fmtQty(d, "g", 1);
}

export function fmtMoney(v: Decimal.Value | null | undefined): string {
  return "₱" + D(v).toNumber().toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Month names spelled here, not by the runtime (ADR-125 item 5): client components format dates on the server and
 * again in the browser, and ICU versions differ ("Sep" in older browsers, "Sept" in Node 22), which React reports as a
 * hydration mismatch. "Sept" keeps what the server has printed so far (labels, documents). Only the calendar numbers
 * come from Intl, which every runtime gives the same.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"] as const;
const partsFormat = new Map<string, Intl.DateTimeFormat>();

function calendarParts(d: Date, timeZone: "Asia/Manila" | "UTC"): { y: string; m: number; d: number; hh: string; mm: string } | null {
  if (Number.isNaN(d.getTime())) return null;
  let f = partsFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
    partsFormat.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: Number(p.month), d: Number(p.day), hh: p.hour === "24" ? "00" : p.hour, mm: p.minute };
}

/** "05 Nov 2026" in Manila; "—" when empty or not a date. */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const c = calendarParts(typeof v === "string" ? new Date(v) : v, "Asia/Manila");
  return c ? `${String(c.d).padStart(2, "0")} ${MONTHS[c.m - 1]} ${c.y}` : "—";
}

/** "11 Nov" (a calendar date such as "2026-11-11", or a moment shown in Manila time); "—" when empty. */
export function fmtDayMonth(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const dateOnly = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = typeof v === "string" ? new Date(dateOnly ? `${v}T00:00:00Z` : v) : v;
  const c = calendarParts(d, dateOnly ? "UTC" : "Asia/Manila");
  return c ? `${c.d} ${MONTHS[c.m - 1]}` : "—";
}

/** "05 Nov 2026, 14:07" in Manila (24 h); "—" when empty or not a date. */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const c = calendarParts(typeof v === "string" ? new Date(v) : v, "Asia/Manila");
  return c ? `${String(c.d).padStart(2, "0")} ${MONTHS[c.m - 1]} ${c.y}, ${c.hh}:${c.mm}` : "—";
}

/**
 * Calendar days from today (Asia/Manila) to a date: 0 = today, 1 = tomorrow, -1 = yesterday.
 * Matches the ledger and QA rules, where a lot is usable through the end of its expiry day.
 */
export function daysUntil(date: string | null | undefined, from = new Date()): number | null {
  if (!date) return null;
  const today = from.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return Math.round((Date.parse(String(date).slice(0, 10) + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}
