import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getPurchaseOrder } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Table, Td, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { cancelOrderAction, closeOrderAction, confirmOrderAction, decideOrderAction, regenerateDocumentAction, sendOrderAction, shortCloseLineAction, submitOrderAction } from "../../actions";
import { PoChip, Steps, SubNav, fmtBase, money } from "../../_ui";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="purchase orders" />;
  const { id } = await params;
  let v: Awaited<ReturnType<typeof getPurchaseOrder>>;
  try {
    v = await getPurchaseOrder(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Purchase order not found" action={<LinkButton href="/procurement/orders" variant="secondary">Purchase orders</LinkButton>}>
          It does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const { po, can } = v;
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
  return (
    <>
      <PageHeader
        title={po.poNumber}
        subtitle={`${v.supplier.name} · ${v.site?.code ?? ""} · ordered ${fmtDate(po.orderDate)}`}
        actions={
          <>
            {can.print && (
              <a className={linkCls} href={`/print/purchase-order/${po.id}`}>
                Print PO
              </a>
            )}
            {can.receive && <LinkButton href={`/procurement/expected/${po.id}`} variant="cta">Receive delivery</LinkButton>}
            <LinkButton href="/procurement/orders" variant="secondary">Purchase orders</LinkButton>
          </>
        }
      />
      <SubNav />
      <div className="flex flex-col gap-5">
        {po.isUrgent && <Banner tone="warn" title="Urgent purchase">{po.urgentReason}</Banner>}
        {po.status === "submitted" && !can.decide && <Banner tone="info" title="Waiting for approval">The next approver per the approval rules decides. The creator and submitter never approve their own order.</Banner>}
        <Card>
          <CardTitle action={<PoChip status={po.status} />}>Order</CardTitle>
          <Dl
            items={[
              ["Supplier", <Link key="s" className="text-primary-text hover:underline" href={`/procurement/suppliers/${v.supplier.id}`}>{`${v.supplier.name} (${v.supplier.code})`}</Link>],
              ["Deliver to", `${v.site?.name ?? ""}${v.warehouse ? ` · ${v.warehouse.code}` : ""}`],
              ["Expected", po.expectedDate ? fmtDate(po.expectedDate) : "—"],
              ["Promised by supplier", po.promisedDate ? fmtDate(po.promisedDate) : "—"],
              ["Supplier reference", po.supplierReference ?? "—"],
              ["Payment terms", po.paymentTermsDays !== null ? `${po.paymentTermsDays} days` : "—"],
              ...(can.seePrices ? ([["Total", `${money(po.subtotalAmount, po.currency)} + tax ${money(po.taxAmount, po.currency)} = ${money(po.totalAmount, po.currency)}`]] as [string, string][]) : []),
              ["Sent", po.sentAt ? `${fmtDateTime(po.sentAt)}${po.sentTo ? ` · ${po.sentTo}` : ""}${po.sendResult ? ` · ${po.sendResult.replace("_", " ")}` : ""}` : "—"],
              ...(po.closeReason ? ([["Closed", po.closeReason]] as [string, string][]) : []),
              ...(po.cancelReason ? ([["Cancelled", po.cancelReason]] as [string, string][]) : []),
              ["Notes", po.notes ?? "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Lines</CardTitle>
          <Table head={["#", "Material", "Ordered", "Received", "Open", "Expected", ...(can.seePrices ? ["Price", "Amount"] : []), "Status", ""]}>
            {v.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.lineNo}</Td>
                <Td>
                  {l.materialCode}
                  <div className="text-[12px] text-muted">
                    {l.materialName}
                    {l.prNumber ? ` · ${l.prNumber}` : ""}
                  </div>
                </Td>
                <Td className="whitespace-nowrap">
                  {Number(l.qtyEntered)} {l.uomEntered}
                </Td>
                <Td className="whitespace-nowrap">{fmtBase(l.qtyReceivedBase, l.baseUom)}</Td>
                <Td className="whitespace-nowrap">{fmtBase(l.remainingBase, l.baseUom)}</Td>
                <Td className="whitespace-nowrap">{l.expectedDate ? fmtDate(l.expectedDate) : "—"}</Td>
                {can.seePrices && <Td className="whitespace-nowrap">{money(l.unitAmount, l.currency)}/{l.uomEntered}</Td>}
                {can.seePrices && <Td className="whitespace-nowrap">{money(l.lineAmount, l.currency)}</Td>}
                <Td>
                  <Chip tone={l.lineStatus === "received" ? "ok" : l.lineStatus === "open" ? "info" : "neu"}>{l.lineStatus.replace("_", " ")}</Chip>
                  {l.shortCloseReason && <div className="text-[12px] text-muted">{l.shortCloseReason}</div>}
                </Td>
                <Td>
                  {can.shortClose && l.lineStatus === "open" && (
                    <details>
                      <summary className="cursor-pointer text-[13px] text-primary-text">Short-close</summary>
                      <ActionForm action={shortCloseLineAction} hidden={{ lineId: l.id }} submit="Short-close line" variant="secondary" size="sm" confirm="Nothing more will be expected on this line. Continue?">
                        <Input name="reason" placeholder="Reason" aria-label="Reason" required />
                      </ActionForm>
                    </details>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card>
          <CardTitle>Approval</CardTitle>
          <Steps steps={v.progress.steps} />
          {v.decisions.filter((d) => d.decision !== "approved").map((d) => (
            <p key={d.id} className="mt-1 text-[13px] text-muted">
              {d.decision} by {d.decidedByName} {fmtDateTime(d.decidedAt)}: {d.note}
            </p>
          ))}
          <div className="mt-3 flex flex-col gap-3">
            {can.submit && <ActionForm action={submitOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Submit for approval" variant="cta" />}
            {can.decide && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={decideOrderAction} hidden={{ purchaseOrderId: po.id, decision: "approve" }} submit={`Approve step ${v.progress.next?.step ?? 1}`} variant="cta">
                  <Input name="note" placeholder="Note (optional)" aria-label="Approval note" />
                </ActionForm>
                <ActionForm action={decideOrderAction} hidden={{ purchaseOrderId: po.id, decision: "return" }} submit="Return to draft" variant="secondary">
                  <Input name="note" placeholder="What must change?" aria-label="Reason" required />
                </ActionForm>
              </div>
            )}
            {can.edit && <p className="text-[13px] text-muted">To change a draft&apos;s lines, cancel it and create a new purchase order; the approval always sees the lines as submitted.</p>}
          </div>
        </Card>

        {(can.send || can.confirm || can.close || can.cancel) && (
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-4">
              {can.send && (
                <ActionForm action={sendOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Send to supplier" pending="Sending…" variant="cta">
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" name="email" value="yes" defaultChecked={!!v.supplier.email} disabled={!v.supplier.email} />
                    {v.supplier.email ? `Email the PO summary to ${v.supplier.email}` : "The supplier has no email address: print and send the PO by hand"}
                  </label>
                </ActionForm>
              )}
              {can.send === false && po.status === "approved" && <p className="text-[13px] text-muted">Procurement sends approved orders (records the PO document).</p>}
              {["sent", "partially_received", "received"].includes(po.status) && ctx.canAt("procurement.purchase_order.post", po.siteId) && ctx.can("documents.generated_document.create") && (
                <ActionForm action={regenerateDocumentAction} hidden={{ purchaseOrderId: po.id }} submit={po.generatedDocumentId ? "Re-record the PO document" : "Record the PO document"} variant="secondary" size="sm" />
              )}
              {can.confirm && (
                <ActionForm action={confirmOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Record supplier confirmation" variant="secondary" className="grid gap-3 sm:grid-cols-3 sm:items-end">
                  <Field label="Supplier reference" htmlFor="supplierReference">
                    <Input id="supplierReference" name="supplierReference" defaultValue={po.supplierReference ?? ""} />
                  </Field>
                  <Field label="Promised date" htmlFor="promisedDate">
                    <Input id="promisedDate" type="date" name="promisedDate" defaultValue={po.promisedDate ?? ""} />
                  </Field>
                </ActionForm>
              )}
              {can.close && (
                <details>
                  <summary className="cursor-pointer text-[14px] text-primary-text">Close the purchase order</summary>
                  <ActionForm action={closeOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Close PO" variant="secondary" confirm="Open lines are short-closed. Continue?">
                    <Textarea name="reason" rows={2} placeholder={po.status === "received" ? "Note (optional)" : "Why the rest will not be delivered"} aria-label="Reason" />
                  </ActionForm>
                </details>
              )}
              {can.cancel && (
                <details>
                  <summary className="cursor-pointer text-[14px] text-[var(--bad-fg)]">Cancel the purchase order</summary>
                  <ActionForm action={cancelOrderAction} hidden={{ purchaseOrderId: po.id }} submit="Cancel PO" variant="danger" confirm="Cancel this purchase order?">
                    <Textarea name="reason" rows={2} placeholder="Reason" aria-label="Reason" required />
                  </ActionForm>
                </details>
              )}
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>Receipts</CardTitle>
          {v.receipts.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing received yet.</p>
          ) : (
            <Table head={["Receipt", "Status", "Delivery note", "Received"]}>
              {v.receipts.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link className="text-primary-text hover:underline" href={`/inventory/receive/${r.id}`}>
                      {r.receiptNumber ?? "draft"}
                    </Link>
                  </Td>
                  <Td>{r.status}</Td>
                  <Td>{r.supplierDocumentNumber ?? "—"}</Td>
                  <Td>{fmtDateTime(r.receivedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {v.documents.length > 0 && (
          <Card>
            <CardTitle>PO documents</CardTitle>
            <ul className="text-[13px]">
              {v.documents.map((d) => (
                <li key={d.id}>
                  <Link className="text-primary-text hover:underline" href={`/documents/${d.id}`}>
                    {d.documentNumber}
                  </Link>{" "}
                  · {d.status} · {fmtDateTime(d.generatedAt)} · {d.generatedByName}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.transitions.map((t) => (
              <li key={t.id}>
                {fmtDateTime(t.occurredAt)} · {t.fromState ?? "—"} → <strong>{t.toState}</strong> · {t.actorName}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
        {po.status === "draft" && (ctx.can("procurement.purchase_order.edit") || ctx.can("procurement.purchase_order.create")) && <DeleteDraftCard kind="purchase_order" id={po.id} what="purchase order" />}
      </div>
    </>
  );
}
