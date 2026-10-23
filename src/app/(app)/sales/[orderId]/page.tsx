import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/qty";
import { getOrder } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { AllocateForm, CancelOrderForm, ConfirmOrderForm, DeliveryForm, DispatchForm } from "./order-actions";

export const metadata = { title: "Sales order" };

function manilaNowLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

const DONE: Record<string, string> = {
  confirmed: "Order confirmed. The warehouse can now allocate stock.",
  allocated: "Fully allocated by FEFO. Pick the lots on the pick list, then dispatch.",
  dispatched: "Dispatched: stock issued. Delivery receipt",
  delivered: "Delivery recorded.",
  cancelled: "Order cancelled. Any allocated stock was released.",
};

export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="sales orders" />;
  const { orderId } = await params;
  const { done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  let data: Awaited<ReturnType<typeof getOrder>>;
  try {
    data = await getOrder(ctx, orderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { order, customer, lines, allocations, shipments, total } = data;
  const status = order.status;
  const hasAllocations = allocations.length > 0;
  const shortLines = lines.filter((l) => D(l.shortfall).gt(0));
  const totalPcs = lines.reduce((s, l) => s.plus(l.qtyUnits), new Decimal(0));
  const showAlloc = status === "confirmed" || status === "allocated" || status === "shipped";
  const canApprove = ctx.can("sales.sales_order.approve");
  const suggestedPackages = Math.max(1, lines.reduce((n, l) => n + D(l.qtyUnits).div(l.unitsPerBox || 1).ceil().toNumber(), 0));

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusChip status={status} />
            <span>{customer.name}</span>
          </span>
        }
        actions={<LinkButton href="/sales" variant="secondary">All orders</LinkButton>}
      />

      {done && DONE[done] && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={done === "dispatched" && shipments[0] ? `${DONE[done]} ${shipments[0].deliveryReceiptNumber}` : DONE[done]} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Order</CardTitle>
            <Dl
              items={[
                ["Customer", ctx.can("masterdata.customer.view") ? <Link className="text-primary-text hover:underline" href={`/sales/customers/${customer.id}`}>{customer.name}</Link> : customer.name],
                ["Customer PO", order.customerPoNumber ?? "—"],
                ["Requested delivery", fmtDate(order.requestedDeliveryOn)],
                ["Ship to", customer.shipToAddress],
                ["Min shelf life", `${customer.minShelfLifeDays} days at dispatch`],
                ["Created", fmtDateTime(order.createdAt)],
              ]}
            />
            {order.notes && <p className="mt-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-fg-2">{order.notes}</p>}
          </Card>

          <Card>
            <CardTitle>Lines</CardTitle>
            <ul className="flex flex-col divide-y divide-line sm:hidden">
              {lines.map((l) => (
                <li key={l.id} className="py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{l.sku}</span>
                    <span className="font-medium tabular">{fmtMoney(l.value)}</span>
                  </div>
                  <p className="text-[13px] text-fg-2">{l.productName}</p>
                  <p className="text-[13px] tabular text-muted">
                    {fmtQty(l.qtyUnits, "pcs", 0)} × {fmtMoney(l.unitPrice)}
                    {showAlloc && (status === "shipped" ? ` · shipped ${fmtQty(l.qtyUnits, "", 0)}` : ` · allocated ${fmtQty(l.allocated, "", 0)}`)}
                  </p>
                </li>
              ))}
              <li className="flex justify-between py-2.5 font-semibold tabular">
                <span>Total {fmtQty(totalPcs, "pcs", 0)}</span>
                <span>{fmtMoney(total)}</span>
              </li>
            </ul>
            <Table className="hidden sm:block" head={["#", "SKU", "Product", "Qty", "Unit price", "Value", ...(showAlloc ? ["Allocated"] : [])]}>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td className="font-medium">{l.sku}</Td>
                  <Td>{l.productName}</Td>
                  <Td>{fmtQty(l.qtyUnits, "pcs", 0)}</Td>
                  <Td>{fmtMoney(l.unitPrice)}</Td>
                  <Td className="font-medium">{fmtMoney(l.value)}</Td>
                  {showAlloc && (
                    <Td className={D(l.shortfall).gt(0) && status === "confirmed" ? "text-[var(--warn-fg)]" : ""}>
                      {fmtQty(status === "shipped" ? l.qtyUnits : l.allocated, "", 0)} / {fmtQty(l.qtyUnits, "", 0)}
                    </Td>
                  )}
                </tr>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <Td />
                <Td colSpan={2}>Total</Td>
                <Td>{fmtQty(totalPcs, "pcs", 0)}</Td>
                <Td />
                <Td>{fmtMoney(total)}</Td>
                {showAlloc && <Td />}
              </tr>
            </Table>
          </Card>

          {hasAllocations && (
            <Card>
              <CardTitle>{status === "shipped" ? "Shipped lots" : "Pick list (FEFO allocation)"}</CardTitle>
              <ul className="flex flex-col gap-2 sm:hidden">
                {allocations.map((a) => (
                  <li key={a.id} className="rounded-[12px] border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-medium">{a.lotNumber}</span>
                      <span className="text-[16px] font-semibold tabular">{fmtQty(a.qtyUnits, "pcs", 0)}</span>
                    </div>
                    <p className="text-[13px] text-fg-2">
                      {a.sku} · {a.locationCode} {a.locationName}
                    </p>
                    <p className="text-[12px] text-muted">Expires {fmtDate(a.expiresOn)}</p>
                  </li>
                ))}
              </ul>
              <Table className="hidden sm:block" head={["SKU", "Lot", "Expiry", "Shelf life left", "Location", "Qty"]}>
                {allocations.map((a) => {
                  const left = daysUntil(a.expiresOn);
                  return (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap font-medium">{a.sku}</Td>
                      <Td className="whitespace-nowrap">
                        <span className="font-mono text-[12px]">{a.lotNumber}</span>{" "}
                        {status !== "shipped" && a.qualityStatus !== "released" && <StatusChip status={a.qualityStatus} />}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtDate(a.expiresOn)}</Td>
                      <Td className="whitespace-nowrap">{left === null ? "—" : `${left} days`}</Td>
                      <Td>
                        {a.locationCode} <span className="text-muted">· {a.locationName}</span>
                      </Td>
                      <Td className="font-medium">{fmtQty(a.qtyUnits, "pcs", 0)}</Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {status === "draft" && (
            <Card>
              <CardTitle>Next step</CardTitle>
              {canApprove ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-fg-2">Check the lines and prices with the customer&apos;s PO, then confirm. Confirmed orders go to the warehouse for allocation.</p>
                  <ConfirmOrderForm orderId={order.id} />
                  <CancelOrderForm orderId={order.id} hasAllocations={false} />
                </div>
              ) : (
                <p className="text-[13px] text-muted">Waiting for sales to confirm this order.</p>
              )}
            </Card>
          )}

          {status === "confirmed" && (
            <Card>
              <CardTitle>Allocate stock</CardTitle>
              <div className="flex flex-col gap-3">
                {hasAllocations && shortLines.length > 0 && (
                  <Banner tone="warn" title="Partly allocated — shortfall">
                    {shortLines.map((l) => `${l.sku}: ${fmtQty(l.shortfall, "pcs", 0)} short`).join("; ")}. The order stays confirmed until every line is fully allocated.
                  </Banner>
                )}
                <p className="text-[13px] text-fg-2">
                  Reserves released finished-goods lots at this site, earliest expiry first, skipping lots with less than {customer.minShelfLifeDays} days of shelf life left.
                </p>
                {ctx.can("sales.allocation.post") ? (
                  <AllocateForm orderId={order.id} label={hasAllocations ? "Allocate remaining (FEFO)" : "Allocate stock (FEFO)"} />
                ) : (
                  <p className="text-[13px] text-muted">Waiting for the warehouse to allocate stock.</p>
                )}
                {canApprove && <CancelOrderForm orderId={order.id} hasAllocations={hasAllocations} />}
              </div>
            </Card>
          )}

          {status === "allocated" && (
            <Card>
              <CardTitle>Dispatch</CardTitle>
              {ctx.can("sales.shipment.post") ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-fg-2">
                    Pick the lots on the pick list, load them, then post the dispatch. Exactly the allocated quantities ship; lots are re-checked (released, not expired) at posting.
                  </p>
                  <DispatchForm orderId={order.id} suggestedPackages={suggestedPackages} />
                </div>
              ) : (
                <p className="text-[13px] text-muted">Allocated. Waiting for the warehouse to pick and dispatch.</p>
              )}
            </Card>
          )}

          {status === "cancelled" && (
            <Banner tone="neu" title="Cancelled">
              This order was cancelled; see the audit log for the reason.
            </Banner>
          )}

          {shipments.map((s) => (
            <Card key={s.id}>
              <CardTitle>Shipment {s.deliveryReceiptNumber}</CardTitle>
              {ctx.can("sales.shipment.view") && (
                <LinkButton href={`/print/delivery-receipt/${s.id}`} target="_blank" variant="primary" className="mb-4 w-full">
                  Print delivery receipt
                </LinkButton>
              )}
              <Dl
                items={[
                  ["Dispatched", fmtDateTime(s.dispatchedAt)],
                  ["Carrier", s.carrier ?? "—"],
                  ["Driver", s.driverName ?? "—"],
                  ["Vehicle", s.vehiclePlate ?? "—"],
                  ["Packages", s.packageCount ?? "—"],
                  ["Delivered", s.deliveredAt ? `${fmtDateTime(s.deliveredAt)} · ${s.receivedByName ?? ""}` : "Not yet recorded"],
                ]}
              />
              {!s.deliveredAt && ctx.can("sales.shipment.post") && (
                <div className="mt-4 border-t border-line pt-4">
                  <DeliveryForm shipmentId={s.id} orderId={order.id} now={manilaNowLocal()} />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
