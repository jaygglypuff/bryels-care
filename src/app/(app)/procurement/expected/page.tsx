import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { expectedReceipts } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav, fmtBase } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deliveries coming" };

/**
 * Deliveries coming (expected receipts, W04-07): open items of sent purchase orders, earliest first, supplier first.
 * Tapping a row at your own site opens "Receive" with the order filled in; quantities only, never prices.
 */
export default async function ExpectedPage() {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="deliveries coming" />;
  const rows = await expectedReceipts(ctx);
  const canReceive = ctx.can("procurement.goods_receipt.create");
  const late = rows.filter((r) => r.late);
  const first = rows.find((r) => canReceive && r.siteId === ctx.currentSiteId);
  return (
    <>
      <PageHeader title="Deliveries coming" actions={canReceive ? <LinkButton href="/inventory/receive" variant="secondary">Receive something not ordered</LinkButton> : undefined} />
      <PageIntro>This screen is for the deliveries we are waiting for. When a truck arrives, tap its row to receive it against the order, so we know what is still to come.</PageIntro>
      {late.length > 0 && <NextStep text={`${late.length} item(s) are late.`} waitingFor="Call the supplier to ask when it comes. Their phone is on the supplier's page (Suppliers we may buy from)." />}
      {!late.length && first && <NextStep text={`Next delivery: ${first.supplierName}${first.expectedDate ? `, ${fmtDate(first.expectedDate)}` : ""}.`} action={{ label: "Receive it", href: `/inventory/receive?po=${first.purchaseOrderId}` }} />}
      <SubNav />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing on the way" action={ctx.can("procurement.purchase_order.view") ? <LinkButton href="/procurement/orders" variant="secondary">Purchase orders</LinkButton> : undefined}>
            No order sent to a supplier still has items to come. Orders show here after purchasing sends them.
          </EmptyState>
        ) : (
          <PlainList label="Deliveries coming">
            {rows.map((r) => {
              const receiveHere = canReceive && r.siteId === ctx.currentSiteId;
              return (
                <PlainRow
                  key={r.lineId}
                  testId="expected-row"
                  href={receiveHere ? `/inventory/receive?po=${r.purchaseOrderId}` : `/procurement/orders/${r.purchaseOrderId}`}
                  title={r.supplierName}
                  code={r.poNumber}
                  tone={r.late ? "warn" : undefined}
                  status={r.late ? <Chip tone="warn">Late</Chip> : undefined}
                  facts={`${r.materialName} · still to come ${fmtBase(r.remainingBase, r.baseUom)} of ${r.orderedText} · ${r.siteCode}`}
                  aside={
                    <>
                      <span className="block font-medium text-fg">{r.expectedDate ? fmtDate(r.expectedDate) : "No date"}</span>
                      {receiveHere && <span className="text-primary-text">Receive</span>}
                    </>
                  }
                />
              );
            })}
          </PlainList>
        )}
      </Card>
    </>
  );
}
