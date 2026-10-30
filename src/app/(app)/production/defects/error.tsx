"use client";
import { SegmentError } from "@/ui/states";

export default function DefectsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The defects page" reset={reset} />;
}
