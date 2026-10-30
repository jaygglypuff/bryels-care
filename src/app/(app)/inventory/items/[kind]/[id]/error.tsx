"use client";
import { SegmentError } from "@/ui/states";

export default function ItemError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="This item" reset={reset} />;
}
