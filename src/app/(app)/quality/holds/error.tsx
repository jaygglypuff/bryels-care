"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state: nothing was changed by the failed load. */
export default function ReceivingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="This page could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. Try again; if it keeps happening, tell the QA lead or your system administrator.
    </Banner>
  );
}
