"use client";
import { SegmentError } from "@/ui/states";

/** Error state (warehouses): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Warehouses" reset={reset} />;
}
