"use client";
import { useEffect } from "react";

/**
 * Floor screen error state (ADR-084): plain words, nothing to press, and a new try every 30 seconds so a
 * TV recovers on its own after a short outage.
 */
export default function FloorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(reset, 30_000);
    return () => clearTimeout(t);
  }, [reset]);
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-[1.5vw] bg-[var(--bg)] p-[4vw] text-center text-[var(--fg)]">
      <h1 className="font-display text-[3vw] font-bold">The floor screen could not load</h1>
      <p className="max-w-[60vw] text-[1.8vw] text-[var(--fg-2)]">
        It tries again by itself every 30 seconds. If this stays on, tell your system administrator{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
    </main>
  );
}
