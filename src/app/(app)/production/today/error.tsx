"use client";
import { SegmentError } from "@/ui/states";

export default function TodayError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The Today page" reset={reset} />;
}
