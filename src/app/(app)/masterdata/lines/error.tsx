"use client";
import { SegmentError } from "@/ui/states";

/** Error state (production lines): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Production lines" reset={reset} />;
}
