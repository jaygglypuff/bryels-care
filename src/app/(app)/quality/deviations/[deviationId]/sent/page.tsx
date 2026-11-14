import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getDeviation } from "@/modules/quality";
import { whoCanDo } from "@/modules/identity";
import { waitingWords } from "@/modules/production";
import { EmptyState, LinkButton } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../../forbidden";

export const metadata: Metadata = { title: "Sent to QA" };
export const dynamic = "force-dynamic";

/** Only paths inside the app, never another site (open redirect). */
const safeBack = (v: string | undefined) => (v && /^\/[a-z0-9/_?=&%-]*$/i.test(v) && !v.startsWith("//") ? v : null);

/**
 * Round 5 (B-owner-manager B4, problem 6): after "Report a problem", the reporter (operator, owner, manager) sees
 * "Sent to QA" and goes back to what they were doing — not QA's investigation form, which is QA's work.
 */
export default async function DeviationSentPage({ params, searchParams }: { params: Promise<{ deviationId: string }>; searchParams: Promise<{ back?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.deviation.view")) return <Forbidden what="problem reports" permission="quality.deviation.view" />;
  const { deviationId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getDeviation>>;
  try {
    v = await getDeviation(ctx, deviationId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Problem report not found">Ask QA if you think it should be here.</EmptyState>;
    throw e;
  }
  const d = v.deviation;
  const qa = await whoCanDo(ctx, "quality.deviation.approve", d.siteId)
    .then(waitingWords)
    .catch(() => "QA");
  const back = safeBack(sp.back) ?? (v.batch ? `/production/${v.batch.id}` : "/dashboard");
  return (
    <div className="mx-auto grid max-w-xl gap-4 py-6 text-[16px]" data-density="operator">
      <PageIntro>This screen is for the person who reported a problem: QA has it now.</PageIntro>
      <div role="status" className="rounded-[8px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] p-5" data-testid="problem-sent">
        <h1 className="flex items-center gap-2 font-display text-title text-[var(--ok-fg)]">
          <CheckCircle2 size={28} aria-hidden /> Sent to QA
        </h1>
        <p className="mt-2 text-[17px] text-fg">
          {qa} got your report at {fmtDateTime(d.raisedAt)}
          {v.batch ? ` about batch ${v.batch.number}` : v.lot ? ` about lot ${v.lot.number}` : ""}. You get a message when QA decides.
        </p>
        <p className="mt-1 text-[14px] text-fg-2">Report {d.deviationNumber}. While it is open, the batch or lot cannot be made OK to use.</p>
      </div>
      <LinkButton href={back} variant="cta" size="lg" className="w-full">
        {v.batch ? "Back to the batch" : v.lot ? "Back to the lot" : "Back to Home"}
      </LinkButton>
    </div>
  );
}
