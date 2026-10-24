import { requireContext } from "@/lib/auth/context";
import { deviationFormContext } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
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
      <EmptyState title="Start from a batch or a lot" action={<LinkButton href="/production" variant="secondary">Batches</LinkButton>}>
        Open the batch, lot or inspection the deviation is about and use &quot;Raise deviation&quot; there, so the references are filled in.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader title="Raise deviation" subtitle={f.batch ? `Batch ${f.batch.number}` : `Lot ${f.lot!.number}`} />
      <Card className="max-w-2xl">
        <CardTitle>What went wrong</CardTitle>
        <DeviationForm batchId={f.batch?.id} lotId={f.lot?.id} inspectionId={sp.inspectionId} testResultId={sp.testResultId} steps={f.batch?.steps ?? []} />
        {sp.testResultId && <p className="mt-3 text-[12px] text-muted">This deviation investigates an out-of-specification result (OOS). Its closure records whether release may proceed.</p>}
      </Card>
    </>
  );
}
