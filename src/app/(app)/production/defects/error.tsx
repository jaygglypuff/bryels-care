"use client";
import { SegmentError } from "@/ui/states";

export default function DefectsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The rejects page" reset={reset} />;
}
