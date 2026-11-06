"use client";
import { SegmentError } from "@/ui/states";

/** Error state (locations): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Shelves and areas" reset={reset} />;
}
