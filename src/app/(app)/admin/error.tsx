"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

/** Error state for the administration pages. */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="This page could not be loaded" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      If this keeps happening, tell your system administrator.
    </Banner>
  );
}
