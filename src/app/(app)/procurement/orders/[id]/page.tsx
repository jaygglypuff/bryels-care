import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtDayMonth } from "@/lib/qty";
import { getPurchaseOrder, procurementNextActors } from "@/modules/procurement";
import { NextApprover } from "@/ui/next-approver";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, Textarea } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { ActionForm } from "@/ui/form";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { NextStepBox } from "@/ui/next-step-box";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { cancelOrderAction, closeOrderAction, confirmOrderAction, decideOrderAction, regenerateDocumentAction, sendOrderAction, shortCloseLineAction, submitOrderAction } from "../../actions";
import { Amount, History, PoChip, Steps, SubNav, approverWords, fmtBase, money } from "../../_ui";
import { DeleteDraftCard } from "../../../delete-draft-button";
import { waitingFor } from "../../../waiting-for";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase order" };

const LINE_WORD: Record<string, string> = { open: "Still coming", received: "All here", short_closed: "Rest not coming", cancelled: "Cancelled" };
const RECEIPT_WORD: Record<string, string> = { draft: "Not saved yet", posted: "Saved to stock", reversed: "Undone (kept on record)", cancelled: "Cancelled" };

/** One purchase order: supplier first, the next step by state, items as phone rows, rare actions in ⋯ More. */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="purchase orders" permission="procurement.purchase_order.view" />;
  const { id } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getPurchaseOrder>>;
  try {
    v = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Purchase order not found" action={<LinkButton href="/procurement/orders" variant="secondary">All orders</LinkButton>}>
          It does not exist or is not at one of your sites. Ask purchasing if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const { po, can } = v;
  // Who approves (or sends) next, by name and role (docs/NEXT_APPROVER.md).
  const next = await procurementNextActors(ctx, "purchase_order", po.id);
  const linkCls = "inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline";
  const waiting = `Waiting for ${approverWords(v.progress.next)} to approve${v.progress.steps.length > 1 && v.progress.next ? ` (step ${v.progress.next.step} of ${v.progress.steps.length})` : ""}.`;
  const canRecordDoc = ["sent", "partially_received", "received"].includes(po.status) && ctx.canAt("procurement.purchase_order.post", po.siteId) && ctx.can("documents.generated_document.create");
  const sentOn = ["sent", "partially_received", "received", "closed"].includes(po.status);
  const hasMore = can.print || can.confirm || can.close || can.cancel || canRecordDoc;
  return (
    <>
      <RecordHeader
        back={{ href: "/procurement/orders", label: "Purchase orders" }}
        typeLabel="Purchase order"
        reference={po.poNumber}
        title={v.supplier.name}
        chip={<PoChip status={po.status} />}
        actions={
          <>
            {hasMore && (
              <MoreMenu compact>
                <div className="flex flex-col gap-3">
                  {can.print && (
                    <a className={linkCls} href={`/print/purchase-order/${po.id}`}>
                      Print the order
                    </a>
                  )}
                  {canRecordDoc && <ActionForm action={regenerateDocumentAction} hidden={{ purchaseOrderId: po.id }} submit={po.generatedDocumentId ? "Make the order paper again" : "Make the order paper"} variant="secondary" />}
                  {can.confirm && (
                    <div className="border-t border-line pt-3">
                      <p className="mb-2 text-[14px] font-medium">The supplier answered</p>
                      <ActionForm action={confirmOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Save the supplier's answer" variant="secondary">
                        <Field label="Supplier's own order number" htmlFor="supplierReference">
                          <Input id="supplierReference" name="supplierReference" defaultValue={po.supplierReference ?? ""} />
                        </Field>
                        <Field label="Promised delivery date" htmlFor="promisedDate">
                          <Input id="promisedDate" type="date" name="promisedDate" defaultValue={po.promisedDate ?? ""} />
                        </Field>
                      </ActionForm>
                    </div>
                  )}
                  {can.close && (
                    <div className="border-t border-line pt-3">
                      <p className="mb-2 text-[13px] text-muted">{po.status === "received" ? "Everything is here: close the order." : "Close when the rest will not come. Items still open are marked “rest not coming”."}</p>
                      <ActionForm action={closeOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Close the order" variant="secondary" confirm="Close this order? Nothing more will be expected.">
                        <Textarea name="reason" rows={2} placeholder={po.status === "received" ? "Note (you can skip this)" : "Why the rest will not come"} aria-label="Reason" />
                      </ActionForm>
                    </div>
                  )}
                  {can.cancel && (
                    <div className="border-t border-line pt-3">
                      <p className="mb-2 text-[13px] text-muted">Cancel only an order made by mistake or no longer needed. It stays on record.</p>
                      <ActionForm action={cancelOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Cancel the order" variant="danger" confirm="Cancel this purchase order? It stays on record as cancelled.">
                        <Textarea name="reason" rows={2} placeholder="Why" aria-label="Reason" required />
                      </ActionForm>
                    </div>
                  )}
                </div>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for one order to a supplier: what we ordered, who approves it, sending it, and what has arrived.</PageIntro>
      {sp.sent === "1" && <Banner tone="ok" title="Saved and sent for approval">{next ? <NextApprover next={next} inline /> : waiting}</Banner>}
      {sp.sent === "approved" && <Banner tone="ok" title="Saved and approved with its request to buy">No second OK is needed. Next: send it to the supplier.</Banner>}
      {sp.sent === "0" && <Banner tone="warn" title="Saved as a draft">It could not be sent for approval yet. Tap “Send for approval” below to see why.</Banner>}
      {sp.saved && po.status === "draft" && <Banner tone="ok" title="Order saved as a draft">Send it for approval when it is ready.</Banner>}
      {(sp.sent || sp.saved) && <div className="mb-4" />}

      {can.receive ? (
        <NextStep
          text={`Next: the delivery is coming${po.promisedDate || po.expectedDate ? ` (expected ${fmtDayMonth(po.promisedDate ?? po.expectedDate)})` : ""}. When it arrives, receive it here.`}
          action={{ label: "Receive the delivery", href: `/inventory/receive?po=${po.id}` }}
          waitingFor={next?.people.length ? <NextApprover next={next} inline othersOnly /> : undefined}
        />
      ) : can.submit ? (
        <NextStepBox text="Next: send this order for approval.">
          <ActionForm action={submitOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Send for approval" variant="cta">
            <p className="text-[14px] text-fg-2">
              {v.lines.length > 0 && v.lines.every((l) => l.prNumber)
                ? "Made from an approved request to buy: if the supplier, the items and the amount stay within what was approved, it is approved at once. Otherwise the manager is told and approves it."
                : "The manager is told and approves it."}{" "}
              To change the items of a draft, cancel it (⋯ More) and make a new order.
            </p>
          </ActionForm>
        </NextStepBox>
      ) : can.decide ? (
        <NextStepBox text="Next: approve this order, or send it back with what to change.">
          <div className="grid gap-4 sm:grid-cols-2">
            <ActionForm action={decideOrderAction} hidden={{ purchaseOrderId: po.id, decision: "approve" }} submit={v.progress.steps.length > 1 ? `Approve (step ${v.progress.next?.step ?? 1})` : "Approve"} variant="cta" confirm={`Approve this order to ${v.supplier?.name ?? "the supplier"}${po.totalAmount ? ` for ₱${Number(po.totalAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : ""}? Next, purchasing sends it to the supplier.`}>
              <Input name="note" placeholder="Note (you can skip this)" aria-label="Approval note" />
            </ActionForm>
            <ActionForm action={decideOrderAction} hidden={{ purchaseOrderId: po.id, decision: "return" }} submit="Send back to change" variant="secondary">
              <Input name="note" placeholder="What must change?" aria-label="What must change" required />
            </ActionForm>
          </div>
        </NextStepBox>
      ) : can.send ? (
        <NextStepBox text="Next: send this order to the supplier.">
          <ActionForm action={sendOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Send to the supplier" pending="Sending…" variant="cta">
            <label className="flex min-h-[44px] items-center gap-2 text-[15px]">
              <input type="checkbox" name="email" value="yes" className="h-5 w-5" defaultChecked={!!v.supplier.email} disabled={!v.supplier.email} />
              {v.supplier.email ? `Email the order to ${v.supplier.email}` : "The supplier has no email address: print the order (⋯ More) and send it by hand"}
            </label>
          </ActionForm>
        </NextStepBox>
      ) : po.status === "draft" ? (
        <NextStep text="This order is a draft." waitingFor={await waitingFor(ctx, "procurement.purchase_order.submit", po.siteId, "to send it for approval", "purchasing")} />
      ) : po.status === "submitted" ? (
        <NextStep text="This order waits for approval." waitingFor={next ? <NextApprover next={next} inline /> : waiting} />
      ) : po.status === "approved" ? (
        <NextStep text="Approved." waitingFor={next ? <NextApprover next={next} inline /> : await waitingFor(ctx, "procurement.purchase_order.post", po.siteId, "to send it to the supplier", "purchasing")} />
      ) : po.status === "sent" || po.status === "partially_received" ? (
        <NextStep text={po.status === "sent" ? "Sent to the supplier." : "Part of it has arrived."} waitingFor={next ? <NextApprover next={next} inline /> : `Waiting for the delivery${po.expectedDate ? ` (expected ${fmtDate(po.expectedDate)})` : ""}. The warehouse receives it.`} />
      ) : null}

      <SubNav />
      <div className="flex flex-col gap-5">
        {po.isUrgent && <Banner tone="warn" title="Urgent purchase">{po.urgentReason}</Banner>}
        {v.approvedByRequest && (
          <Banner tone="ok" title={`Approved with request to buy ${v.approvedByRequest.join(", ")}`}>
            The items and the amount stay within what was approved on the request, so this order needs no second OK (one approval per purchase).
          </Banner>
        )}
        {po.afterTheFact && (
          <Banner tone="info" title="Made after the goods arrived">
            {po.afterTheFactReason} · from delivery{" "}
            {v.sourceReceipt ? (
              <Link className="font-medium text-primary-text underline" href={`/inventory/receive/${v.sourceReceipt.id}`}>{v.sourceReceipt.receiptNumber}</Link>
            ) : (
              "—"
            )}
            . Everything on it is already here, so nothing more is expected. {po.status === "draft" ? "Check the prices, then send it for approval." : po.status === "submitted" ? "It becomes “All delivered” when approved." : ""}
          </Banner>
        )}

        <Card>
          <CardTitle action={can.seeTotal && po.totalAmount ? <Amount className="text-[18px]">{money(po.totalAmount, po.currency)}</Amount> : undefined}>What we ordered</CardTitle>
          <ul className="flex flex-col divide-y divide-line rounded-[8px] border border-line">
            {v.lines.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-testid="po-line">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{l.materialName}</span>
                    {(sentOn || l.lineStatus !== "open") && <Chip tone={l.lineStatus === "received" ? "ok" : l.lineStatus === "open" ? "info" : "neu"}>{LINE_WORD[l.lineStatus] ?? l.lineStatus.replace(/_/g, " ")}</Chip>}
                  </p>
                  <p className="text-[14px] text-fg-2">
                    Ordered {Number(l.qtyEntered).toLocaleString("en-PH", { maximumFractionDigits: 3 })} {l.uomEntered}
                    {Number(l.qtyReceivedBase) > 0 ? ` · here ${fmtBase(l.qtyReceivedBase, l.baseUom)}` : ""}
                    {sentOn && Number(l.remainingBase) > 0 ? ` · still to come ${fmtBase(l.remainingBase, l.baseUom)}` : ""}
                    {l.expectedDate ? ` · comes ${fmtDate(l.expectedDate)}` : ""}
                    <span className="ml-1 font-mono text-[12px] text-muted">
                      · {l.materialCode}
                      {l.prNumber ? ` · ${l.prNumber}` : ""}
                    </span>
                  </p>
                  {l.shortCloseReason && <p className="text-[13px] text-muted">Rest not coming: {l.shortCloseReason}</p>}
                  {can.shortClose && l.lineStatus === "open" && (
                    <details className="mt-1">
                      <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">The rest of this item will not come</summary>
                      <ActionForm action={shortCloseLineAction} hidden={{ lineId: l.id }} submit="Stop waiting for the rest" variant="secondary" confirm="Nothing more will be expected for this item. Continue?">
                        <Input name="reason" placeholder="Why" aria-label="Why" required />
                      </ActionForm>
                    </details>
                  )}
                </div>
                {can.seePrices && (
                  <div className="shrink-0 text-left sm:text-right">
                    <Amount>{money(l.lineAmount, l.currency)}</Amount>
                    <p className="text-[13px] text-muted">
                      {money(l.unitAmount, l.currency)} per {l.uomEntered}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {can.seePrices && (
            <p className="mt-2 text-right text-[14px] text-fg-2 tabular-nums">
              Items {money(po.subtotalAmount, po.currency)} + tax {money(po.taxAmount, po.currency)} = <strong className="text-fg">{money(po.totalAmount, po.currency)}</strong>
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Deliveries received</CardTitle>
          {v.receipts.length === 0 ? (
            <p className="text-[14px] text-fg-2">Nothing has arrived yet. {can.receive ? "Use “Receive the delivery” when it comes." : "The warehouse receives it when it comes."}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.receipts.map((r) => (
                <li key={r.id} className="py-2">
                  <Link className="flex min-h-[44px] flex-wrap items-center gap-x-2 text-[15px] hover:underline" href={`/inventory/receive/${r.id}`}>
                    <span className="font-medium text-primary-text">{fmtDateTime(r.receivedAt)}</span>
                    <span className="text-fg-2">{RECEIPT_WORD[r.status] ?? r.status}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {r.receiptNumber ?? "draft"}
                      {r.supplierDocumentNumber ? ` · supplier paper ${r.supplierDocumentNumber}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <MoreDetails title="Details, approvals and history">
          <Dl
            items={[
              ["Supplier", <Link key="s" className="text-primary-text hover:underline" href={`/procurement/suppliers/${v.supplier.id}`}>{v.supplier.name}</Link>],
              ["Deliver to", `${v.site?.name ?? ""}${v.warehouse ? ` · ${v.warehouse.name}` : ""}`],
              ["Ordered on", fmtDate(po.orderDate)],
              ["Expected", po.expectedDate ? fmtDate(po.expectedDate) : "—"],
              ["Supplier promised", po.promisedDate ? fmtDate(po.promisedDate) : "—"],
              ["Supplier's own order number", po.supplierReference ?? "—"],
              ["We pay within", po.paymentTermsDays !== null ? `${po.paymentTermsDays} days` : "—"],
              ["Sent", po.sentAt ? `${fmtDateTime(po.sentAt)}${po.sentTo ? ` · ${po.sentTo}` : ""}${po.sendResult ? ` · ${po.sendResult.replace("_", " ")}` : ""}` : "—"],
              ...(po.closeReason ? ([["Closed", po.closeReason]] as [string, string][]) : []),
              ...(po.cancelReason ? ([["Cancelled", po.cancelReason]] as [string, string][]) : []),
              ["Note", po.notes ?? "—"],
            ]}
          />
          <div>
            <p className="mb-2 text-[14px] font-semibold">Approval</p>
            <Steps steps={v.progress.steps} />
            {v.decisions
              .filter((d) => d.decision !== "approved")
              .map((d) => (
                <p key={d.id} className="mt-1 text-[13px] text-muted">
                  Sent back by {d.decidedByName} {fmtDateTime(d.decidedAt)}: {d.note}
                </p>
              ))}
          </div>
          {v.documents.length > 0 && (
            <div>
              <p className="mb-2 text-[14px] font-semibold">Order papers</p>
              <ul className="text-[14px]">
                {v.documents.map((d) => (
                  <li key={d.id}>
                    <Link className="text-primary-text hover:underline" href={`/documents/${d.id}`}>
                      {fmtDateTime(d.generatedAt)}
                    </Link>{" "}
                    · {d.generatedByName} <span className="font-mono text-[12px] text-muted">{d.documentNumber}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-[14px] font-semibold">History</p>
            <History rows={v.transitions} />
          </div>
        </MoreDetails>
        {po.status === "draft" && (ctx.can("procurement.purchase_order.edit") || ctx.can("procurement.purchase_order.create")) && <DeleteDraftCard kind="purchase_order" id={po.id} what="purchase order" />}
      </div>
    </>
  );
}
