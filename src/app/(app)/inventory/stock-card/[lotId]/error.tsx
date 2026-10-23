"use client";
import { SegmentError } from "@/ui/states";

export default function StockCardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The stock card" reset={reset} />;
}
