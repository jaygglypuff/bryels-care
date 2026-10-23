import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/qty";
import { getCustomer, listCustomerOrders } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.view")) return <Forbidden what="customers" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data: Awaited<ReturnType<typeof getCustomer>>;
  try {
    data = await getCustomer(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { customer: c, shipments } = data;
  const orders = ctx.can("sales.sales_order.view") ? await listCustomerOrders(ctx, c.id) : [];
  const siteCode = (sid: string) => ctx.allowedSites.find((s) => s.id === sid)?.code ?? "";

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<span className="font-mono">{c.code}</span>}
        actions={
          <>
            <LinkButton href="/sales/customers" variant="secondary">All customers</LinkButton>
            {ctx.can("sales.sales_order.create") && <LinkButton href={`/sales/new?customer=${c.id}`} variant="cta">New order</LinkButton>}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>Details</CardTitle>
          <Dl
            items={[
              ["Contact", c.contactName ?? "—"],
              ["Phone", c.phone ?? "—"],
              ["Email", c.email ?? "—"],
              ["Ship to", c.shipToAddress],
              ["Min shelf life at dispatch", `${c.minShelfLifeDays} days`],
              ["Customer since", fmtDate(c.createdAt)],
            ]}
          />
        </Card>

        {ctx.can("sales.sales_order.view") && (
          <Card>
            <CardTitle>Orders</CardTitle>
            {orders.length === 0 ? (
              <EmptyState title="No orders yet">Orders for this customer in your sites appear here.</EmptyState>
            ) : (
              <Table head={["Order", "Site", "PO number", "Requested delivery", "Value", "Status"]}>
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-2">
                    <Td>
                      <Link className="font-medium text-primary-text hover:underline" href={`/sales/${o.id}`}>
                        {o.orderNumber}
                      </Link>
                    </Td>
                    <Td>{siteCode(o.siteId)}</Td>
                    <Td>{o.customerPoNumber ?? "—"}</Td>
                    <Td>{fmtDate(o.requestedDeliveryOn)}</Td>
                    <Td className="font-medium">{fmtMoney(o.value)}</Td>
                    <Td>
                      <StatusChip status={o.status} />
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}

        {ctx.can("sales.shipment.view") && (
          <Card>
            <CardTitle>Shipments</CardTitle>
            {shipments.length === 0 ? (
              <EmptyState title="No shipments yet">Dispatched deliveries and their receipts appear here.</EmptyState>
            ) : (
              <Table head={["Delivery receipt", "Order", "Carrier", "Dispatched", "Delivered", ""]}>
                {shipments.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.deliveryReceiptNumber}</Td>
                    <Td>
                      <Link className="text-primary-text hover:underline" href={`/sales/${s.orderId}`}>
                        {s.orderNumber}
                      </Link>
                    </Td>
                    <Td>{s.carrier ?? "—"}</Td>
                    <Td>{fmtDateTime(s.dispatchedAt)}</Td>
                    <Td>{s.deliveredAt ? `${fmtDateTime(s.deliveredAt)} · ${s.receivedByName ?? ""}` : "Not recorded"}</Td>
                    <Td>
                      <Link className="text-primary-text hover:underline" href={`/print/delivery-receipt/${s.id}`} target="_blank">
                        Print DR
                      </Link>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
