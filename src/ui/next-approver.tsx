import { UserCheck, UsersRound } from "lucide-react";
import { type NextActors, nextActorsSentence, othersSentence } from "@/lib/next-actors-words";
import { cx } from "./core";

/**
 * Who does the next step, by name and role (owner request 2026-11-01; docs/NEXT_APPROVER.md):
 * "Next: Rhea (operator) or Dino (site manager) checks this weighing — they will see it on their Home."
 * Server-safe and client-safe (no hooks). `next` comes from `nextActors` (src/modules/governance/next-actors.ts).
 *
 * - `inline`: a <span> for the "Waiting for" line of `NextStep` / `NextStepBox` and success banners.
 * - default: a small block for success messages and the batch/step cards on the floor.
 * - `othersOnly`: under a line that already tells the viewer what to do, only "So can Teresa (QA)." (or the full
 *   sentence when the viewer cannot do it), so the owner still sees the names.
 */
export function NextApprover({ next, inline = false, othersOnly = false, className }: { next: NextActors | null | undefined; inline?: boolean; othersOnly?: boolean; className?: string }) {
  if (!next) return null;
  const text = othersOnly ? othersSentence(next) : nextActorsSentence(next);
  if (!text) return null;
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
