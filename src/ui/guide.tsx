import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, HelpCircle, Hourglass } from "lucide-react";
import { cx } from "./core";

/**
 * The "spoon-feeding" building blocks (ADR-088, grade-5 standard). Every screen uses the same few:
 * - `PageIntro`: one sentence under the title — what this screen is for.
 * - `NextStep`: the one thing to do now, with one green button; or who we are waiting for.
 * - `MoreDetails`: everything that is not needed on most days, folded away.
 * - `Explain`: "What is this?" for the few industry words we keep (lot, batch, quality check, batch record, INCI, version).
 * Server-safe (no hooks): <details> does the folding.
 */

export function PageIntro({ children }: { children: ReactNode }) {
  return <p className="-mt-3 mb-4 max-w-[70ch] text-[15px] leading-snug text-fg-2">{children}</p>;
}

export function NextStep({
  text,
  action,
  waitingFor,
  className,
}: {
  /** One sentence: what to do now ("Next: weigh the coconut oil (1 of 5)"). */
  text: ReactNode;
  /** The one button (a link). Leave out when the user cannot act. */
  action?: { label: string; href: string };
  /** When someone else must act: "Dino (manager) approves this next." */
  waitingFor?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label="What to do next" className={cx("mb-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-[var(--brand-200)] bg-[var(--brand-50)] p-4", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-primary-text">What to do next</p>
        <p className="mt-0.5 text-[16px] font-medium text-fg">{text}</p>
        {waitingFor && (
          <p className="mt-1 flex items-center gap-1.5 text-[14px] text-fg-2">
            <Hourglass size={14} aria-hidden /> {waitingFor}
          </p>
        )}
      </div>
      {action && (
        <Link href={action.href} className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-cta px-5 text-[15px] font-semibold text-white">
          {action.label} <ArrowRight size={16} aria-hidden />
        </Link>
      )}
    </section>
  );
}

export function MoreDetails({ title = "More details (you can skip this)", open = false, children }: { title?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="rounded-[14px] border border-line bg-surface-2/40 px-3.5 py-1" open={open}>
      <summary className="min-h-[48px] cursor-pointer py-3 text-[14px] font-medium text-fg-2">{title}</summary>
      <div className="flex flex-col gap-4 pb-3 pt-1">{children}</div>
    </details>
  );
}

/** Plain explanations of the few industry words we keep (one source, PRD glossary). */
export const EXPLAIN: Record<string, string> = {
  lot: "A lot is one delivery (or one batch) of something, with its own expiry date. Every sack or box label shows its lot number.",
  batch: "A batch is one round of making a product, for example one pot of soap.",
  quality_check: "Before anything is used or sold, the QA person checks it and says OK or not OK.",
  batch_record: "The batch record (BMR) is the paper that shows how a batch was made: who weighed what, readings and checks.",
  inci: "INCI is the official name of an ingredient that goes on the product label.",
  version: "A recipe or a list of steps can change over time. Each change is a new version; old batches keep the version they used.",
};

export function Explain({ term, label }: { term: keyof typeof EXPLAIN | string; label?: string }) {
  const text = EXPLAIN[term];
  if (!text) return null;
  return (
    <details className="inline-block align-middle">
      <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-primary-text">
        <HelpCircle size={14} aria-hidden /> {label ?? "What is this?"}
      </summary>
      <p className="mt-1 max-w-[46ch] rounded-[12px] border border-line bg-surface p-3 text-[14px] text-fg-2">{text}</p>
    </details>
  );
}
