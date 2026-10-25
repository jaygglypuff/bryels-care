"use client";
import { SegmentError } from "@/ui/states";

/** Error state of the procurement screens: nothing was changed by the failed load. */
export default function ProcurementError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Procurement" reset={reset} />;
}
