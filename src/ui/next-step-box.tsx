import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { cx } from "./core";

/**
 * "What to do next" when the next step is a form on this page (approve, post, send): the same look as `NextStep`
 * (src/ui/guide.tsx) but the form sits inside the box, so the page has exactly one green button for the next step
 * (UX audit round 2 part 2: no "What to do next" link plus a second green button in a "Do it now" card).
 * Server-safe; the form passed as children brings its own server action.
 */
export function NextStepBox({ text, children, waitingFor, className }: { text: ReactNode; children?: ReactNode; waitingFor?: ReactNode; className?: string }) {
  return (
    <section id="do" aria-label="What to do next" className={cx("mb-4 scroll-mt-24 rounded-[16px] border border-[var(--brand-200)] bg-[var(--brand-50)] px-4 py-3", className)}>
      <p className="text-label font-semibold text-primary-text">What to do next</p>
      <p className="mt-0.5 text-[15px] font-medium leading-snug text-fg">{text}</p>
      {waitingFor && (
        <p className="mt-1 flex items-center gap-1.5 text-meta text-fg-2">
          <Hourglass size={14} aria-hidden /> {waitingFor}
        </p>
      )}
      {children && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </section>
  );
}
