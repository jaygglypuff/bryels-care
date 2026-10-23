"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Loading skeleton shared by the W1C inventory pages. */
export function PageSkeleton({ what }: { what: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading {what}…</span>
      <div className="h-8 w-56 animate-pulse rounded-[10px] bg-surface-2" />
      <div className="h-[120px] animate-pulse rounded-[24px] bg-surface" />
      <div className="h-[260px] animate-pulse rounded-[24px] bg-surface" />
    </div>
  );
}

/** Error state: nothing partial is shown; retry re-renders the segment. */
export function PageError({ what, reset }: { what: string; reset: () => void }) {
  return (
    <Banner tone="bad" title={`${what} could not be loaded`} action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your system administrator.
    </Banner>
  );
}
