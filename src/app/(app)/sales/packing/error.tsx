"use client";
import { SegmentError } from "@/ui/states";

export default function PackingSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The pack verification page" reset={reset} />;
}
