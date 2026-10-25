import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listPurchaseOrders } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { FilterPills, PoChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders" };

const FILTERS = [
  ["open", "Open"],
  ["draft", "Draft"],
  ["submitted", "To approve"],
  ["approved", "To send"],
  ["sent", "Sent"],
  ["partially_received", "Partly received"],
  ["received", "Received"],
  ["closed", "Closed"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="purchase orders" />;
  const { status = "open", q } = await searchParams;
  const rows = await listPurchaseOrders(ctx, { status, q });
  const prices = ctx.can("masterdata.supplier_price.view");
  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Only approved supplier × material pairs can be ordered (V-ASL). Approval follows the approval rules on the PO total."
        actions={
          <>
            {ctx.can("procurement.purchase_order.export") && (
              <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" href={`/api/v1/procurement/purchase-orders/export?status=${encodeURIComponent(status)}`}>
                Export CSV
              </a>
            )}
            {ctx.can("procurement.purchase_order.create") && <LinkButton href="/procurement/orders/new" variant="cta">New purchase order</LinkButton>}
          </>
        }
      />
      <SubNav />
      <Card>
        <FilterPills base="/procurement/orders" current={status} items={FILTERS} />
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders here" action={ctx.can("procurement.purchase_order.create") ? <LinkButton href="/procurement/orders/new" variant="secondary">New purchase order</LinkButton> : undefined}>
            Create a purchase order from an approved request or directly for an approved supplier.
          </EmptyState>
        ) : (
          <Table head={["PO", "Status", "Supplier", "Ordered", "Expected", "Lines", ...(prices ? ["Total"] : [])]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/procurement/orders/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <span className="inline-flex flex-wrap gap-1">
                    <PoChip status={r.status} />
                    {r.late && <Chip tone="warn">Late</Chip>}
                    {r.urgent && <Chip tone="bad">Urgent</Chip>}
                  </span>
                </Td>
                <Td>{r.supplierName}</Td>
                <Td className="whitespace-nowrap">{fmtDate(r.orderDate)}</Td>
                <Td className="whitespace-nowrap">{r.expectedDate ? fmtDate(r.expectedDate) : "—"}</Td>
                <Td>{r.lines}</Td>
                {prices && <Td className="whitespace-nowrap">{money(r.totalAmount, r.currency)}</Td>}
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
