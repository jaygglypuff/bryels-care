"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Floor screen live parts (ADR-084, docs/FLOOR_DISPLAY.md §4): the header clock and the 30-second
 * refresh. The page is server-rendered; this only asks the server for a fresh render every 30 s and
 * says how fresh the data is. When the data gets older than two refreshes (network down, server
 * unreachable) it says "Connection lost — showing hh:mm data" instead of pretending to be live.
 * Times are shown in the plant's time zone, whatever the TV's own clock setting.
 */

export const FLOOR_REFRESH_MS = 30_000;
const STALE_MS = 75_000;
const TZ = "Asia/Manila";

const clockDay = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" });
const clockTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const secTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function useNow(initial: string, everyMs = 1000) {
  const [now, setNow] = useState(() => new Date(initial));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "Thursday 30 Oct · 10:42" (live). */
export function FloorClock({ serverNow }: { serverNow: string }) {
  const now = useNow(serverNow);
  return (
    <span className="tabular" suppressHydrationWarning>
      {clockDay.format(now).replace(",", "")} · {clockTime.format(now)}
    </span>
  );
}

/** Refreshes the server render every 30 s and shows "Updated hh:mm:ss" or the connection-lost notice. */
export function FloorRefresher({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const now = useNow(generatedAt, 5000);

  useEffect(() => {
    const tick = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      startTransition(() => router.refresh());
    };
    const t = setInterval(tick, FLOOR_REFRESH_MS);
    const up = () => {
      setOnline(true);
      tick();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    setOnline(navigator.onLine !== false);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [router]);

  const at = new Date(generatedAt);
  const stale = !online || now.getTime() - at.getTime() > STALE_MS;
  if (stale)
    return (
      <span role="status" className="inline-flex items-center gap-[0.5vw] rounded-full border-2 border-[var(--bad-bd)] bg-[var(--bad-bg)] px-[0.8vw] py-[0.2vw] font-semibold text-[var(--bad-fg)]" suppressHydrationWarning>
        <svg aria-hidden viewBox="0 0 24 24" className="h-[1.2em] w-[1.2em]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M3 3l18 18" />
        </svg>
        Connection lost — showing {clockTime.format(at)} data
      </span>
    );
  return (
    <span role="status" className="tabular" suppressHydrationWarning>
      Updated {secTime.format(at)}
    </span>
  );
}
