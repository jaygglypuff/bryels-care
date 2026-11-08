import Link from "next/link";
import { NextApprover } from "@/ui/next-approver";
import { packCheckNext, salesNextActors } from "@/modules/sales";
import { PlaceName } from "@/ui/inventory/place-name";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, daysUntil, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { AMENDABLE_ORDER_STATUSES, customerEmailReady, fulfilmentForOrder, getOrder, manilaToday, orderDaysLate, salesBusinessDate } from "@/modules/sales";
import { earlierOrdersNeedingSameStock, orderCanShipFrom, productionOrdersForSalesOrder, salesOrderShortfalls, type MakeForLine } from "@/modules/production";
import { fmtDayMonth } from "@/lib/qty";
import { AllocateForm, EmailConfirmation, LineChange } from "./order-actions";
import { Card, CardTitle, Dl, LinkButton } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, StatusChip } from "@/ui/status";
import { RecordHeader } from "@/ui/record";
import { salesOrderSteps } from "@/ui/record-steps";
import { Forbidden } from "../../forbidden";
import { FulfilmentPanel } from "./fulfilment-panel"; // W3E
import { askPlannerToMakeAction, releaseAllocationsAction, startPickAction } from "../fulfilment-actions";
import { Cmd, ReasonCmd } from "../fulfilment-forms";
import { ApproveOrderForm, CancelOrderPanel, ReorderForm, ReturnOrderForm, SubmitOrderForm } from "../orders/order-commercial";
import { LateChip, MaskedNote, Money, salesWord } from "../orders/sales-ui";
import { orderHistory } from "../orders/order-history";
import { DoNext, whoDoes } from "../next-step";
import { billingStepOfOrder } from "@/modules/finance";
import { billingStepWords } from "@/lib/billing-step-words";
import { LineName } from "@/ui/line-name";
import { Help } from "@/ui/help/help";
import { DeleteDraftButton } from "../../delete-draft-button";

export const metadata = { title: "Customer order" };

const DONE: Record<string, string> = {
  confirmed: "Order confirmed. Next: the stock is set aside for it.",
  pending_approval: "Saved. The order needs an OK before it is confirmed.",
  edited: "Draft saved.",
  fromquote: "Draft order made from the price offer. Check it, then press “Confirm the order”.",
  reordered: "New draft made from the earlier order at today's prices. Check it, then confirm it.",
  allocated: "Stock set aside (the oldest expiry first). Next: get it from the shelf.",
  dispatched: "Sent out: stock taken off the shelf. Delivery receipt",
  delivered: "Delivery recorded.",
  cancelled: "Order cancelled. Any stock that was set aside is free again.",
};

export default async function OrderDetailPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="customer orders" permission="sales.sales_order.view" />;
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
  // ADR-110 C4: the shortage card for everyone who sees the order (same free-stock rule as set-aside, C2).
  // Planners make the production order; sales asks the planner (a message and a Home line).
  // Finding 1 (live check 2026-11-06): the one order-cover rule; stock waiting for QA or being made is "coming", not "needs making".
  const shortfalls: MakeForLine[] = await salesOrderShortfalls(ctx, order.id).catch(() => []);
  const toMake = shortfalls.filter((l) => D(l.missing).gt(0));
  const comingLines = shortfalls.filter((l) => D(l.missing).lte(0) && l.comingText);
  const canMake = ctx.can("production.work_order.create");
  const canAsk = !canMake && ctx.can("sales.sales_order.create");
  const beingMade = ctx.can("production.work_order.view") ? await productionOrdersForSalesOrder(ctx, order.id) : [];
  // ADR-131: when can it ship, who is due earlier, can lines be changed, can the confirmation be emailed.
  const shipFrom = await orderCanShipFrom(ctx, order.id).catch(() => null);
  const shipFromText = !shipFrom || ["draft", "cancelled", "closed"].includes(status) ? null : shipFrom.date ? (shipFrom.date === manilaToday() ? "today" : fmtDayMonth(shipFrom.date)) : shipFrom.asked ? "not known yet – the planner has been asked" : "not known yet – it needs making";
  const earlier = status === "confirmed" ? await earlierOrdersNeedingSameStock(ctx, order.id).catch(() => []) : [];
  const canAmend = (AMENDABLE_ORDER_STATUSES as readonly string[]).includes(status) && ctx.can("sales.sales_order.edit");
  const confirmable = ["confirmed", "allocated", "picking", "packed", "partially_shipped"].includes(status);
  const canGiveConfirmation = confirmable && ctx.can("sales.sales_order.submit");
  const emailReady = customerEmailReady().ready;
  const setAsideNow = lines.reduce((s, l) => s.plus(l.allocated), new Decimal(0));
  const allocateConfirm = `Set the stock aside for ${customer.name}?${earlier.length ? ` ${earlier.map((e) => `Order ${e.orderNumber} (${e.customerName}, due ${fmtDayMonth(e.requestedDeliveryOn)}) is due earlier and also needs this stock.`).join(" ")} Stock should go first to the order due first.` : ""}`;
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
        <DoNext text="Next: confirm the order. The system checks the customer's credit; within limits it is confirmed at once. Nothing is sent to the customer.">
          <SubmitOrderForm orderId={order.id} />
        </DoNext>
      ) : (
        <DoNext text="This order is a draft." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.sales_order.submit", order.siteId, "the sales team")} to confirm it.`} />
      );
    if (status === "pending_approval" || status === "submitted")
      return approval?.canApprove ? (
        <DoNext text="Next: approve this order, or send it back with a reason." action={{ label: "Approve now", href: "#approve" }} />
      ) : (
        <DoNext
          text={mine ? "You sent this order, so someone else approves it." : "This order needs approval."}
          waitingFor={<NextApprover next={await salesNextActors(ctx, "sales_order", order.id)} inline />}
        />
      );
    if (status === "confirmed")
      return canAllocate ? (
        <DoNext text={hasAllocations ? "Next: set aside the rest of the stock." : "Next: set aside the stock for this order (the oldest expiry first)."}>
          {earlier.length > 0 && (
            <p className="mb-2 rounded-[10px] bg-[var(--warn-bg)] px-3 py-2 text-[14px] text-[var(--warn-fg)]" data-testid="earlier-order">
              {earlier.map((e) => `Order ${e.orderNumber} (${e.customerName}, due ${fmtDayMonth(e.requestedDeliveryOn)}) is due earlier and also needs this stock.`).join(" ")} Stock goes first to the order due first: set that one aside first unless you agreed otherwise.
            </p>
          )}
          <AllocateForm orderId={order.id} label={hasAllocations ? "Set aside the rest" : "Set aside the stock"} confirm={allocateConfirm} />
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
        <DoNext text="Items are off the shelf." waitingFor={shipments.find((x) => x.status === "picked") ? <NextApprover next={await packCheckNext(ctx, { shipmentId: shipments.find((x) => x.status === "picked")!.id })} inline /> : `Waiting for ${await whoDoes(ctx, "inventory.pack.approve", order.siteId, "a checker")} to check the box a second time.`} />
      );
    if (openShipment?.status === "packed")
      return ctx.can("sales.shipment.post") ? (
        <DoNext text="Next: send it out (driver and plate)." action={{ label: "Send out", href: `/sales/shipments/${openShipment.id}` }} />
      ) : (
        <DoNext text="The box is checked." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.shipment.post", order.siteId, "the warehouse")} to send it out.`} />
      );
    // ADR-124: once sent out, the order's next step follows the invoice of the delivery furthest behind.
    if (status === "shipped" || status === "partially_shipped" || status === "invoiced") {
      const fallback = { stage: status === "invoiced" ? ("billed" as const) : ("not_billed" as const), invoice: null, next: null };
      const b = billingStepWords((await billingStepOfOrder(ctx, order.id).catch(() => null)) ?? fallback, "Sent out to the customer.");
      return <DoNext text={b.text} waitingFor={b.waitingFor} action={b.action} />;
    }
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
          ...(shipFromText ? ([["Can ship from", <span key="csf" data-testid="can-ship-from">{shipFromText}</span>]] as [string, React.ReactNode][]) : []),
          ["Total", <Money key="t" value={total} />],
        ]}
        steps={salesOrderSteps(status, {
          setAside: { done: setAsideNow.toNumber(), of: totalPcs.toNumber() },
          // ADR-110 C0: the delivery tells "waiting for the second check" and "proof of delivery saved".
          delivery: shipments.some((x) => x.status === "picked") ? "picked" : shipments.length > 0 && shipments.filter((x) => !["cancelled", "reversed"].includes(x.status)).every((x) => x.status === "delivered") ? "delivered" : null,
        })}
        back={{ href: "/sales", label: "Customer orders" }}
        secondary={
          canEditDraft ? (
            <LinkButton href={`/sales/orders/${order.id}/edit`} variant="secondary" size="sm">
              Change the draft
            </LinkButton>
          ) : undefined
        }
        actions={
          <>
            <Help screen="sales.order" />
            <MoreMenu compact>
              <div className="flex flex-col gap-3">
                {canGiveConfirmation && (
                  <div className="flex flex-col gap-2" data-testid="order-confirmation">
                    <p className="text-[13px] text-fg-2">Give the customer an order confirmation (what, how many, price, deliver by, can ship from).</p>
                    <LinkButton href={`/print/order-confirmation/${order.id}`} target="_blank" variant="secondary">
                      Print the order confirmation
                    </LinkButton>
                    {customer.email && emailReady ? (
                      <EmailConfirmation orderId={order.id} to={customer.email} canShipFromText={shipFromText ? `Can ship from: ${shipFromText}.` : ""} />
                    ) : (
                      <p className="text-[13px] text-muted">{customer.email ? "Email is not set up: print it instead." : "No email address for this customer: print it instead."}</p>
                    )}
                  </div>
                )}
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
                {!canGiveConfirmation && !canReorder && !releasable && !canVoid && !canDeleteDraft && <p className="text-[14px] text-fg-2">Nothing else to do on this order.</p>}
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
                    <p className={D(l.qtyUnits).isZero() ? "font-medium text-muted line-through" : "font-medium"}>{l.productName}</p>
                    {D(l.qtyUnits).isZero() ? (
                      <p className="text-[13px] text-fg-2" data-testid="line-cancelled">Taken off the order (see What happened).</p>
                    ) : (
                      <p className="text-[13px] tabular text-fg-2">
                        {fmtQty(l.qtyUnits, "pcs", 0)} × <Money value={l.unitPrice} />
                        {l.priceSource && l.priceSource !== "price_list" ? (l.priceSource === "quote" ? " (quoted price)" : " (price changed by hand)") : ""}
                        {showAlloc && (status === "shipped" ? ` · sent ${fmtQty(l.qtyUnits, "", 0)}` : ` · set aside ${fmtQty(l.allocated, "", 0)} of ${fmtQty(l.qtyUnits, "", 0)}`)}
                      </p>
                    )}
                    <p className="font-mono text-[12px] text-muted">
                      {l.sku}
                      {l.customerItemCode ? ` · customer's code ${l.customerItemCode}` : ""}
                    </p>
                    {canAmend && !D(l.qtyUnits).isZero() && <LineChange lineId={l.id} productName={l.productName} qty={D(l.qtyUnits).toString()} sent={l.sent} />}
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

          {(toMake.length > 0 || beingMade.length > 0 || comingLines.length > 0) && (
            <Card>
              <CardTitle>{toMake.length > 0 ? "Not enough stock: it needs making" : comingLines.length > 0 ? "Stock is coming for this order" : "Making it for this order"}</CardTitle>
              {comingLines.length > 0 && (
                <ul className="mb-3 flex flex-col gap-1.5 text-[14px]">
                  {comingLines.map((l) => (
                    <li key={l.salesOrderLineId}>
                      {/* ADR-131 (bug B10): one plain sentence, no "nothing needs making" next to "short". */}
                      <span className="font-medium">{l.productName}</span>: {l.comingText}. Enough is on the way; no new production order is needed.
                    </li>
                  ))}
                </ul>
              )}
              {toMake.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {toMake.map((l) => (
                    <li key={l.salesOrderLineId} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line p-3">
                      <div className="min-w-0 text-[14px]">
                        <p className="font-medium">{l.productName}</p>
                        <p className="text-fg-2">
                          {fmtQty(l.missing, "pcs", 0)} missing · ordered {fmtQty(l.ordered, "", 0)}, free on the shelf {fmtQty(l.freeStock, "", 0)}
                          {l.comingText ? `, ${l.comingText}` : ""}
                        </p>
                      </div>
                      {canMake ? (
                        // ADR-131 (B-owner problem 2): one button that makes the production order linked to this order line.
                        <LinkButton href={`/production/orders/new?salesOrderLine=${l.salesOrderLineId}`} variant="cta">{`Make the missing ${Number(l.missing).toLocaleString("en-PH")} for this order`}</LinkButton>
                      ) : canAsk && l.asked ? (
                        // ADR-131 (bug B11): once asked, the button becomes the fact.
                        <span className="text-[14px] text-fg-2" data-testid="asked-planner">Asked the planner{l.askedAt ? ` on ${fmtDateTime(l.askedAt)}` : ""}. It shows here when they start.</span>
                      ) : canAsk ? (
                        <Cmd action={askPlannerToMakeAction} fields={{ salesOrderLineId: l.salesOrderLineId }} label={`Ask the planner to make ${Number(l.missing).toLocaleString("en-PH")}`} pending="Asking…" variant="secondary" />
                      ) : (
                        <span className="text-[14px] text-fg-2">The planner makes a production order for it.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {beingMade.length > 0 && (
                <ul className={toMake.length > 0 ? "mt-3 flex flex-col gap-1.5 text-[14px]" : "flex flex-col gap-1.5 text-[14px]"}>
                  {beingMade.map((p) => (
                    // ADR-131 (B-owner problem 2) "Where is it now": what, which step, who, when ready.
                    <li key={p.id} data-testid="where-is-it-now">
                      <span className="font-medium">Where is it now: </span>
                      {p.pieces ? `${Number(p.pieces).toLocaleString("en-PH")} ` : ""}
                      <Link className="text-primary-text hover:underline" href={`/production/orders/${p.id}`}>{p.productName}</Link> · {p.statusLabel.toLowerCase()}
                      {p.who ? ` by ${p.who}` : ""}
                      {p.stepNote ? `, ${p.stepNote.charAt(0).toLowerCase()}${p.stepNote.slice(1)}` : p.subtitle ? ` · ${p.subtitle}` : ""}
                      {p.readyOn ? `, ready about ${fmtDayMonth(p.readyOn)}` : ""} <span className="font-mono text-[12px] text-muted">{p.number}</span>
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
                          <PlaceName name={a.locationName} code={a.locationCode} />
                        </p>
                        <p className="text-[13px] text-fg-2">
                          Expires {fmtDate(a.expiresOn)}
                          {left !== null ? ` (${left} days left)` : ""}{" "}
                          {status !== "shipped" && a.qualityStatus !== "released" && <StatusChip status={a.qualityStatus} />}
                        </p>
                        <p className="text-[13px] text-fg-2">
                          <LineName name={a.productName} code={a.sku} /> · lot <span className="font-mono text-[12px]">{a.lotNumber}</span>
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
              {[...orderHistory(transitions, { at: order.createdAt, byName: data.createdByName }), ...data.lineChanges.map((c) => ({ key: c.id, label: c.label, at: new Date(c.at), who: c.who, reason: c.reason }))].sort((a, b) => a.at.getTime() - b.at.getTime()).map((h) => (
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
  if (credit === "not_required") return "OK (no credit limit set: bigger orders wait for an OK)";
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
