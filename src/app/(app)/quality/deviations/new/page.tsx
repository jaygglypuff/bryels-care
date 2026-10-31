import { requireContext } from "@/lib/auth/context";
import { deviationFormContext } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { DeviationForm } from "../../w2c-forms";

export const dynamic = "force-dynamic";

/** Raise sheet pre-filled from the page the user came from (batch, lot, inspection result). */
export default async function NewDeviationPage({ searchParams }: { searchParams: Promise<{ batchId?: string; lotId?: string; inspectionId?: string; testResultId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.deviation.create")) return <Forbidden what="raising deviations" />;
  const sp = await searchParams;
  const f = await deviationFormContext(ctx, { batchId: sp.batchId, lotId: sp.lotId });
  if (!f.batch && !f.lot) {
    return (
      <EmptyState title="Start from the batch or the lot" action={<LinkButton href="/production" variant="secondary">Batches</LinkButton>}>
        Open the batch or lot the problem is about and use ⋯ More → Report a problem there; the system fills in the rest.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader title="Report a problem" subtitle={f.batch ? `Batch ${f.batch.number}` : `Lot ${f.lot!.number}`} />
      <PageIntro>This screen is for anyone who saw something go wrong: write what happened. QA is told at once and looks into it.</PageIntro>
      <Card className="max-w-2xl">
        <CardTitle>What went wrong?</CardTitle>
        <DeviationForm batchId={f.batch?.id} lotId={f.lot?.id} inspectionId={sp.inspectionId} testResultId={sp.testResultId} steps={f.batch?.steps ?? []} />
        {sp.testResultId && <p className="mt-3 text-[12px] text-muted">This report is about a test result that was not OK. When QA closes it, QA writes whether the product may still be made OK to use.</p>}
      </Card>
    </>
  );
}
