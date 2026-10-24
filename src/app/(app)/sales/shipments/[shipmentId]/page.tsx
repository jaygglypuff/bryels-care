import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getShipment, shipmentReconciliation } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { acknowledgeAction, cancelShipmentAction, dispatchShipmentAction, draftDeliveryReceiptAction, generateDeliveryReceiptAction, reverseShipmentAction } from "../../fulfilment-actions";
import { AcknowledgeForm, Cmd, ReasonCmd } from "../../fulfilment-forms";

export const metadata = { title: "Shipment" };

const DONE: Record<string, string> = {
  picked: "Pick completed. Next: pack verification by someone who did not pick.",
  packed: "Packing verified. Print the draft delivery receipt if needed, then dispatch.",
  dispatched: "Dispatched: stock was issued and the delivery receipt numbered.",
};

function manilaNowLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Shipment record (US-4-11..13): lines with boxes and lots, the next allowed step, DR and history. */
export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ shipmentId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="shipments" />;
  const { shipmentId } = await params;
  const { done } = await searchParams;
  let v: Awaited<ReturnType<typeof getShipment>>;
  try {
    v = await getShipment(ctx, shipmentId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const s = v.shipment;
  const rec = ["dispatched", "delivered", "reversed"].includes(s.status) ? await shipmentReconciliation(ctx, s.id) : null;
  const drDoc = v.documents.find((d) => d.documentKind === "delivery_receipt" && d.status === "ready");
  const packList = v.documents.find((d) => d.documentKind === "boxing_note" && d.status === "ready");
  return (
    <>
      <PageHeader
        title={s.shipmentNumber ?? s.deliveryReceiptNumber ?? "Shipment"}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusChip status={s.status} /> <Link href={`/sales/${v.order.id}`} className="hover:underline">{v.order.orderNumber}</Link> · {v.customer.name}</span>}
        actions={<LinkButton href="/sales/shipments" variant="secondary">All shipments</LinkButton>}
      />
      {done && DONE[done] && <div className="mb-4" role="status"><Banner tone="ok" title={DONE[done]} /></div>}
      {v.blockedLots.length > 0 && ["picked", "packed"].includes(s.status) && (
        <div className="mb-4"><Banner tone="bad" title="A lot on this shipment is no longer released">{v.blockedLots.join(", ")}: dispatch will be refused. Ask QA, or cancel the shipment and re-allocate.</Banner></div>
      )}
      {v.exceptions.some((e) => e.kind === "over_shipment") && <div className="mb-4"><Banner tone="warn" title="Over-shipment approved">{v.exceptions.filter((e) => e.kind === "over_shipment").map((e) => `${e.reason} (ref ${e.customerReference}, ${e.approvedByName})`).join("; ")}</Banner></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Shipment</CardTitle>
            <Dl
              items={[
                ["Ship to", s.shipToAddress ?? v.customer.shipToAddress],
                ["DR number", s.deliveryReceiptNumber ?? (v.deliveryReceipt?.status === "draft" ? "Draft (no number until dispatch)" : "—")],
                ["Carrier · tracking", [s.carrier, s.trackingNumber].filter(Boolean).join(" · ") || "—"],
                ["Driver · plate", [s.driverName, s.vehiclePlate].filter(Boolean).join(" · ") || "—"],
                ["Packages · weight", [s.packageCount, s.grossWeight ? `${Number(s.grossWeight)} ${s.weightUom ?? "kg"}` : null].filter(Boolean).join(" · ") || "—"],
                ["Dispatched", s.dispatchedAt ? fmtDateTime(s.dispatchedAt) : "Not yet"],
                ["Delivered", s.deliveredAt ? `${fmtDateTime(s.deliveredAt)} · ${s.receivedByName ?? ""}` : "Not yet"],
                ["Requested delivery", fmtDate(v.order.requestedDeliveryOn)],
              ]}
            />
            {rec && (
              <p className={`mt-3 text-[13px] ${rec.balanced ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]"}`}>
                Stock reconciliation: lines {fmtQty(rec.linesQty, "pcs", 0)} vs movements {fmtQty(rec.movementsQty, "pcs", 0)} · {rec.balanced ? "no difference" : `difference ${rec.difference}`}
              </p>
            )}
          </Card>
          <Card>
            <CardTitle>Boxes and lots · {v.totals.boxes} box(es) · {fmtQty(v.totals.units, "pcs", 0)}</CardTitle>
            {v.lines.length === 0 ? (
              <EmptyState title="Nothing verified yet">{s.status === "draft" ? "Picking is in progress." : "Boxes appear here as they are verified."}</EmptyState>
            ) : (
              <Table head={["Box", "SKU", "Lot", "Expiry", "From", "Qty", ""]}>
                {v.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-mono text-[12px]">{l.boxNumber ?? "loose"}</Td>
                    <Td>{l.sku}</Td>
                    <Td className="font-mono text-[12px]">{l.lotNumber} {l.qualityStatus !== "released" && <StatusChip status={l.qualityStatus} />}</Td>
                    <Td>{fmtDate(l.expiresOn)}</Td>
                    <Td>{l.locationCode}</Td>
                    <Td>{fmtQty(l.qtyBase, l.baseUom, l.baseUom === "pcs" ? 0 : 3)}</Td>
                    <Td>{l.isOverShipment ? "over-shipment" : ""}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card>
            <CardTitle>History</CardTitle>
            {v.history.length === 0 ? <EmptyState title="No transitions recorded" /> : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {v.history.map((h) => <li key={h.id}>{fmtDateTime(h.at)} · {h.fromState ?? "—"} → {h.toState} · {h.byName}{h.reason ? ` · ${h.reason}` : ""}</li>)}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {s.status === "draft" && v.pick && (
            <Card>
              <CardTitle>Picking</CardTitle>
              <LinkButton href={`/sales/picking/${v.pick.id}`} variant="primary">Continue pick {v.pick.pickNumber}</LinkButton>
            </Card>
          )}
          {s.status === "picked" && (
            <Card>
              <CardTitle>Pack verification</CardTitle>
              <p className="mb-3 text-[13px] text-fg-2">A colleague who did not pick scans every box against the order.</p>
              <LinkButton href={`/sales/packing/${s.id}`} variant="cta" size="lg">Verify packing</LinkButton>
            </Card>
          )}
          {s.status === "packed" && (
            <Card>
              <CardTitle>Dispatch</CardTitle>
              {ctx.can("sales.delivery_receipt.create") && ctx.can("documents.generated_document.create") && (
                <div className="mb-4 border-b border-line pb-4">
                  <Cmd action={draftDeliveryReceiptAction} fields={{ shipmentId: s.id }} label="Print draft delivery receipt" variant="secondary">
                    <p className="text-[13px] text-fg-2">A draft DR has no number and never moves stock.</p>
                  </Cmd>
                </div>
              )}
              {ctx.can("sales.shipment.post") ? (
                <Cmd action={dispatchShipmentAction} fields={{ shipmentId: s.id }} label="Dispatch shipment" pending="Posting dispatch…" variant="cta" size="lg" confirm="This issues stock and cannot be undone without a return. Dispatch now?">
                  <Field label="Driver" htmlFor="driverName"><Input id="driverName" name="driverName" required maxLength={80} /></Field>
                  <Field label="Vehicle plate" htmlFor="vehiclePlate"><Input id="vehiclePlate" name="vehiclePlate" required maxLength={20} autoCapitalize="characters" /></Field>
                  <Field label="Carrier" htmlFor="carrierName"><Input id="carrierName" name="carrierName" defaultValue={s.carrier ?? "Own truck"} maxLength={80} /></Field>
                </Cmd>
              ) : (
                <p className="text-[13px] text-muted">Packed. Waiting for the warehouse to dispatch.</p>
              )}
            </Card>
          )}
          {["draft", "picked", "packed"].includes(s.status) && ctx.can("sales.shipment.edit") && (
            <Card>
              <ReasonCmd action={cancelShipmentAction} fields={{ shipmentId: s.id }} label="Cancel shipment" placeholder="e.g. Customer moved the delivery" confirm="Cancel this shipment? The allocation is kept." />
            </Card>
          )}
          {["dispatched", "delivered"].includes(s.status) && (
            <Card>
              <CardTitle>Delivery receipt {s.deliveryReceiptNumber}</CardTitle>
              {drDoc ? (
                <LinkButton href={`/print/delivery-receipt/${s.id}`} target="_blank" variant="primary" className="mb-3 w-full">Print delivery receipt</LinkButton>
              ) : ctx.can("documents.generated_document.create") ? (
                <Cmd action={generateDeliveryReceiptAction} fields={{ shipmentId: s.id }} label="Generate delivery receipt" variant="secondary">
                  <Banner tone="warn" title="No DR document yet">The DR number is allocated; the document needs an approved template (Admin → Templates).</Banner>
                </Cmd>
              ) : null}
              {drDoc && <p className="text-[12px] text-muted">{drDoc.documentNumber} · {drDoc.watermark ?? "issued"} · reprints from the document record need a reason.</p>}
            </Card>
          )}
          {s.status === "dispatched" && ctx.can("sales.delivery_receipt.create") && (
            <Card>
              <CardTitle>Acknowledge receipt</CardTitle>
              <AcknowledgeForm action={acknowledgeAction} shipmentId={s.id} now={manilaNowLocal()} />
            </Card>
          )}
          {s.status === "dispatched" && ctx.can("sales.shipment.void") && (
            <Card>
              <CardTitle>Reverse dispatch</CardTitle>
              <p className="mb-2 text-[13px] text-fg-2">Only when goods never left: posts reversal movements back to the shelf. Delivered goods come back as a customer return.</p>
              <ReasonCmd action={reverseShipmentAction} fields={{ shipmentId: s.id }} label="Reverse dispatch" placeholder="e.g. Truck broke down at the gate" variant="danger" confirm="Reverse this dispatch? Stock returns to its locations and the DR is voided." />
            </Card>
          )}
          {v.deliveryReceipt?.status === "acknowledged" && (
            <Card>
              <CardTitle>Acknowledged</CardTitle>
              <p className="text-[13px]">{v.deliveryReceipt.receivedByName}{v.deliveryReceipt.receivedByPosition ? ` · ${v.deliveryReceipt.receivedByPosition}` : ""} · {fmtDateTime(v.deliveryReceipt.acknowledgedAt)}</p>
              {v.deliveryReceipt.remarks && <p className="text-[13px] text-fg-2">Remarks: {v.deliveryReceipt.remarks}</p>}
            </Card>
          )}
          <Card>
            <CardTitle>Documents</CardTitle>
            {v.documents.length === 0 ? <EmptyState title="No documents yet" /> : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {v.documents.map((d) => (
                  <li key={d.id}><Link href={`/documents/${d.id}`} className="text-primary-text hover:underline">{d.documentNumber}</Link> · {d.documentKind.replace(/_/g, " ")} · {d.status}{d.watermark ? ` · ${d.watermark}` : ""}</li>
                ))}
              </ul>
            )}
            {packList && <LinkButton href={`/print/documents/${packList.id}`} target="_blank" variant="secondary" className="mt-3">Print packing list</LinkButton>}
          </Card>
        </div>
      </div>
    </>
  );
}
