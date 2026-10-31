import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { ACTIVE_BATCH_LIMIT, getOperationsCenter } from "@/modules/analytics";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { StockTabs } from "@/ui/inventory/stock-tabs";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Being made" };

/**
 * Being made (work in progress, ADR-081): batches between "materials set aside" and the QA decision. It
 * is not a stock lot in this system (A-UX-03): materials leave stock when they are weighed into the batch
 * and the finished lot exists from Finish; this page lists what is in between, from the same read model as
 * the Operations Center so the two never disagree. Grade-5 list (ADR-088): product first, batch number grey.
 */
export default async function WipPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="stock" />;
  const seesBatches = ctx.can("production.batch.view") || ctx.can("production.work_order.view");
  const oc = seesBatches ? await getOperationsCenter(ctx) : null;
  const rows = (oc?.batches ?? []).filter((b) => b.status !== "planned");
  return (
    <div className="space-y-4">
      <PageHeader title="Being made" subtitle={ctx.currentSite.name} actions={<LinkButton href="/inventory/scan" variant="secondary">Scan a label</LinkButton>} />
      <PageIntro>This screen is for batches that are being made now or are waiting for the QA check. Their materials have left stock; the finished goods go into stock when the batch is finished.</PageIntro>
      <StockTabs active="wip" />
      {!seesBatches ? (
        <EmptyState title="Your job does not show batches">Ask your site manager if you need to see what is being made.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing is being made right now" action={<LinkButton href="/production/orders" variant="secondary">See what is planned</LinkButton>}>
          A batch shows here from the moment its materials are set aside until QA says OK or not OK.
        </EmptyState>
      ) : (
        <>
          <PlainList label="Batches being made">
            {rows.map((b) => (
              <PlainRow
                key={b.id}
                href={b.href}
                title={b.productName}
                status={<StatusChip status={b.status} />}
                facts={
                  <>
                    {b.stepsTotal ? `${b.stepsDone} of ${b.stepsTotal} steps done` : "No steps yet"}
                    {b.plannedStartOn ? ` · start ${fmtDate(b.plannedStartOn)}` : ""}
                  </>
                }
                code={b.batchNumber}
              />
            ))}
          </PlainList>
          {oc!.batches.length >= ACTIVE_BATCH_LIMIT && <p className="text-[13px] text-muted">Showing the first {ACTIVE_BATCH_LIMIT}. See production for all of them.</p>}
        </>
      )}
    </div>
  );
}
