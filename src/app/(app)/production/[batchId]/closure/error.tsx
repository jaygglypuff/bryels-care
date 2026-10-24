"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state for the closure page: nothing was changed by the failed load. */
export default function ClosureError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="The closure page could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your system administrator.
    </Banner>
  );
}
