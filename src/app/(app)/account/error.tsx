"use client";
import { SegmentError } from "@/ui/states";

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Your account" reset={reset} />;
}
