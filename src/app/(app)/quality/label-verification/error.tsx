"use client";
import { SegmentError } from "@/ui/states";

/** Error state: nothing was changed by the failed load. */
export default function QualityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Label check" reset={reset} />;
}
