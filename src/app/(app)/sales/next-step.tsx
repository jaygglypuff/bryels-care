import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Hourglass } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { NextStep } from "@/ui/guide";

/**
 * "What to do next" on sales records (ADR-088). Same look as `NextStep` (src/ui/guide.tsx); when the next
 * step is a one-click command (a server-action form such as "Send for approval"), the form is passed as
 * `children` and becomes the one green button; a link `action` becomes the same green button. Without either, `NextStep` itself.
 */
export function DoNext({ text, waitingFor, action, children }: { text: ReactNode; waitingFor?: ReactNode; action?: { label: string; href: string }; children?: ReactNode }) {
  if (!children && !action) return <NextStep text={text} waitingFor={waitingFor} />;
  // A link goes below the sentence on phones (NextStep puts it beside, which squeezes the words at 390 px).
  const button = children ?? (
    <Link href={action!.href} className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-cta px-5 text-[15px] font-semibold text-white sm:w-auto">
      {action!.label} <ArrowRight size={16} aria-hidden />
    </Link>
  );
  return (
    <section aria-label="What to do next" className="mb-4 flex flex-col gap-3 rounded-[16px] border border-[var(--brand-200)] bg-[var(--brand-50)] p-4 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-primary-text">What to do next</p>
        <p className="mt-0.5 text-[16px] font-medium text-fg">{text}</p>
        {waitingFor && (
          <p className="mt-1 flex items-center gap-1.5 text-[14px] text-fg-2">
            <Hourglass size={14} aria-hidden /> {waitingFor}
          </p>
        )}
      </div>
      <div className="min-w-0 sm:w-auto [&_button]:min-h-[48px] [&_button]:w-full sm:[&_button]:w-auto">{button}</div>
    </section>
  );
}

/**
 * The people who can do a step, by name: "Dino Reyes (Site Manager)" or "Dino Reyes (Site Manager) or Ana
 * Cruz (Finance)". Falls back to the role names, then to `fallback`. Read-only (uses `whoCanDo`, ADR-073).
 */
export async function whoDoes(ctx: AuthContext, permission: string, siteId: string | null, fallback: string): Promise<string> {
  const w = await whoCanDo(ctx, permission, siteId).catch(() => ({ roles: [] as string[], people: [] as { name: string; role: string }[] }));
  if (w.people.length > 0) {
    const shown = w.people.slice(0, 2).map((p) => `${p.name} (${p.role})`);
    return w.people.length > 2 ? `${shown.join(", ")} or another ${w.people[2].role.toLowerCase()}` : shown.join(" or ");
  }
  if (w.roles.length > 0) return `the ${w.roles.slice(0, 2).join(" or ")}`;
  return fallback;
}
