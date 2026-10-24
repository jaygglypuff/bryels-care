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

// Route `loading.tsx` skeletons were removed (ADR-043): navigation feedback is the shell's
// NavigationProgress (src/ui/navigation-progress.tsx).
