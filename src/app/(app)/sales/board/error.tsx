"use client";
import { SegmentError } from "@/ui/states";

export default function SalesSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="This sales page" reset={reset} />;
}
