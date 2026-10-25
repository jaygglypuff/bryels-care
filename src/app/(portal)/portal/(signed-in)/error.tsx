"use client";
import { Button } from "@/ui/core";
import { Banner } from "@/ui/status";

/** Error state of every signed-in portal page: plain words, a retry, never a stack trace. */
export default function PortalSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="This page could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, contact your Bryel&apos;s Care sales representative.
    </Banner>
  );
}
