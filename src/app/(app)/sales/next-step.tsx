import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import { whoCanDo } from "@/modules/identity";
import { NextStep } from "@/ui/guide";
import { buttonClass } from "@/ui/core";
import { Callout } from "@/ui/kit";
import { TEAM_OF_PERMISSION, whoWords } from "./who-words";

/**
 * "What to do next" on sales records (ADR-088). Same look as `NextStep` (src/ui/guide.tsx); when the next
 * step is a one-click command (a server-action form such as "Send for approval"), the form is passed as
 * `children` and becomes the one green button; a link `action` becomes the same green button. Without either, `NextStep` itself.
 */
export function DoNext({ text, waitingFor, action, children }: { text: ReactNode; waitingFor?: ReactNode; action?: { label: string; href: string }; children?: ReactNode }) {
  if (!children && !action) return <NextStep text={text} waitingFor={waitingFor} />;
  // ADR-136: one compact line; a form that is the next step sits on the right (or under the line on a phone).
  const button = children ?? (
    <Link href={action!.href} className={buttonClass("cta", "sm")}>
      {action!.label} <ArrowRight size={14} aria-hidden />
    </Link>
  );
  return (
    <Callout waitingFor={waitingFor} action={<div className="flex flex-col gap-2 [&_button]:min-h-[36px] pointer-coarse:[&_button]:min-h-[44px]">{button}</div>}>
      {text}
    </Callout>
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
