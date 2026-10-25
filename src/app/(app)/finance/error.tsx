"use client";
import { SegmentError } from "@/ui/states";

export default function FinanceSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="This finance page" reset={reset} />;
}
