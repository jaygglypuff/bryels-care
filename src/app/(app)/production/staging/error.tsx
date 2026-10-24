"use client";
import { SegmentError } from "@/ui/states";

export default function ProductionSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The staging page" reset={reset} />;
}
