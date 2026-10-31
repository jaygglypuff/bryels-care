import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { fulfilmentForOrder, getOrder, manilaToday, orderDaysLate, salesBusinessDate } from "@/modules/sales";
import { productionOrdersForSalesOrder, salesOrderShortfalls, type MakeForLine } from "@/modules/production";
import { Card, CardTitle, Dl, LinkButton } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, StatusChip } from "@/ui/status";
import { RecordHeader } from "@/ui/record";
import { salesOrderSteps } from "@/ui/record-steps";
import { Forbidden } from "../../forbidden";
import { AllocateForm } from "./order-actions";
import { FulfilmentPanel } from "./fulfilment-panel"; // W3E
import { releaseAllocationsAction, startPickAction } from "../fulfilment-actions";
import { Cmd, ReasonCmd } from "../fulfilment-forms";
import { ApproveOrderForm, CancelOrderPanel, ReorderForm, ReturnOrderForm, SubmitOrderForm } from "../orders/order-commercial";
import { LateChip, MaskedNote, Money, salesWord } from "../orders/sales-ui";
import { orderHistory } from "../orders/order-history";
import { DoNext, whoDoes } from "../next-step";
import { Help } from "@/ui/help/help";
import { DeleteDraftButton } from "../../delete-draft-button";

export const metadata = { title: "Customer order" };

const DONE: Record<string, string> = {
  confirmed: "Order confirmed. The warehouse can now set aside the stock.",
  pending_approval: "Sent. The order needs approval before the warehouse can set aside the stock.",
  edited: "Draft saved.",
  reordered: "New draft made from the earlier order at today's prices. Check it, then send it.",
  allocated: "Stock set aside (the oldest expiry first). Next: get it from the shelf.",
  dispatched: "Sent out: stock taken off the shelf. Delivery receipt",
  delivered: "Delivery recorded.",
  cancelled: "Order cancelled. Any stock that was set aside is free again.",
};

export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="customer orders" />;
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
  const pickable = !!fulfilment && ["allocated", "partially_shipped"].includes(fulfilment.order.status) && fulfilment.openAllocations > 0 && !fulfilment.openPick;
  const releasable = pickable && ctx.can("inventory.allocation.void");
  const openShipment = fulfilment?.shipments.find((s) => ["picked", "packed"].includes(s.status));
  const mine = order.createdBy === ctx.userId || order.submittedBy === ctx.userId;
  const canEditDraft = status === "draft" && ctx.can("sales.sales_order.edit");
  const canDeleteDraft = status === "draft" && (ctx.can("sales.sales_order.edit") || ctx.can("sales.sales_order.create"));
  const canReorder = ctx.can("sales.sales_order.create") && ["shipped", "invoiced", "closed", "cancelled"].includes(status);

  /** The one next step, by status (ADR-088): a green button when this person can act, else who we wait for. */
  const next = await (async () => {
    if (status === "draft")
      return canSubmit ? (
        <DoNext text="Next: send the order. The system checks the customer's credit; within limits it is confirmed at once.">
          <SubmitOrderForm orderId={order.id} />
        </DoNext>
      ) : (
        <DoNext text="This order is a draft." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.sales_order.submit", order.siteId, "the sales team")} to send it.`} />
      );
    if (status === "pending_approval" || status === "submitted")
      return approval?.canApprove ? (
        <DoNext text="Next: approve this order, or send it back with a reason." action={{ label: "Approve now", href: "#approve" }} />
      ) : (
        <DoNext
          text={mine ? "You sent this order, so someone else approves it." : "This order needs approval."}
          waitingFor={`Waiting for ${await whoDoes(ctx, "sales.sales_order.approve", order.siteId, "the approver")} to approve.`}
        />
      );
    if (status === "confirmed")
      return canAllocate ? (
        <DoNext text={hasAllocations ? "Next: set aside the rest of the stock." : "Next: set aside the stock for this order (the oldest expiry first)."}>
          <AllocateForm orderId={order.id} label={hasAllocations ? "Set aside the rest" : "Set aside the stock"} />
        </DoNext>
      ) : (
        <DoNext text="Order confirmed." waitingFor={`Waiting for ${await whoDoes(ctx, "inventory.allocation.create", order.siteId, "the warehouse")} to set aside the stock.`} />
      );
    if (fulfilment?.openPick)
      return ctx.can("sales.pick.create") ? (
        <DoNext text="Next: get the items from the shelf." action={{ label: "Continue getting from shelf", href: `/sales/picking/${fulfilment.openPick.id}` }} />
      ) : (
        <DoNext text="The warehouse is getting the items from the shelf." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.pick.create", order.siteId, "the warehouse")}.`} />
      );
    if (pickable)
      return ctx.can("sales.pick.create") ? (
        <DoNext text="Next: get the items from the shelf. Scan each box; stock leaves only when it is sent out.">
          <Cmd action={startPickAction} fields={{ orderId: order.id }} label="Get from shelf" pending="Starting…" variant="cta" size="lg" />
        </DoNext>
      ) : (
        <DoNext text="Stock is set aside." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.pick.create", order.siteId, "the warehouse")} to get it from the shelf.`} />
      );
    if (openShipment?.status === "picked")
      return ctx.can("inventory.pack.approve") ? (
        <DoNext text="Next: second check of the box (by someone who did not get it from the shelf)." action={{ label: "Check the box", href: `/sales/packing/${openShipment.id}` }} />
      ) : (
        <DoNext text="Items are off the shelf." waitingFor={`Waiting for ${await whoDoes(ctx, "inventory.pack.approve", order.siteId, "a checker")} to check the box a second time.`} />
      );
    if (openShipment?.status === "packed")
      return ctx.can("sales.shipment.post") ? (
        <DoNext text="Next: send it out (driver and plate)." action={{ label: "Send out", href: `/sales/shipments/${openShipment.id}` }} />
      ) : (
        <DoNext text="The box is checked." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.shipment.post", order.siteId, "the warehouse")} to send it out.`} />
      );
    if (status === "shipped" || status === "partially_shipped")
      return ctx.can("finance.invoice.create") ? (
        <DoNext text="Next: send the invoice." action={{ label: "Send the invoice", href: "/finance/invoices" }} />
      ) : (
        <DoNext text="Sent out to the customer." waitingFor={`Waiting for ${await whoDoes(ctx, "finance.invoice.create", order.siteId, "finance")} to send the invoice.`} />
      );
    if (status === "invoiced") return <DoNext text="Billed. Nothing more to do on this order until the customer pays." />;
    if (status === "closed") return <DoNext text="Done. Nothing more to do." />;
    if (status === "cancelled") return <DoNext text="Cancelled. Nothing more to do; the reason is in the history below." />;
    return null;
  })();

  return (
    <>
      <RecordHeader
        typeLabel="Customer order"
        reference={order.orderNumber}
        title={customer.name}
        siteCode={ctx.allowedSites.find((x) => x.id === order.siteId)?.code}
        status={status}
        statusLabel={salesWord(status)}
        meta={[
          ["Deliver by", fmtDate(order.requestedDeliveryOn)],
          ["Total", <Money key="t" value={total} />],
        ]}
        steps={salesOrderSteps(status)}
        secondary={
          <>
            {canEditDraft && (
              <LinkButton href={`/sales/orders/${order.id}/edit`} variant="secondary">
                Change the draft
              </LinkButton>
            )}
            <LinkButton href="/sales" variant="ghost">All orders</LinkButton>
            <MoreMenu>
              <div className="flex flex-col gap-3">
                {canReorder && (
                  <div>
                    <p className="mb-2 text-[14px] font-medium">Order the same again</p>
                    <ReorderForm orderId={order.id} today={manilaToday()} />
                  </div>
                )}
                {releasable && (
                  <div>
                    <p className="mb-1 text-[13px] text-fg-2">Let the set-aside stock go (for example the customer moved the delivery).</p>
                    <ReasonCmd action={releaseAllocationsAction} fields={{ orderId: order.id }} label="Let the stock go" placeholder="e.g. Customer postponed the delivery" />
                  </div>
                )}
                {canVoid && (
                  <div>
                    <p className="mb-2 text-[13px] text-fg-2">Cancelling stops the order for good{hasAllocations ? " and frees the stock that was set aside" : ""}. Give the reason.</p>
                    <CancelOrderPanel orderId={order.id} hasAllocations={hasAllocations} />
                  </div>
                )}
                {canDeleteDraft && (
                  <div>
                    <p className="mb-2 text-[13px] text-fg-2">Nobody has seen this draft yet, so it can be deleted.</p>
                    <DeleteDraftButton kind="sales_order" id={order.id} what="this customer order" />
                  </div>
                )}
                <Help screen="sales.order" />
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for one customer order: what they ordered, where it is now, and the next step.</PageIntro>
      {next}

      {daysLate > 0 && (
        <div className="mb-4" data-testid="order-late-banner">
          <Banner tone="bad" title={`Late ${daysLate} ${daysLate === 1 ? "day" : "days"}`}>
            The customer wanted it by {fmtDate(order.requestedDeliveryOn)} and it has not been sent out yet.
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
          {status === "pending_approval" && (
            <Card>
              <span id="approve" className="block scroll-mt-24" />
              <CardTitle>Approval</CardTitle>
              <div className="flex flex-col gap-3">
                <Banner tone="warn" title={`Needs approval: ${reasons.map((r) => r.message.toLowerCase()).join("; ") || "approval rule"}`}>
                  {approval?.next ? `Step ${approval.next.step}: ${approval.next.label}.` : "Waiting for the approver."} Sent {fmtDateTime(order.submittedAt)}.
                </Banner>
                {approval && approval.steps.length > 0 && (
                  <ol className="flex flex-col gap-1 text-[13px]">
                    {approval.steps.map((st) => (
                      <li key={st.step} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {st.step}. {st.label}
                        </span>
                        <span className={st.done ? "text-[var(--ok-fg)]" : "text-muted"}>
                          {st.done ? `Approved by ${st.approvals.map((x) => x.name).join(", ")}` : "Not yet"}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {approval?.canApprove ? (
                  <>
                    {mine && <p className="text-[13px] text-fg-2">You sent this order yourself. As owner or site manager you may approve it; it is recorded as &quot;approved by you (own request)&quot;.</p>}
                    <ApproveOrderForm orderId={order.id} />
                    <ReturnOrderForm orderId={order.id} />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{mine ? "You entered or sent this order, so another person approves it." : "Only the approver named by the approval rule can decide."}</p>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>What they ordered</CardTitle>
            <ul className="flex flex-col divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{l.productName}</p>
                    <p className="text-[13px] tabular text-fg-2">
                      {fmtQty(l.qtyUnits, "pcs", 0)} × <Money value={l.unitPrice} />
                      {l.priceSource && l.priceSource !== "price_list" ? (l.priceSource === "quote" ? " (quoted price)" : " (price typed by hand)") : ""}
                      {showAlloc && (status === "shipped" ? ` · sent ${fmtQty(l.qtyUnits, "", 0)}` : ` · set aside ${fmtQty(l.allocated, "", 0)} of ${fmtQty(l.qtyUnits, "", 0)}`)}
                    </p>
                    <p className="font-mono text-[12px] text-muted">
                      {l.sku}
                      {l.customerItemCode ? ` · customer's code ${l.customerItemCode}` : ""}
                    </p>
                  </div>
                  <Money className="whitespace-nowrap text-right font-semibold tabular" value={l.value} />
                </li>
              ))}
              <li className="flex justify-between gap-3 py-2.5 font-semibold tabular">
                <span>Total · {fmtQty(totalPcs, "pcs", 0)}</span>
                <Money className="text-right" value={total} />
              </li>
            </ul>
            <MaskedNote fields={data._masked} />
          </Card>

          {(toMake.length > 0 || beingMade.length > 0) && (
            <Card>
              <CardTitle>Making it for this order</CardTitle>
              {toMake.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {toMake.map((l) => (
                    <li key={l.salesOrderLineId} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line p-3">
                      <div className="min-w-0 text-[14px]">
                        <p className="font-medium">{l.productName}</p>
                        <p className="text-fg-2">
                          {fmtQty(l.missing, "pcs", 0)} missing · ordered {fmtQty(l.ordered, "", 0)}, free on the shelf {fmtQty(l.freeStock, "", 0)}
                          {D(l.alreadyInProduction).gt(0) ? `, already being made ${fmtQty(l.alreadyInProduction, "", 0)}` : ""}
                        </p>
                      </div>
                      <LinkButton href={`/production/orders/new?salesOrderLine=${l.salesOrderLineId}`} variant="secondary">Make for this order</LinkButton>
                    </li>
                  ))}
                </ul>
              )}
              {beingMade.length > 0 && (
                <ul className={toMake.length > 0 ? "mt-3 flex flex-col gap-1.5 text-[14px]" : "flex flex-col gap-1.5 text-[14px]"}>
                  {beingMade.map((p) => (
                    <li key={p.id}>
                      <Link className="text-primary-text hover:underline" href={`/production/orders/${p.id}`}>{p.productName}</Link> · {p.statusLabel}
                      {p.subtitle ? ` · ${p.subtitle}` : ""} <span className="font-mono text-[12px] text-muted">{p.number}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {hasAllocations && (
            <Card>
              <CardTitle>{status === "shipped" ? "What was sent" : "Stock set aside (the oldest expiry first)"}</CardTitle>
              <ul className="flex flex-col divide-y divide-line">
                {allocations.map((a) => {
                  const left = daysUntil(a.expiresOn);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0 text-[14px]">
                        <p className="font-medium">
                          Shelf {a.locationCode} <span className="font-normal text-fg-2">· {a.locationName}</span>
                        </p>
                        <p className="text-[13px] text-fg-2">
                          Expires {fmtDate(a.expiresOn)}
                          {left !== null ? ` (${left} days left)` : ""}{" "}
                          {status !== "shipped" && a.qualityStatus !== "released" && <StatusChip status={a.qualityStatus} />}
                        </p>
                        <p className="font-mono text-[12px] text-muted">
                          {a.sku} · lot {a.lotNumber}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-[16px] font-semibold tabular">{fmtQty(a.qtyUnits, "pcs", 0)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {warnings.length > 0 && (
            <Banner tone="warn" title="Check before sending out">
              {warnings.map((w) => w.message).join("; ")}.
            </Banner>
          )}

          {status === "confirmed" && hasAllocations && shortLines.length > 0 && (
            <Banner tone="warn" title="Only part of the stock is set aside">
              {shortLines.map((l) => `${l.productName}: ${fmtQty(l.shortfall, "pcs", 0)} short`).join("; ")}. The order waits until every product has stock set aside.
            </Banner>
          )}

          {/* W3E: set aside → get from shelf → second check of the box → send out → delivery receipt live on the fulfilment screens. */}
          <FulfilmentPanel orderId={order.id} data={fulfilment} hideNext />

          <Card>
            <CardTitle>About this order</CardTitle>
            <Dl
              items={[
                ["Customer", ctx.can("masterdata.customer.view") ? <Link className="text-primary-text hover:underline" href={`/sales/customers/${customer.id}`}>{customer.name}</Link> : customer.name],
                [
                  "Deliver by",
                  <span key="d" className="inline-flex flex-wrap items-center gap-2">
                    {fmtDate(order.requestedDeliveryOn)} <LateChip days={daysLate} />
                  </span>,
                ],
                ["Deliver to", order.shipToText ?? customer.shipToAddress],
                ["Credit check", creditCheckText(order.creditCheckStatus, status)],
                ["Approval", approvalText(status, order.approvedAt, order.approvalNote)],
              ]}
            />
            {order.notes && <p className="mt-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-fg-2">{order.notes}</p>}
            <div className="mt-3">
              <MoreDetails>
                <Dl
                  items={[
                    ["Customer's order no.", order.customerPoNumber ?? "—"],
                    ["Bill to", billTo ? `${billTo.label}: ${[billTo.line1, billTo.city].filter(Boolean).join(", ")}` : shipTo ? "Same as deliver-to" : "—"],
                    ...(quote ? ([["From price offer", <Link key="q" className="text-primary-text hover:underline" href={`/sales/quotations/${quote.id}`}>{quote.quoteNumber}</Link>]] as [string, React.ReactNode][]) : []),
                    ["Shortest shelf life allowed", `${customer.minShelfLifeDays} days left when sent out`],
                    ["Entered", `${fmtDateTime(order.createdAt)}${data.createdByName ? ` · ${data.createdByName}` : ""}`],
                  ]}
                />
              </MoreDetails>
            </div>
          </Card>

          <Card>
            <CardTitle>What happened</CardTitle>
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
      </div>
    </>
  );
}

/** Credit check in plain words. Orders confirmed before the check was recorded say so instead of "pending". */
function creditCheckText(credit: string, status: string): string {
  if (credit === "passed") return "OK";
  if (credit === "not_required") return "Not needed for this customer";
  if (credit === "overridden") return "Over the limit, approved by a manager";
  if (credit === "failed") return "Not OK: needs approval";
  return ["draft", "submitted"].includes(status) ? "Not checked yet (checked when the order is sent)" : status === "pending_approval" ? "Waiting" : "Not recorded";
}

/** Approval in plain words: who approved, or why none was needed. */
function approvalText(status: string, approvedAt: Date | string | null, note: string | null): string {
  if (approvedAt) return `Approved ${fmtDateTime(approvedAt)}${note ? ` (${note})` : ""}`;
  if (status === "pending_approval") return "Waiting for approval";
  if (["draft", "submitted"].includes(status)) return "Not sent yet";
  if (status === "cancelled") return "—";
  return "Not needed";
}
