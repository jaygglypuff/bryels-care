"use client";
import { Banner } from "@/ui/status";
import { Button } from "@/ui/core";

export default function LabelsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner tone="bad" title="Couldn't load labels" action={<Button variant="secondary" onClick={reset}>Try again</Button>}>
      Nothing was changed. If this keeps happening, tell your supervisor.
    </Banner>
  );
}
