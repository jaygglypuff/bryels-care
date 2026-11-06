import { UserCheck, UsersRound } from "lucide-react";
import { type NextActors, nextActorsSentence } from "@/lib/next-actors-words";
import { cx } from "./core";

/**
 * Who does the next step, by name and role (owner request 2026-11-01; docs/NEXT_APPROVER.md):
 * "Next: Rhea (operator) or Dino (site manager) checks this weighing — they will see it on their Home."
 * Server-safe and client-safe (no hooks). `next` comes from `nextActors` (src/modules/governance/next-actors.ts).
 *
 * - `inline`: a <span> for the "Waiting for" line of `NextStep` / `NextStepBox` and success banners.
 * - default: a small block for success messages and the batch/step cards on the floor.
 */
export function NextApprover({ next, inline = false, className }: { next: NextActors | null | undefined; inline?: boolean; className?: string }) {
  if (!next) return null;
  const text = nextActorsSentence(next);
  const Icon = next.viewer.can ? UserCheck : UsersRound;
  if (inline)
    return (
      <span data-testid="next-approver" data-kind={next.kind} className={className}>
        {text}
      </span>
    );
  return (
    <p data-testid="next-approver" data-kind={next.kind} className={cx("mt-1.5 flex items-start gap-1.5 text-[14px] font-medium", className)}>
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
