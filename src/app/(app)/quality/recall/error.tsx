"use client";
import { SegmentError } from "@/ui/states";

/** Error state: the explorer only reads; nothing was changed by the failed load. */
export default function RecallError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Recall explorer" reset={reset} />;
}
