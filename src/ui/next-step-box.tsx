import type { ReactNode } from "react";
import { Callout } from "./kit";

/**
 * "What to do next" when the next step is a form on this page (approve, post, send): the same compact line as
 * `NextStep` (src/ui/guide.tsx, ADR-136 Callout) with the form under it, so the page has exactly one green button for
 * the next step (UX audit round 2 part 2). Server-safe; the form passed as children brings its own server action.
 */
export function NextStepBox({ text, children, waitingFor, className }: { text: ReactNode; children?: ReactNode; waitingFor?: ReactNode; className?: string }) {
  return (
    <Callout id="do" className={className} waitingFor={waitingFor} body={children}>
      {text}
    </Callout>
  );
}
