import Decimal from "decimal.js";

/**
 * The line under "Sales today" (UX audit C #15, round 2 part 2). Today is not over, so a drop against a full
 * yesterday is not bad news: "−95 % vs yesterday" in red alarmed the owner on a quiet morning. Rules:
 * - today ≥ yesterday: "₱X more than yesterday" (good);
 * - yesterday small (under `smallBase`, default ₱1,000) or zero: "Yesterday was quiet (₱X)" (neutral);
 * - otherwise: "Yesterday: ₱X in total (today is not over yet)" (neutral, never red).
 * Pure; `money` formats an amount string. Unit-tested in tests/unit/sales-day-line.test.ts.
 */
export function salesDayLine(today: string | null, yesterday: string | null, money: (v: string) => string, smallBase = "1000"): { text: string; tone: "good" | "neutral" } | null {
  if (today === null || yesterday === null) return null;
  const t = new Decimal(today);
  const y = new Decimal(yesterday);
  if (t.gt(y)) return { text: `${money(t.minus(y).toString())} more than yesterday`, tone: "good" };
  if (t.eq(y)) return { text: "Same as yesterday", tone: "neutral" };
  if (y.lt(smallBase)) return { text: `Yesterday was quiet (${money(y.toString())})`, tone: "neutral" };
  return { text: `Yesterday: ${money(y.toString())} in total (today is not over yet)`, tone: "neutral" };
}
