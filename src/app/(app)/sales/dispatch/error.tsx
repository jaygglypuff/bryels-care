"use client";
import { SegmentError } from "@/ui/states";

export default function DispatchSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The dispatch page" reset={reset} />;
}
