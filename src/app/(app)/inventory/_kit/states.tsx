"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state: nothing partial is shown; retry re-renders the segment. */
export function PageError({ what, reset }: { what: string; reset: () => void }) {
  return (
    <Banner tone="bad" title={`${what} could not be loaded`} action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your system administrator.
    </Banner>
  );
}
