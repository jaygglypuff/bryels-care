import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { ACTIVE_BATCH_LIMIT, getOperationsCenter } from "@/modules/analytics";
import { EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { StockTabs } from "@/ui/inventory/stock-tabs";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work in progress" };

/**
 * Work in progress (ADR-081): batches between "materials set aside" and the QA decision. WIP is not a
 * stock lot in this system (A-UX-03): materials leave stock when they are weighed into the batch and
 * the finished lot exists from Finish; this page lists what is in between, from the same read model as
 * the Operations Center so the two never disagree.
 */
export default async function WipPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="stock" />;
  const seesBatches = ctx.can("production.batch.view") || ctx.can("production.work_order.view");
  const oc = seesBatches ? await getOperationsCenter(ctx) : null;
  const rows = (oc?.batches ?? []).filter((b) => b.status !== "planned");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Work in progress"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · batches being made or waiting for the QA decision`}
        actions={<LinkButton href="/inventory/scan" variant="cta">Scan</LinkButton>}
      />
      <StockTabs active="wip" />
      {!seesBatches ? (
        <EmptyState title="Production is not visible to your role">Ask your site manager if you need to see batches in progress.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing in progress" action={<Link href="/production/orders" className="font-medium text-primary-text hover:underline">Open production orders</Link>}>
          A batch shows here from the moment its materials are set aside until QA releases or rejects it.
        </EmptyState>
      ) : (
        <>
          <Table head={["Batch", "Product", "Order", "Steps done", "Status", "Planned start"]}>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <Td><Link href={b.href} className="font-mono font-medium text-primary-text hover:underline">{b.batchNumber}</Link></Td>
                <Td>{b.productName}</Td>
                <Td className="font-mono text-[12px]">{b.orderNumber ?? "—"}</Td>
                <Td className="tabular">{b.stepsTotal ? `${b.stepsDone} of ${b.stepsTotal}` : "—"}</Td>
                <Td><StatusChip status={b.status} /></Td>
                <Td>{b.plannedStartOn ? fmtDate(b.plannedStartOn) : "—"}</Td>
              </tr>
            ))}
          </Table>
          {oc!.batches.length >= ACTIVE_BATCH_LIMIT && <p className="text-[12px] text-muted">Showing the first {ACTIVE_BATCH_LIMIT}. Open production orders for the full list.</p>}
        </>
      )}
    </div>
  );
}
