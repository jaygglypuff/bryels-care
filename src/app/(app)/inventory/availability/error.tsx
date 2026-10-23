"use client";
import { SegmentError } from "@/ui/states";

export default function AvailabilityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Stock availability" reset={reset} />;
}
