"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state: the overview could not be computed; nothing is shown as a number. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="The overview could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      No figures are shown rather than incomplete ones. If this keeps happening, tell your system administrator.
    </Banner>
  );
}
