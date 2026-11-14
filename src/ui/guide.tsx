import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, HelpCircle } from "lucide-react";
import { buttonClass } from "./core";
import { IntroClamp } from "./intro-clamp";
import { Callout } from "./kit";

/**
 * The "spoon-feeding" building blocks (ADR-088, grade-5 standard; ADR-136 look). Every screen uses the same few:
 * - `PageIntro`: one sentence — what this screen is for. ADR-136: where the frame has its Help "?" (office roles), the
 *   sentence is not printed under the title any more; the "?" panel shows it first ("About this screen"). Floor roles,
 *   who have no frame "?", still read it under the title.
 * - `NextStep`: the one thing to do now, as one compact line with one green button; or who we are waiting for.
 * - `MoreDetails`: everything that is not needed on most days, folded away.
 * - `Explain`: "What is this?" for the few industry words we keep (lot, batch, quality check, batch record, INCI, version).
 * Server-safe (no hooks): <details> does the folding.
 */

/** Harmony pass (owner 2026-11-08): small and one line ("more" opens the rest). ADR-136: hidden where the frame "?" holds it. */
export function PageIntro({ children }: { children: ReactNode }) {
  return (
    <div className="page-intro -mt-3 mb-4 max-w-[70ch] text-[14px] leading-[20px] text-fg-2" data-page-intro>
      <IntroClamp>{children}</IntroClamp>
    </div>
  );
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
    <Callout
      className={className}
      waitingFor={waitingFor}
      action={
        action &&
        (action.href.startsWith("#") ? (
          // ADR-123: a jump to the form further down this page is not a second green button: the form's own button
          // (Decide, Record service…) is the one green button, so the jump is an outlined button with a down arrow.
          <Link href={action.href} className={buttonClass("secondary", "sm")} data-jump="true">
            {action.label} <ArrowDown size={14} aria-hidden />
          </Link>
        ) : (
          <Link href={action.href} className={buttonClass("cta", "sm")}>
            {action.label} <ArrowRight size={14} aria-hidden />
          </Link>
        ))
      }
    >
      {text}
    </Callout>
  );
}

export function MoreDetails({ title = "More details (you can skip this)", open = false, children }: { title?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="rounded-[8px] border border-line bg-surface px-4 py-0.5" open={open}>
      <summary className="flex min-h-[40px] cursor-pointer items-center py-2 text-[14px] font-medium text-fg-2 pointer-coarse:min-h-[44px]">{title}</summary>
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
      <summary className="-ml-1 inline-flex min-h-[36px] cursor-pointer list-none items-center gap-1.5 rounded-[6px] px-2 text-[14px] font-medium text-primary-text hover:bg-surface-3 pointer-coarse:min-h-[44px] [&::-webkit-details-marker]:hidden">
        <HelpCircle size={14} aria-hidden /> {label ?? "What is this?"}
      </summary>
      <p className="mt-1 max-w-[46ch] rounded-[8px] border border-line bg-surface p-3 text-[14px] text-fg-2">{text}</p>
    </details>
  );
}
