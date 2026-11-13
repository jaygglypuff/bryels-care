"use client";
import { useEffect } from "react";
import "./floor.css";

/**
 * Floor screen error state (ADR-084, ADR-135 look): plain words, nothing to press, and a new try every 30 seconds so a
 * TV recovers on its own after a short outage.
 */
export default function FloorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(reset, 30_000);
    return () => clearTimeout(t);
  }, [reset]);
  return (
    <main className="tv items-center justify-center text-center">
      <h1 className="tv-xl font-display font-bold">The floor screen could not load</h1>
      <p className="tv-m max-w-[60vw] text-[var(--fg-2)]">
        It tries again by itself every 30 seconds. If this stays on, tell your system administrator{error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
    </main>
  );
}
