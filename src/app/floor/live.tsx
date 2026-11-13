"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

/**
 * Floor screen live parts (ADR-084, ADR-135, docs/FLOOR_DISPLAY.md §4): the header clock, the connection pill with the
 * 30-second refresh, and the page rotation. The page is server-rendered; this only asks the server for a fresh render
 * every 30 s and says how fresh the data is. When the data gets older than two refreshes (network down, server
 * unreachable) the pill says "No internet — showing hh:mm data" instead of pretending to be live.
 * Times are shown in the plant's time zone, whatever the TV's own clock setting.
 */

export const FLOOR_REFRESH_MS = 30_000;
/** ADR-135: when there are more batches or orders than fit, the panel shows the next page every 12 seconds. */
export const FLOOR_PAGE_MS = 12_000;
const STALE_MS = 75_000;
const TZ = "Asia/Manila";

const clockDay = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const clockTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

function useNow(initial: string, everyMs = 1000) {
  const [now, setNow] = useState(() => new Date(initial));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Big "10:42" with "Thursday 30 October" under it (live). */
export function FloorClock({ serverNow }: { serverNow: string }) {
  const now = useNow(serverNow);
  return (
    <>
      <div className="tv-xl tabular font-display font-bold" suppressHydrationWarning>
        {clockTime.format(now)}
      </div>
      <div className="tv-xs text-[var(--fg-2)]" suppressHydrationWarning>
        {clockDay.format(now).replace(",", "")}
      </div>
    </>
  );
}

/** Refreshes the server render every 30 s; shows "Live · updated 10:42" or "No internet — showing 10:42 data". */
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
      <span role="status" className="tv-pill tv-bad tv-s" data-testid="floor-connection" data-state="offline" suppressHydrationWarning>
        <svg aria-hidden viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" />
        </svg>
        No internet — showing {clockTime.format(at)} data
      </span>
    );
  return (
    <span role="status" className="tv-pill tv-ok tv-live tv-s" data-testid="floor-connection" data-state="live" suppressHydrationWarning>
      <span className="tv-dot" aria-hidden />
      Live
      <span className="font-normal">· updated {clockTime.format(at)}</span>
    </span>
  );
}

/**
 * Shows one page at a time and turns to the next every 12 s (ADR-135: more items than fit rotate; nothing scrolls).
 * The pages are rendered on the server; a fresh render keeps the current page when it still exists. The dots say
 * which page is showing ("page 1 of 2" for screen readers).
 */
export function FloorPages({ pages, label }: { pages: ReactNode[]; label: string }) {
  const [i, setI] = useState(0);
  const n = pages.length;
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), FLOOR_PAGE_MS);
    return () => clearInterval(t);
  }, [n]);
  const at = n ? i % n : 0;
  return (
    <>
      <div key={at} className="tv-page flex min-h-0 flex-1 flex-col" data-testid="floor-page" data-page={at + 1} data-pages={n}>
        {pages[at]}
      </div>
      {n > 1 && <PageDots at={at} n={n} label={label} />}
    </>
  );
}

function PageDots({ at, n, label }: { at: number; n: number; label: string }) {
  return (
    <div className="tv-xs flex items-center justify-end text-[var(--fg-2)]" aria-label={`${label}: page ${at + 1} of ${n}`}>
      Page {at + 1} of {n}
      <span className="tv-dots" aria-hidden>
        {Array.from({ length: n }, (_, k) => (
          <span key={k} data-on={k === at} />
        ))}
      </span>
    </div>
  );
}
