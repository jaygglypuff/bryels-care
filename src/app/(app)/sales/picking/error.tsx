"use client";
import { SegmentError } from "@/ui/states";

export default function PickingSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The picking page" reset={reset} />;
}
