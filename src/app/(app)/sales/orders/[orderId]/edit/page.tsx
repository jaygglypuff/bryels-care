import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D } from "@/lib/qty";
import { canSeePrices, customerOptions, getOrder, manilaToday, priceBook, productAvailability } from "@/modules/sales";
import { Banner } from "@/ui/status";
import { LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../../forbidden";
import { NewOrderForm, type PriceBooks } from "../../../new/order-form";
import { editOrderAction } from "../../actions";

export const metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.edit")) return <Forbidden what="editing sales orders" />;
  const { orderId } = await params;
  let data: Awaited<ReturnType<typeof getOrder>>;
  try {
    data = await getOrder(ctx, orderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { order, lines } = data;
  if (order.status !== "draft") {
    return (
      <>
        <PageHeader title={`Edit ${order.orderNumber}`} />
        <Banner tone="info" title="Only a draft can be edited" action={<LinkButton href={`/sales/${order.id}`} variant="secondary">Back to the order</LinkButton>}>
          This order is {order.status.replace(/_/g, " ")}. Cancel it with a reason and enter a new one if the customer changed the PO.
        </Banner>
      </>
    );
  }
  const [customers, products] = await Promise.all([customerOptions(ctx), productAvailability(ctx)]);
  const prices = canSeePrices(ctx);
  const books: PriceBooks = prices ? { [order.customerId]: await priceBook(ctx, order.customerId) } : {};
  return (
    <>
      <PageHeader
        title={`Edit ${order.orderNumber}`}
        subtitle="Draft order: change lines, dates or addresses, then save. Prices are resolved again from the approved price list."
        actions={<LinkButton href={`/sales/${order.id}`} variant="secondary">Back</LinkButton>}
      />
      <NewOrderForm
        customers={customers.filter((c) => c.id === order.customerId)}
        products={products}
        today={manilaToday()}
        siteName={ctx.currentSite.name}
        priceBooks={books}
        pricesVisible={prices}
        action={editOrderAction}
        initial={{
          orderId: order.id,
          customerId: order.customerId,
          customerPoNumber: order.customerPoNumber ?? "",
          requestedDeliveryOn: order.requestedDeliveryOn ?? "",
          notes: order.notes ?? "",
          shipToAddressId: order.shipToAddressId ?? "",
          billToAddressId: order.billToAddressId ?? "",
          lines: lines.map((l) => ({ productId: l.productId, qtyUnits: D(l.qtyUnits).toString(), unitPrice: l.priceSource === "manual" && l.unitPrice ? D(l.unitPrice).toFixed(2) : "" })),
        }}
      />
    </>
  );
}
