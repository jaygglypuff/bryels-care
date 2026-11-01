import Decimal from "decimal.js";

/**
 * ADR-104 §5 words for batches over several days (pure; tests/unit/batch-days.test.ts). Days are plant days in
 * Asia/Manila.
 */
const manilaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysBetween = (from: Date, to: Date) => Math.round((Date.parse(`${manilaDay(to)}T00:00:00Z`) - Date.parse(`${manilaDay(from)}T00:00:00Z`)) / 86_400_000);
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", weekday: "short", day: "numeric", month: "short" });

/** 1 on the day the batch started, 2 the next plant day, … */
export function dayNumber(startedAt: Date, now = new Date()): number {
  return Math.max(1, daysBetween(startedAt, now) + 1);
}

/** "today", "yesterday", "on Mon 3 Nov". */
export function startedWords(at: Date, now = new Date()): string {
  const d = daysBetween(at, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `on ${dayFmt.format(at).replace(",", "")}`;
}

/** "Continue Calamansi Soap B-26-0006 · step 4 · started yesterday" (only for a batch started before today). */
export function continueTitle(productName: string, batchNumber: string, stepIndex: number | null, startedAt: Date | null, now = new Date()): string | null {
  if (!startedAt || daysBetween(startedAt, now) < 1) return null;
  return `Continue ${productName} ${batchNumber}${stepIndex ? ` · step ${stepIndex}` : ""} · started ${startedWords(startedAt, now)}`;
}

const num = (d: Decimal) => Number(d.toString()).toLocaleString("en-PH", { maximumFractionDigits: 3 });

/**
 * "Packed over 3 days: 400 + 350 + 250 = 1,000" from the daily log's good pieces per day (oldest first). One day:
 * "Packed on 1 day: 400". Nothing: null.
 */
export function packedOverDays(byDay: { date: string; good: Decimal.Value }[]): string | null {
  const days = byDay.filter((d) => new Decimal(d.good).gt(0));
  if (!days.length) return null;
  const total = days.reduce((s, d) => s.plus(d.good), new Decimal(0));
  if (days.length === 1) return `Packed on 1 day: ${num(total)}`;
  return `Packed over ${days.length} days: ${days.map((d) => num(new Decimal(d.good))).join(" + ")} = ${num(total)}`;
}
