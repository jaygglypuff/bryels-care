"use client";
import { SegmentError } from "@/ui/states";

/** Error state for every analytics page: no partial figures are shown. */
export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The analytics figures" reset={reset} />;
}
