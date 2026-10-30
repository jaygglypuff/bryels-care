import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { fulfilmentForOrder, getOrder, manilaToday, orderDaysLate, salesBusinessDate } from "@/modules/sales";
import { productionOrdersForSalesOrder, salesOrderShortfalls, type MakeForLine } from "@/modules/production";
import { Card, CardTitle, Dl, LinkButton, Table, Td } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { RecordHeader } from "@/ui/record";
import { salesOrderSteps } from "@/ui/record-steps";
import { Forbidden } from "../../forbidden";
import { AllocateForm } from "./order-actions";
import { FulfilmentPanel } from "./fulfilment-panel"; // W3E
import { startPickAction } from "../fulfilment-actions";
import { Cmd } from "../fulfilment-forms";
import { ApproveOrderForm, CancelOrderPanel, ReorderForm, ReturnOrderForm, SubmitOrderForm } from "../orders/order-commercial";
import { LateChip, MaskedNote, Money } from "../orders/sales-ui";
import { orderHistory } from "../orders/order-history";
import { MoreMenu } from "@/ui/more-menu";
import { Help } from "@/ui/help/help";
import { DeleteDraftCard } from "../../delete-draft-button";

export const metadata = { title: "Sales order" };

const DONE: Record<string, string> = {
  confirmed: "Order confirmed. The warehouse can now reserve stock for it.",
  pending_approval: "Submitted. The order needs approval before the warehouse can reserve stock for it.",
  edited: "Draft saved.",
  reordered: "New draft created from the earlier order at today's prices. Check it, then submit.",
  allocated: "Stock reserved (earliest expiry first). Next: start the pick list.",
  dispatched: "Dispatched: stock issued. Delivery receipt",
  delivered: "Delivery recorded.",
  cancelled: "Order cancelled. Any reserved stock was released.",
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
  const daysLate = orderDaysLate(order, salesBusinessDate());
  // "Make for this order" on lines short of stock, for people who can create production orders.
  const toMake: MakeForLine[] = ctx.can("production.work_order.create") ? (await salesOrderShortfalls(ctx, order.id).catch(() => [])).filter((l) => D(l.missing).gt(0)) : [];
  const beingMade = ctx.can("production.work_order.view") ? await productionOrdersForSalesOrder(ctx, order.id) : [];
  const warnings = order.warnings ?? [];
  const fulfilment = await fulfilmentForOrder(ctx, order.id);
  const canSubmit = ctx.can("sales.sales_order.submit");
  const canAllocate = ctx.can("inventory.allocation.create");
  const pickable = !!fulfilment && ["allocated", "partially_shipped"].includes(fulfilment.order.status) && fulfilment.openAllocations > 0 && !fulfilment.openPick && ctx.can("sales.pick.create");
  // One next action (R3): the existing single-click command or link for this status. Commands that need
  // typed input (approval note, reasons) stay in their card below and the header says where.
  const primary =
    status === "draft" && canSubmit ? (
      <SubmitOrderForm orderId={order.id} />
    ) : status === "confirmed" && canAllocate ? (
      <AllocateForm orderId={order.id} label={hasAllocations ? "Reserve the rest of the stock" : "Reserve stock for this order"} />
    ) : fulfilment?.openPick ? (
      <LinkButton href={`/sales/picking/${fulfilment.openPick.id}`} variant="cta" size="lg">Continue pick {fulfilment.openPick.pickNumber}</LinkButton>
    ) : pickable ? (
      <Cmd action={startPickAction} fields={{ orderId: order.id }} label="Start pick list" pending="Starting…" variant="cta" size="lg">
        <p className="text-[13px] text-fg-2">Scan every reserved box (or the lot with a quantity for loose units). Stock moves only at dispatch.</p>
      </Cmd>
    ) : undefined;
  const next = primary ? undefined : status === "pending_approval" && approval?.canApprove ? "Next: approve or return it under Approval below." : undefined;

  return (
    <>
      <RecordHeader
        typeLabel="Customer order"
        reference={order.orderNumber}
        title={customer.name}
        siteCode={ctx.allowedSites.find((x) => x.id === order.siteId)?.code}
        status={status}
        meta={[
          ["Requested delivery", fmtDate(order.requestedDeliveryOn)],
          ["Customer's order no.", order.customerPoNumber],
        ]}
        steps={salesOrderSteps(status)}
        primary={primary}
        next={next}
        secondary={
          <>
            {status === "draft" && ctx.can("sales.sales_order.edit") && (
              <LinkButton href={`/sales/orders/${order.id}/edit`} variant="secondary">
                Edit draft
              </LinkButton>
            )}
            <LinkButton href="/sales" variant="ghost">All orders</LinkButton>
            {canVoid && (
              <MoreMenu>
                <p className="mb-2 text-[13px] text-fg-2">Cancelling stops the order for good{hasAllocations ? " and releases its reserved stock" : ""}. Give the reason.</p>
                <CancelOrderPanel orderId={order.id} hasAllocations={hasAllocations} />
              </MoreMenu>
            )}
          </>
        }
      />

      {daysLate > 0 && (
        <div className="mb-4" data-testid="order-late-banner">
          <Banner tone="bad" title={`Late ${daysLate} ${daysLate === 1 ? "day" : "days"}`}>
            The customer asked for delivery by {fmtDate(order.requestedDeliveryOn)} and the goods have not been shipped yet.
          </Banner>
        </div>
      )}

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
                ["Customer's order no.", order.customerPoNumber ?? "—"],
                [
                  "Requested delivery",
                  <span key="d" className="inline-flex flex-wrap items-center gap-2">
                    {fmtDate(order.requestedDeliveryOn)} <LateChip days={daysLate} />
                  </span>,
                ],
                ["Ship to", order.shipToText ?? customer.shipToAddress],
                ["Credit check", creditCheckText(order.creditCheckStatus, status)],
                ["Approval", approvalText(status, order.approvedAt, order.approvalNote)],
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
                    <span className="min-w-0 font-medium">{l.productName}</span>
                    <Money className="whitespace-nowrap font-medium tabular" value={l.value} />
                  </div>
                  <p className="text-[12px] text-muted">{l.sku}</p>
                  <p className="text-[13px] tabular text-muted">
                    {fmtQty(l.qtyUnits, "pcs", 0)} × <Money value={l.unitPrice} />
                    {l.customerItemCode ? ` · customer code ${l.customerItemCode}` : ""}
                    {showAlloc && (status === "shipped" ? ` · shipped ${fmtQty(l.qtyUnits, "", 0)}` : ` · reserved ${fmtQty(l.allocated, "", 0)}`)}
                  </p>
                </li>
              ))}
              <li className="flex justify-between py-2.5 font-semibold tabular">
                <span>Total {fmtQty(totalPcs, "pcs", 0)}</span>
                <Money value={total} />
              </li>
            </ul>
            <Table className="hidden sm:block" head={["#", "SKU", "Product", "Qty", "Unit price", "Value", ...(showAlloc ? ["Reserved"] : [])]}>
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

          {(toMake.length > 0 || beingMade.length > 0) && (
            <Card>
              <CardTitle>Production for this order</CardTitle>
              {toMake.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {toMake.map((l) => (
                    <li key={l.salesOrderLineId} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line p-3">
                      <div className="min-w-0 text-[14px]">
                        <p className="font-medium">{l.productName}</p>
                        <p className="text-fg-2">
                          {fmtQty(l.missing, "pcs", 0)} missing · ordered {fmtQty(l.ordered, "", 0)}, free stock {fmtQty(l.freeStock, "", 0)}
                          {D(l.alreadyInProduction).gt(0) ? `, already being made ${fmtQty(l.alreadyInProduction, "", 0)}` : ""}
                        </p>
                      </div>
                      <LinkButton href={`/production/orders/new?salesOrderLine=${l.salesOrderLineId}`} variant="cta">Make for this order</LinkButton>
                    </li>
                  ))}
                </ul>
              )}
              {beingMade.length > 0 && (
                <ul className={toMake.length > 0 ? "mt-3 flex flex-col gap-1.5 text-[14px]" : "flex flex-col gap-1.5 text-[14px]"}>
                  {beingMade.map((p) => (
                    <li key={p.id}>
                      <Link className="text-primary-text hover:underline" href={`/production/orders/${p.id}`}>{p.number}</Link> · {p.productName} · {p.statusLabel}
                      {p.subtitle ? ` · ${p.subtitle}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {hasAllocations && (
            <Card>
              <CardTitle>{status === "shipped" ? "Shipped lots" : "Reserved stock (earliest expiry first)"}</CardTitle>
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

          {status === "draft" && !canSubmit && (
            <Card>
              <CardTitle>Draft</CardTitle>
              <p className="text-[13px] text-muted">Waiting for sales to submit this order.</p>
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
              </div>
            </Card>
          )}

          {status === "confirmed" && ((hasAllocations && shortLines.length > 0) || !canAllocate) && (
            <Card>
              <CardTitle>Stock</CardTitle>
              <div className="flex flex-col gap-3">
                {hasAllocations && shortLines.length > 0 && (
                  <Banner tone="warn" title="Only part of the stock is reserved">
                    {shortLines.map((l) => `${l.productName}: ${fmtQty(l.shortfall, "pcs", 0)} short`).join("; ")}. The order waits until every line has stock reserved.
                  </Banner>
                )}
                {!canAllocate && <p className="text-[13px] text-muted">Waiting for the warehouse to reserve stock. They take approved stock with the earliest expiry first, with at least {customer.minShelfLifeDays} days of shelf life left.</p>}
              </div>
            </Card>
          )}

          {/* W3E: allocation → pick → pack verification → dispatch → delivery receipt live on the fulfilment screens. */}
          <FulfilmentPanel orderId={order.id} data={fulfilment} hideNext />

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
            <ol className="flex flex-col gap-2 text-[13px]" data-testid="order-history">
              {orderHistory(transitions, { at: order.createdAt, byName: data.createdByName }).map((h) => (
                <li key={h.key} className="flex flex-col border-l-2 border-line pl-3">
                  <span className="font-medium">{h.label}</span>
                  <span className="text-[12px] text-muted">
                    {fmtDateTime(h.at)}
                    {h.who ? ` · ${h.who}` : ""}
                    {h.reason ? ` · ${h.reason}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        {status === "draft" && (ctx.can("sales.sales_order.edit") || ctx.can("sales.sales_order.create")) && <DeleteDraftCard kind="sales_order" id={order.id} what="sales order" />}
      </div>
    </>
  );
}

/** Credit check in plain words. Orders confirmed before the check was recorded say so instead of "pending". */
function creditCheckText(credit: string, status: string): string {
  if (credit === "passed") return "Passed";
  if (credit === "not_required") return "Not needed for this customer";
  if (credit === "overridden") return "Over the limit, approved by a manager";
  if (credit === "failed") return "Not passed: needs approval";
  return ["draft", "submitted"].includes(status) ? "Not checked yet (checked when the order is submitted)" : status === "pending_approval" ? "Pending" : "Not recorded";
}

/** Approval in plain words: who approved, or why none was needed. */
function approvalText(status: string, approvedAt: Date | string | null, note: string | null): string {
  if (approvedAt) return `Approved ${fmtDateTime(approvedAt)}${note ? ` (${note})` : ""}`;
  if (status === "pending_approval") return "Waiting for approval";
  if (["draft", "submitted"].includes(status)) return "Not submitted yet";
  if (status === "cancelled") return "—";
  return "Not needed";
}
