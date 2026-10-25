import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getOrder, manilaToday } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { AllocateForm } from "./order-actions";
import { FulfilmentPanel } from "./fulfilment-panel"; // W3E
import { ApproveOrderForm, CancelOrderPanel, ReorderForm, ReturnOrderForm, SubmitOrderForm } from "../orders/order-commercial";
import { MaskedNote, Money, SalesStatus } from "../orders/sales-ui";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Sales order" };

const DONE: Record<string, string> = {
  confirmed: "Order confirmed within limits. The warehouse can now allocate stock.",
  pending_approval: "Submitted. The order needs approval before the warehouse can allocate it.",
  edited: "Draft saved.",
  reordered: "New draft created from the earlier order at today's prices. Check it, then submit.",
  allocated: "Fully allocated by FEFO. Next: start the pick list (Fulfilment).",
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
  const { order, customer, lines, allocations, shipments, total, transitions, shipTo, billTo, quote, approval } = data;
  const status = order.status;
  const hasAllocations = allocations.length > 0;
  const shortLines = lines.filter((l) => D(l.shortfall).gt(0));
  const totalPcs = lines.reduce((s, l) => s.plus(l.qtyUnits), new Decimal(0));
  const showAlloc = ["confirmed", "allocated", "picking", "packed", "partially_shipped", "shipped"].includes(status);
  const canVoid = ctx.can("sales.sales_order.void") && ["draft", "submitted", "pending_approval", "confirmed", "allocated", "picking", "packed"].includes(status);
  const reasons = order.approvalReasons ?? [];
  const warnings = order.warnings ?? [];

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SalesStatus status={status} />
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
                ["Ship to", order.shipToText ?? customer.shipToAddress],
                [
                  "Credit / approval",
                  `${order.creditCheckStatus.replace(/_/g, " ")}${order.approvedAt ? ` · approved ${fmtDateTime(order.approvedAt)}${order.approvalNote ? ` (${order.approvalNote})` : ""}` : ""}`,
                ],
                ["Bill to", billTo ? `${billTo.label}: ${[billTo.line1, billTo.city].filter(Boolean).join(", ")}` : shipTo ? "Same as ship-to" : "—"],
                ...(quote ? ([["From quotation", <Link key="q" className="text-primary-text hover:underline" href={`/sales/quotations/${quote.id}`}>{quote.quoteNumber}</Link>]] as [string, React.ReactNode][]) : []),
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
                    <Money className="font-medium tabular" value={l.value} />
                  </div>
                  <p className="text-[13px] text-fg-2">{l.productName}</p>
                  <p className="text-[13px] tabular text-muted">
                    {fmtQty(l.qtyUnits, "pcs", 0)} × <Money value={l.unitPrice} />
                    {l.customerItemCode ? ` · customer code ${l.customerItemCode}` : ""}
                    {showAlloc && (status === "shipped" ? ` · shipped ${fmtQty(l.qtyUnits, "", 0)}` : ` · allocated ${fmtQty(l.allocated, "", 0)}`)}
                  </p>
                </li>
              ))}
              <li className="flex justify-between py-2.5 font-semibold tabular">
                <span>Total {fmtQty(totalPcs, "pcs", 0)}</span>
                <Money value={total} />
              </li>
            </ul>
            <Table className="hidden sm:block" head={["#", "SKU", "Product", "Qty", "Unit price", "Value", ...(showAlloc ? ["Allocated"] : [])]}>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td className="font-medium">{l.sku}</Td>
                  <Td>{l.productName}</Td>
                  <Td>{fmtQty(l.qtyUnits, "pcs", 0)}</Td>
                  <Td>
                    <Money value={l.unitPrice} />
                    {l.priceSource && l.priceSource !== "price_list" && <span className="block text-[11px] text-muted">{l.priceSource === "quote" ? "quoted price" : "manual price"}</span>}
                  </Td>
                  <Td className="font-medium">
                    <Money value={l.value} />
                  </Td>
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
                <Td>
                  <Money value={total} />
                </Td>
                {showAlloc && <Td />}
              </tr>
            </Table>
            <MaskedNote fields={data._masked} />
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
          {warnings.length > 0 && (
            <Banner tone="warn" title="Check before shipping">
              {warnings.map((w) => w.message).join("; ")}.
            </Banner>
          )}

          {status === "draft" && (
            <Card>
              <CardTitle>Next step</CardTitle>
              <div className="flex flex-col gap-3">
                {ctx.can("sales.sales_order.submit") ? (
                  <SubmitOrderForm orderId={order.id} />
                ) : (
                  <p className="text-[13px] text-muted">Waiting for sales to submit this order.</p>
                )}
                {ctx.can("sales.sales_order.edit") && (
                  <LinkButton href={`/sales/orders/${order.id}/edit`} variant="secondary">
                    Edit draft
                  </LinkButton>
                )}
                {canVoid && <CancelOrderPanel orderId={order.id} hasAllocations={false} />}
              </div>
            </Card>
          )}

          {status === "pending_approval" && (
            <Card>
              <CardTitle>Approval</CardTitle>
              <div className="flex flex-col gap-3">
                <Banner tone="warn" title={`Needs approval: ${reasons.map((r) => r.message.toLowerCase()).join("; ") || "approval rule"}`}>
                  {approval?.next ? `Waiting for step ${approval.next.step}: ${approval.next.label}.` : "Waiting for the approver."} Submitted {fmtDateTime(order.submittedAt)}.
                </Banner>
                {approval && approval.steps.length > 0 && (
                  <ol className="flex flex-col gap-1 text-[13px]">
                    {approval.steps.map((st) => (
                      <li key={st.step} className="flex justify-between gap-2">
                        <span>
                          {st.step}. {st.label}
                        </span>
                        <span className={st.done ? "text-[var(--ok-fg)]" : "text-muted"}>{st.done ? `Approved by ${st.approvals.map((x) => x.name).join(", ")}` : "Open"}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {approval?.canApprove ? (
                  <>
                    <ApproveOrderForm orderId={order.id} />
                    <ReturnOrderForm orderId={order.id} />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">
                    {order.createdBy === ctx.userId || order.submittedBy === ctx.userId
                      ? "You entered or submitted this order, so another person approves it."
                      : "Only the approver named by the approval rule can decide."}
                  </p>
                )}
                {canVoid && <CancelOrderPanel orderId={order.id} hasAllocations={false} />}
              </div>
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
                {ctx.can("inventory.allocation.create") ? (
                  <AllocateForm orderId={order.id} label={hasAllocations ? "Allocate remaining (FEFO)" : "Allocate stock (FEFO)"} />
                ) : (
                  <p className="text-[13px] text-muted">Waiting for the warehouse to allocate stock.</p>
                )}
                {canVoid && <CancelOrderPanel orderId={order.id} hasAllocations={hasAllocations} />}
              </div>
            </Card>
          )}

          {/* W3E: allocation → pick → pack verification → dispatch → delivery receipt live on the fulfilment screens. */}
          <FulfilmentPanel orderId={order.id} />

          {canVoid && ["allocated", "picking", "packed"].includes(status) && (
            <Card>
              <CardTitle>Cancel order</CardTitle>
              <CancelOrderPanel orderId={order.id} hasAllocations={hasAllocations} />
            </Card>
          )}

          {status === "cancelled" && (
            <Banner tone="neu" title="Cancelled">
              This order was cancelled; see the audit log for the reason.
            </Banner>
          )}

          {ctx.can("sales.sales_order.create") && ["shipped", "invoiced", "closed", "cancelled"].includes(status) && (
            <Card>
              <CardTitle>Reorder</CardTitle>
              <ReorderForm orderId={order.id} today={manilaToday()} />
            </Card>
          )}

          <Card>
            <CardTitle>History</CardTitle>
            {transitions.length === 0 ? (
              <p className="text-[13px] text-muted">No state changes recorded for this order (entered before Wave 3).</p>
            ) : (
              <ol className="flex flex-col gap-2 text-[13px]">
                {transitions.map((t) => (
                  <li key={t.id} className="flex flex-col border-l-2 border-line pl-3">
                    <span className="font-medium">
                      {t.fromState ? `${t.fromState.replace(/_/g, " ")} → ` : ""}
                      {t.toState.replace(/_/g, " ")}
                    </span>
                    <span className="text-[12px] text-muted">
                      {fmtDateTime(t.occurredAt)} · {t.actorName}
                      {t.reason ? ` · ${t.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
