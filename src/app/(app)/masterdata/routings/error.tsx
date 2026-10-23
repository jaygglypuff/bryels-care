"use client";
import { EngError } from "../_eng/ui";

/** Error state (routings): nothing was changed; offer a retry. */
export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <EngError reset={reset} />;
}
