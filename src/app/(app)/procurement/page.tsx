import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { expectedReceipts, listAslQueue, listPurchaseOrders, listPurchaseRequests, listReorderSuggestions, listSupplierReturns } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../forbidden";
import { SubNav } from "./_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Procurement" };

/**
 * Procurement overview (W04): what waits for whom. Each tile links to the list it counts; the numbers
 * are the records the viewer may see at their sites.
 */
export default async function ProcurementHome() {
  const ctx = await requireContext();
  const canPo = ctx.can("procurement.purchase_order.view");
  const canPr = ctx.can("procurement.purchase_request.view");
  const canSr = ctx.can("procurement.supplier_return.view");
  const canRo = ctx.can("procurement.reorder_suggestion.view");
  if (!canPo && !canPr && !canSr && !ctx.can("masterdata.supplier.view")) return <Forbidden what="procurement" />;
  const [pos, prs, srs, exp, sug, asl] = await Promise.all([
    canPo ? listPurchaseOrders(ctx, { status: "open" }) : Promise.resolve([]),
    canPr ? listPurchaseRequests(ctx, { status: "open" }) : Promise.resolve([]),
    canSr ? listSupplierReturns(ctx, { status: "open" }) : Promise.resolve([]),
    canPo ? expectedReceipts(ctx) : Promise.resolve([]),
    canRo ? listReorderSuggestions(ctx) : Promise.resolve([]),
    ctx.can("masterdata.supplier.view") ? listAslQueue(ctx) : Promise.resolve([]),
  ]);
  const nothing = !pos.length && !prs.length && !srs.length && !exp.length && !sug.length && !asl.length;
  return (
    <>
      <PageHeader
        title="Procurement"
        subtitle="Request → approval → purchase order → expected receipt → receipts, returns and supplier performance (W04)."
        actions={
          <>
            {ctx.can("procurement.purchase_request.create") && <LinkButton href="/procurement/requests/new" variant="secondary">New request</LinkButton>}
            {ctx.can("procurement.purchase_order.create") && <LinkButton href="/procurement/orders/new" variant="cta">New purchase order</LinkButton>}
          </>
        }
      />
      <SubNav />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {canPr && <Kpi label="Requests to approve" value={prs.filter((r) => r.status === "submitted").length} href="/procurement/requests?status=submitted" />}
        {canPo && <Kpi label="POs to approve" value={pos.filter((r) => r.status === "submitted").length} href="/procurement/orders?status=submitted" />}
        {canPo && <Kpi label="Approved, not sent" value={pos.filter((r) => r.status === "approved").length} href="/procurement/orders?status=approved" />}
        {canPo && <Kpi label="Late POs" value={pos.filter((r) => r.late).length} tone={pos.some((r) => r.late) ? "warn" : "neutral"} href="/procurement/orders?status=open" />}
        {canPo && <Kpi label="Expected lines" value={exp.length} href="/procurement/expected" />}
        {canSr && <Kpi label="Open supplier returns" value={srs.length} href="/procurement/returns" />}
        {canRo && <Kpi label="Reorder suggestions" value={sug.length} href="/procurement/reorder" />}
        {asl.length > 0 && <Kpi label="ASL proposals for QA" value={asl.length} href="/procurement/suppliers" />}
      </div>
      {nothing && (
        <div className="mt-5">
          <EmptyState title="Nothing waiting">No open requests, orders, returns or suggestions at your sites.</EmptyState>
        </div>
      )}
      {canPo && exp.some((e) => e.late) && (
        <Card className="mt-5">
          <CardTitle>Late deliveries</CardTitle>
          <ul className="flex flex-col gap-1 text-[14px]">
            {exp
              .filter((e) => e.late)
              .slice(0, 8)
              .map((e) => (
                <li key={e.lineId}>
                  <Link className="text-primary-text hover:underline" href={`/procurement/orders/${e.purchaseOrderId}`}>
                    {e.poNumber}
                  </Link>{" "}
                  · {e.supplierName} · {e.materialCode} · due {e.expectedDate}
                </li>
              ))}
          </ul>
        </Card>
      )}
    </>
  );
}
