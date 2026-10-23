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

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Manila" });
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
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
