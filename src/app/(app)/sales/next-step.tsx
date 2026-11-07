import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Hourglass } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { NextStep } from "@/ui/guide";
import { buttonClass, cx } from "@/ui/core";
import { TEAM_OF_PERMISSION, whoWords } from "./who-words";

/**
 * "What to do next" on sales records (ADR-088). Same look as `NextStep` (src/ui/guide.tsx); when the next
 * step is a one-click command (a server-action form such as "Send for approval"), the form is passed as
 * `children` and becomes the one green button; a link `action` becomes the same green button. Without either, `NextStep` itself.
 */
export function DoNext({ text, waitingFor, action, children }: { text: ReactNode; waitingFor?: ReactNode; action?: { label: string; href: string }; children?: ReactNode }) {
  if (!children && !action) return <NextStep text={text} waitingFor={waitingFor} />;
  // A link goes below the sentence on phones (NextStep puts it beside, which squeezes the words at 390 px).
  const button = children ?? (
    <Link href={action!.href} className={cx(buttonClass("cta"), "w-full font-semibold sm:w-auto")}>
      {action!.label} <ArrowRight size={16} aria-hidden />
    </Link>
  );
  return (
    <section aria-label="What to do next" className="mb-4 flex flex-col gap-3 rounded-[16px] border border-[var(--brand-200)] bg-[var(--brand-50)] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-label font-semibold text-primary-text">What to do next</p>
        <p className="mt-0.5 text-[15px] font-medium leading-snug text-fg">{text}</p>
        {waitingFor && (
          <p className="mt-1 flex items-center gap-1.5 text-meta text-fg-2">
            <Hourglass size={14} aria-hidden /> {waitingFor}
          </p>
        )}
      </div>
      <div className="min-w-0 sm:w-auto [&_button]:min-h-[44px] [&_button]:w-full sm:[&_button]:w-auto">{button}</div>
    </section>
  );
}

/**
 * The people who can do a step, by name: "Dino Reyes (Site Manager)" or "Dino Reyes (Site Manager) or Ana
 * Cruz (Finance)". Falls back to the role names, then to `fallback`. Read-only (uses `whoCanDo`, ADR-073).
 */
export async function whoDoes(ctx: AuthContext, permission: string, siteId: string | null, fallback: string): Promise<string> {
  const w = await whoCanDo(ctx, permission, siteId).catch(() => ({ roles: [] as string[], people: [] as { name: string; role: string }[] }));
  // Re-audit B N5: warehouse steps name the warehouse people first and never say "another production operator".
  return whoWords(w.people, w.roles, fallback, TEAM_OF_PERMISSION[permission] ?? null);
}
