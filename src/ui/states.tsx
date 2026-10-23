"use client";
import { Button } from "./core";
import { Banner } from "./status";

/** Error state for a route segment (error.tsx): plain words, a retry, never a stack trace. */
export function SegmentError({ what, reset }: { what: string; reset: () => void }) {
  return (
    <Banner tone="bad" title={`${what} could not be loaded`} action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your system administrator.
    </Banner>
  );
}

/** Loading skeleton for list pages (loading.tsx). */
export function ListSkeleton({ label, cards = 3 }: { label: string; cards?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading {label}…</span>
      <div className="h-8 w-56 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="h-[110px] animate-pulse rounded-[16px] border border-line bg-surface" />
        ))}
      </div>
      <div className="h-[320px] animate-pulse rounded-[16px] border border-line bg-surface" />
    </div>
  );
}
