"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state: the pipeline could not be computed; no partial counts are shown. */
export default function OperationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="The Operations Center could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      No counts are shown rather than incomplete ones. If this keeps happening, tell your system administrator.
    </Banner>
  );
}
