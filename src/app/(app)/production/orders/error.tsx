"use client";
import { SegmentError } from "@/ui/states";

export default function ProductionOrdersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The production orders page" reset={reset} />;
}
