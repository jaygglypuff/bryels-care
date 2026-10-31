"use client";
import { SegmentError } from "@/ui/states";

/** Error state (reason codes): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Reasons" reset={reset} />;
}
