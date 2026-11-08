import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { checkerQueue } from "@/modules/production";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { ChecksList } from "./checks-list";

export const metadata: Metadata = { title: "Waiting for you to check" };
export const dynamic = "force-dynamic";

/**
 * ADR-130 one checker flow (round 5 problem 1, B13, B18): "Waiting for you to check". One card per thing to
 * check at the current site — all weighings of a batch together (when the company rule allows), each step on
 * its own — with one big "Looks right" and "Not right" (the reason only then). After a tap the checker stays here.
 */
export default async function ChecksPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production checks" permission="production.batch.view" />;
  const q = await checkerQueue(ctx);
  return (
    <div className="mx-auto max-w-2xl pb-24 text-[16px]" data-density="operator">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/dashboard" aria-label="Back to Home" className="inline-flex min-h-[52px] min-w-[52px] items-center justify-center rounded-full border border-line bg-surface text-fg hover:bg-surface-2">
          <ArrowLeft size={22} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-title tracking-tight text-fg sm:text-title-lg">Waiting for you to check</h1>
          <p className="mt-1 text-[15px] text-muted">{ctx.currentSite.name}</p>
        </div>
        <Help screen="production.step" />
      </header>
      <ChecksList cards={q.cards} viewerName={ctx.displayName.split(/\s+/)[0] ?? ctx.displayName} />
    </div>
  );
}
