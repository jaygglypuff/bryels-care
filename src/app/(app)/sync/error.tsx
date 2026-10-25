"use client";
import { SegmentError } from "@/ui/states";

export default function SyncError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="The sync page" reset={reset} />;
}
