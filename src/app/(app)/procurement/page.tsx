import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { expectedReceipts, listAslQueue, listPurchaseOrders, listPurchaseRequests, listReorderSuggestions, listSupplierReturns } from "@/modules/procurement";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { SubNav } from "./_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchasing" };

/**
 * Purchasing home (W04): what waits for whom. Each tile links to the list it counts; the numbers are the
 * records the viewer may see at their sites. The one next step is the most urgent thing the viewer can do.
 */
export default async function ProcurementHome() {
  const ctx = await requireContext();
  const canPo = ctx.can("procurement.purchase_order.view");
  const canPr = ctx.can("procurement.purchase_request.view");
  const canSr = ctx.can("procurement.supplier_return.view");
  const canRo = ctx.can("procurement.reorder_suggestion.view");
  if (!canPo && !canPr && !canSr && !ctx.can("masterdata.supplier.view")) return <Forbidden what="purchasing" />;
  const [pos, prs, srs, exp, sug, asl] = await Promise.all([
    canPo ? listPurchaseOrders(ctx, { status: "open" }) : Promise.resolve([]),
    canPr ? listPurchaseRequests(ctx, { status: "open" }) : Promise.resolve([]),
    canSr ? listSupplierReturns(ctx, { status: "open" }) : Promise.resolve([]),
    canPo ? expectedReceipts(ctx) : Promise.resolve([]),
    canRo ? listReorderSuggestions(ctx) : Promise.resolve([]),
    ctx.can("masterdata.supplier.view") ? listAslQueue(ctx) : Promise.resolve([]),
  ]);
  const nothing = !pos.length && !prs.length && !srs.length && !exp.length && !sug.length && !asl.length;
  const prToApprove = prs.filter((r) => r.status === "submitted").length;
  const poToApprove = pos.filter((r) => r.status === "submitted").length;
  const poToSend = pos.filter((r) => r.status === "approved").length;
  const prApproved = prs.filter((r) => r.status === "approved").length;
  const late = exp.filter((e) => e.late);
  const canOrder = ctx.can("procurement.purchase_order.create");
  const next =
    poToApprove && ctx.can("procurement.purchase_order.approve")
      ? { text: `Next: ${poToApprove} purchase order(s) wait for your approval.`, action: { label: "Open them", href: "/procurement/orders?status=submitted" } }
      : prToApprove && ctx.can("procurement.purchase_request.approve")
        ? { text: `Next: ${prToApprove} request(s) to buy wait for your approval.`, action: { label: "Open them", href: "/procurement/requests?status=submitted" } }
        : poToSend && ctx.can("procurement.purchase_order.post")
          ? { text: `Next: send ${poToSend} approved purchase order(s) to the supplier.`, action: { label: "Open them", href: "/procurement/orders?status=approved" } }
          : prApproved && canOrder
            ? { text: `Next: ${prApproved} approved request(s) to buy can become a purchase order.`, action: { label: "Make a purchase order", href: "/procurement/orders/new" } }
            : sug.length && canOrder
              ? { text: `${sug.length} item(s) are running low.`, action: { label: "See what to buy", href: "/procurement/reorder" } }
              : null;
  return (
    <>
      <PageHeader
        title="Purchasing"
        actions={
          <>
            {ctx.can("procurement.purchase_request.create") && <LinkButton href="/procurement/requests/new" variant="secondary">Ask to buy something</LinkButton>}
            {canOrder && <LinkButton href="/procurement/orders/new" variant="cta">New purchase order</LinkButton>}
          </>
        }
      />
      <PageIntro>This screen is for buying: what waits for approval, what to send to suppliers, and which deliveries are coming or late.</PageIntro>
      {next && <NextStep text={next.text} action={next.action} />}
      <SubNav />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {canPr && <Kpi label="Requests to approve" value={prToApprove} href="/procurement/requests?status=submitted" />}
        {canPo && <Kpi label="Orders to approve" value={poToApprove} href="/procurement/orders?status=submitted" />}
        {canPo && <Kpi label="Approved, not sent" value={poToSend} href="/procurement/orders?status=approved" />}
        {canPo && <Kpi label="Late orders" value={pos.filter((r) => r.late).length} tone={pos.some((r) => r.late) ? "warn" : "neutral"} href="/procurement/orders?status=open" />}
        {canPo && <Kpi label="Deliveries coming" value={exp.length} href="/procurement/expected" />}
        {canSr && <Kpi label="Going back to suppliers" value={srs.length} href="/procurement/returns" />}
        {canRo && <Kpi label="Running low" value={sug.length} href="/procurement/reorder" />}
        {asl.length > 0 && <Kpi label="Suppliers for QA to check" value={asl.length} href="/procurement/suppliers" />}
      </div>
      {nothing && (
        <div className="mt-5">
          <EmptyState title="Nothing waiting" action={ctx.can("procurement.purchase_request.create") ? <LinkButton href="/procurement/requests/new" variant="secondary">Ask to buy something</LinkButton> : undefined}>
            No open requests, orders, returns or low items at your sites. Need something? Ask to buy it.
          </EmptyState>
        </div>
      )}
      {canPo && late.length > 0 && (
        <Card className="mt-5">
          <CardTitle>Late deliveries</CardTitle>
          <PlainList label="Late deliveries">
            {late.slice(0, 8).map((e) => (
              <PlainRow
                key={e.lineId}
                href={`/procurement/orders/${e.purchaseOrderId}`}
                title={e.supplierName}
                code={e.poNumber}
                tone="warn"
                status={<Chip tone="warn">Late</Chip>}
                facts={`${e.materialName} · was due ${e.expectedDate ? fmtDate(e.expectedDate) : "—"}`}
              />
            ))}
          </PlainList>
        </Card>
      )}
    </>
  );
}
