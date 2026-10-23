"use client";
import { SegmentError } from "@/ui/states";

export default function NotificationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="Your notifications" reset={reset} />;
}
