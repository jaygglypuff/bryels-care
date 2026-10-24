import { addDays, isoWeekday, localDate } from "./params";

/**
 * Schedule cadence arithmetic (A-W3B-04): daily, weekly (ISO weekday) or monthly (day 1–28) at a
 * local time in the schedule's time zone. Pure functions, unit-testable without a database.
 */
export type Cadence = { cadence: "daily" | "weekly" | "monthly"; runAtTime: string; weekday: number | null; monthDay: number | null; timezone: string };

/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of local date `iso` at `hhmm` in `tz`. */
export function zonedInstant(iso: string, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), h, m);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

function matches(c: Cadence, iso: string) {
  if (c.cadence === "daily") return true;
  if (c.cadence === "weekly") return isoWeekday(iso) === c.weekday;
  return Number(iso.slice(8, 10)) === c.monthDay;
}

/** The first scheduled instant strictly after `after`. */
export function nextRunAfter(c: Cadence, after: Date): Date {
  let day = localDate(after, c.timezone);
  for (let i = 0; i < 70; i++) {
    if (matches(c, day)) {
      const at = zonedInstant(day, c.runAtTime, c.timezone);
      if (at.getTime() > after.getTime()) return at;
    }
    day = addDays(day, 1);
  }
  throw new Error("No run time found within 70 days");
}

/** Period key of a due slot: its local date and time, e.g. 2026-10-26T07:00 (one delivery per slot). */
export function slotKey(at: Date, tz: string): string {
  const d = localDate(at, tz);
  const t = at.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${d}T${t}`;
}

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function describeCadence(c: Cadence): string {
  if (c.cadence === "daily") return `Every day at ${c.runAtTime} (${c.timezone})`;
  if (c.cadence === "weekly") return `Every ${WEEKDAYS[c.weekday ?? 1]} at ${c.runAtTime} (${c.timezone})`;
  return `Monthly on day ${c.monthDay} at ${c.runAtTime} (${c.timezone})`;
}
