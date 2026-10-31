"use client";
import { SegmentError } from "@/ui/states";

/** Error state (units of measure): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Units" reset={reset} />;
}
