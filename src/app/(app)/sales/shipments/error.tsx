"use client";
import { SegmentError } from "@/ui/states";

export default function ShipmentsSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The shipments page" reset={reset} />;
}
