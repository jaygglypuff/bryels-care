"use client";
import { Banner } from "@/ui/status";
import { Button, LinkButton } from "@/ui/core";

/**
 * App-wide error state (UX_AUDIT UX-24): any page without its own boundary shows this instead of a
 * blank screen. Nothing was saved by the failed render; the reference helps the administrator find it.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner
      tone="bad"
      title="This page could not be loaded"
      action={
        <span className="flex gap-2">
          <Button variant="secondary" onClick={reset}>Try again</Button>
          <LinkButton href="/dashboard" variant="secondary">Go home</LinkButton>
        </span>
      }
    >
      Try again in a moment. If this keeps happening, tell your system administrator{error.digest ? ` and give them reference ${error.digest}` : ""}.
    </Banner>
  );
}
