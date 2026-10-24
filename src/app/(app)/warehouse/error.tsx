"use client";
import { SegmentError } from "@/ui/states";

export default function WarehouseSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The boxing page" reset={reset} />;
}
