import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { expectedReceipts } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SubNav, fmtBase } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expected receipts" };

/** Expected receipts (W04-07): open lines of sent purchase orders, earliest due first. Quantities only, never prices. */
export default async function ExpectedPage() {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="expected receipts" />;
  const rows = await expectedReceipts(ctx);
  const canReceive = ctx.can("procurement.goods_receipt.create");
  const byPo = [...new Map(rows.map((r) => [r.purchaseOrderId, r])).values()];
  return (
    <>
      <PageHeader title="Expected receipts" subtitle="Deliveries the site is waiting for. Receive against the PO so its progress and the supplier's performance stay correct." actions={canReceive ? <LinkButton href="/inventory/receive" variant="secondary">Unplanned receipt</LinkButton> : undefined} />
      <SubNav />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing expected">No sent purchase order has open lines at your sites.</EmptyState>
        ) : (
          <Table head={["PO", "Supplier", "Material", "Ordered", "Received", "Open", "Due", ""]}>
            {rows.map((r) => (
              <tr key={r.lineId}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/procurement/orders/${r.purchaseOrderId}`}>
                    {r.poNumber}
                  </Link>
                  <div className="text-[12px] text-muted">
                    {r.siteCode} · line {r.lineNo}
                  </div>
                </Td>
                <Td>{r.supplierName}</Td>
                <Td>
                  {r.materialCode}
                  <div className="text-[12px] text-muted">{r.materialName}</div>
                </Td>
                <Td className="whitespace-nowrap">{r.orderedText}</Td>
                <Td className="whitespace-nowrap">{fmtBase(r.receivedBase, r.baseUom)}</Td>
                <Td className="whitespace-nowrap">{fmtBase(r.remainingBase, r.baseUom)}</Td>
                <Td className="whitespace-nowrap">
                  {r.expectedDate ? fmtDate(r.expectedDate) : "—"} {r.late && <Chip tone="warn">Late</Chip>}
                </Td>
                <Td>{canReceive && r.siteId === ctx.currentSiteId && byPo.find((p) => p.lineId === r.lineId) && <LinkButton href={`/inventory/receive?po=${r.purchaseOrderId}`} size="sm">Receive</LinkButton>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
