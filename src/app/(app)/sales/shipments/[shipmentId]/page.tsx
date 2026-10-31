import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getShipment, shipmentReconciliation } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, StatusChip } from "@/ui/status";
import { RecordHeader } from "@/ui/record";
import { shipmentSteps } from "@/ui/record-steps";
import { Forbidden } from "../../../forbidden";
import { acknowledgeAction, cancelShipmentAction, dispatchShipmentAction, draftDeliveryReceiptAction, generateDeliveryReceiptAction, reverseShipmentAction } from "../../fulfilment-actions";
import { AcknowledgeForm, Cmd, ReasonCmd } from "../../fulfilment-forms";
import { shipWord } from "../../orders/sales-ui";
import { DoNext, whoDoes } from "../../next-step";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Delivery" };

const DONE: Record<string, string> = {
  picked: "Got everything from the shelf. Next: a colleague who did not take them checks the box a second time.",
  packed: "Second check done. Next: send it out.",
  dispatched: "Sent out: stock left the shelf and the delivery receipt got its number.",
};

function manilaNowLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Delivery (shipment, US-4-11..13), phone first: what is in it, the one next step, the delivery receipt and what happened. */
export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ shipmentId: string }>; searchParams: Promise<{ done?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="deliveries" />;
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
  const canSend = s.status === "packed" && ctx.can("sales.shipment.post");
  const canPod = s.status === "dispatched" && ctx.can("sales.delivery_receipt.create");
  const canCancel = ["draft", "picked", "packed"].includes(s.status) && ctx.can("sales.shipment.edit");
  const canReverse = s.status === "dispatched" && ctx.can("sales.shipment.void");
  const canDraftDr = s.status === "packed" && ctx.can("sales.delivery_receipt.create") && ctx.can("documents.generated_document.create");

  const next =
    s.status === "draft" && v.pick ? (
      <DoNext text="Next: get the items from the shelf." action={{ label: "Continue getting from shelf", href: `/sales/picking/${v.pick.id}` }} />
    ) : s.status === "picked" ? (
      ctx.can("inventory.pack.approve") ? (
        <DoNext text="Next: second check of the box, by someone who did not take the items off the shelf." action={{ label: "Check the box", href: `/sales/packing/${s.id}` }} />
      ) : (
        <DoNext text="Got from the shelf." waitingFor={`Waiting for ${await whoDoes(ctx, "inventory.pack.approve", s.siteId, "a checker")} to check the box a second time.`} />
      )
    ) : s.status === "packed" ? (
      canSend ? (
        <DoNext text="Next: send it out. Type the driver and the plate number." action={{ label: "Send out", href: "#send" }} />
      ) : (
        <DoNext text="The box is checked and ready." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.shipment.post", s.siteId, "the warehouse")} to send it out.`} />
      )
    ) : s.status === "dispatched" ? (
      canPod ? (
        <DoNext text="Next: when the driver is back with the signed delivery receipt, save the proof of delivery." action={{ label: "Save proof of delivery", href: "#pod" }} />
      ) : (
        <DoNext text="Sent out." waitingFor="Waiting for the proof of delivery (signed delivery receipt)." />
      )
    ) : s.status === "delivered" ? (
      <DoNext text="Delivered. Nothing more to do." />
    ) : (
      <DoNext text={`${shipWord(s.status)}. Nothing more to do here.`} />
    );

  return (
    <div className="mx-auto max-w-3xl">
      <RecordHeader
        typeLabel="Delivery"
        reference={s.shipmentNumber ?? s.deliveryReceiptNumber ?? "Delivery"}
        title={v.customer.name}
        siteCode={ctx.allowedSites.find((x) => x.id === s.siteId)?.code}
        status={s.status}
        statusLabel={shipWord(s.status)}
        meta={[
          ["Deliver by", fmtDate(v.order.requestedDeliveryOn)],
          ["Delivery receipt", s.deliveryReceiptNumber],
        ]}
        steps={shipmentSteps(s.status)}
        primary={
          ["dispatched", "delivered"].includes(s.status) && drDoc ? (
            <LinkButton href={`/print/delivery-receipt/${s.id}`} target="_blank" variant="secondary" size="lg">
              Print delivery receipt
            </LinkButton>
          ) : undefined
        }
        secondary={
          <>
            <LinkButton href="/sales/shipments" variant="ghost">All deliveries</LinkButton>
            <MoreMenu>
              <div className="flex flex-col gap-3">
                <LinkButton href={`/sales/${v.order.id}`} variant="secondary">Open the order</LinkButton>
                {canDraftDr && (
                  <Cmd action={draftDeliveryReceiptAction} fields={{ shipmentId: s.id }} label="Print a draft delivery receipt" variant="secondary">
                    <p className="text-[13px] text-fg-2">A draft has no number and never moves stock.</p>
                  </Cmd>
                )}
                {packList && <LinkButton href={`/print/documents/${packList.id}`} target="_blank" variant="secondary">Print the packing list</LinkButton>}
                {canCancel && <ReasonCmd action={cancelShipmentAction} fields={{ shipmentId: s.id }} label="Cancel this delivery" placeholder="e.g. Customer moved the delivery" confirm="Cancel this delivery? The stock stays set aside for the order." />}
                {canReverse && (
                  <div>
                    <p className="mb-2 text-[13px] text-fg-2">Only when the goods never left: the stock goes back to its shelves. Goods that reached the customer come back as a customer return.</p>
                    <ReasonCmd action={reverseShipmentAction} fields={{ shipmentId: s.id }} label="Undo sending out" placeholder="e.g. Truck broke down at the gate" variant="danger" confirm="Undo sending out? Stock goes back to its shelves and the delivery receipt is cancelled." />
                  </div>
                )}
                <Help screen="sales.fulfilment" />
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for one delivery to {v.customer.name}: what goes in it, sending it out, and the proof that the customer got it.</PageIntro>
      {next}
      {done && DONE[done] && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={DONE[done]} />
        </div>
      )}
      {v.blockedLots.length > 0 && ["picked", "packed"].includes(s.status) && (
        <div className="mb-4">
          <Banner tone="bad" title="Something in this delivery was stopped by QA">
            {v.blockedLots.join(", ")}: it cannot be sent out. Ask QA, or cancel the delivery and set aside other stock.
          </Banner>
        </div>
      )}
      {v.exceptions.some((e) => e.kind === "over_shipment") && (
        <div className="mb-4">
          <Banner tone="warn" title="More than ordered: allowed by a manager">
            {v.exceptions
              .filter((e) => e.kind === "over_shipment")
              .map((e) => `${e.reason} (${e.customerReference}, ${e.approvedByName})`)
              .join("; ")}
          </Banner>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {canSend && (
          <Card>
            <span id="send" className="block scroll-mt-24" />
            <CardTitle>Send out</CardTitle>
            <Cmd action={dispatchShipmentAction} fields={{ shipmentId: s.id }} label="Send out now" pending="Sending out…" variant="cta" size="lg" confirm="Stock leaves the shelf now. It can only be undone if the truck never left. Send out?">
              <Field label="Driver" htmlFor="driverName">
                <Input id="driverName" name="driverName" required maxLength={80} autoComplete="off" />
              </Field>
              <Field label="Plate number" htmlFor="vehiclePlate">
                <Input id="vehiclePlate" name="vehiclePlate" required maxLength={20} autoCapitalize="characters" autoComplete="off" />
              </Field>
              <Field label="Who delivers" htmlFor="carrierName">
                <Input id="carrierName" name="carrierName" defaultValue={s.carrier ?? "Own truck"} maxLength={80} />
              </Field>
            </Cmd>
          </Card>
        )}
        {canPod && (
          <Card>
            <span id="pod" className="block scroll-mt-24" />
            <CardTitle>Proof of delivery</CardTitle>
            <AcknowledgeForm action={acknowledgeAction} shipmentId={s.id} now={manilaNowLocal()} />
          </Card>
        )}
        {v.deliveryReceipt?.status === "acknowledged" && (
          <Card>
            <CardTitle>Proof of delivery</CardTitle>
            <p className="text-[14px]">
              {v.deliveryReceipt.receivedByName}
              {v.deliveryReceipt.receivedByPosition ? ` · ${v.deliveryReceipt.receivedByPosition}` : ""} · {fmtDateTime(v.deliveryReceipt.acknowledgedAt)}
            </p>
            {v.deliveryReceipt.remarks && <p className="text-[13px] text-fg-2">Something wrong: {v.deliveryReceipt.remarks}</p>}
          </Card>
        )}
        {["dispatched", "delivered"].includes(s.status) && !drDoc && ctx.can("documents.generated_document.create") && (
          <Card>
            <CardTitle>Delivery receipt</CardTitle>
            <Cmd action={generateDeliveryReceiptAction} fields={{ shipmentId: s.id }} label="Make the delivery receipt" variant="secondary">
              <Banner tone="warn" title="No delivery receipt paper yet">The number is given; the paper needs an approved template (Management → System → Templates & labels).</Banner>
            </Cmd>
          </Card>
        )}

        <Card>
          <CardTitle>
            In this delivery · {v.totals.boxes} box(es) · {fmtQty(v.totals.units, "pcs", 0)}
          </CardTitle>
          {v.lines.length === 0 ? (
            <EmptyState title="Nothing checked yet">{s.status === "draft" ? "The items are being taken off the shelf." : "Boxes show here as they are checked."}</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-[14px]">
                    <p className="font-medium">
                      {l.boxNumber ? <>Box <span className="font-mono">{l.boxNumber}</span></> : "Loose pieces"} {l.qualityStatus !== "released" && <StatusChip status={l.qualityStatus} />}
                      {l.isOverShipment ? <span className="ml-1 text-[12px] text-[var(--warn-fg)]">more than ordered</span> : null}
                    </p>
                    <p className="text-[13px] text-fg-2">
                      Expires {fmtDate(l.expiresOn)} · from shelf {l.locationCode}
                    </p>
                    <p className="font-mono text-[12px] text-muted">
                      {l.sku} · lot {l.lotNumber}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-[15px] font-semibold tabular">{fmtQty(l.qtyBase, l.baseUom, l.baseUom === "pcs" ? 0 : 3)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>About this delivery</CardTitle>
          <Dl
            items={[
              ["Deliver to", s.shipToAddress ?? v.customer.shipToAddress],
              ["Order", <Link key="o" href={`/sales/${v.order.id}`} className="text-primary-text hover:underline">{v.order.orderNumber}</Link>],
              ["Driver and plate", [s.driverName, s.vehiclePlate].filter(Boolean).join(" · ") || "—"],
              ["Sent out", s.dispatchedAt ? fmtDateTime(s.dispatchedAt) : "Not yet"],
              ["Delivered", s.deliveredAt ? `${fmtDateTime(s.deliveredAt)} · ${s.receivedByName ?? ""}` : "Not yet"],
            ]}
          />
          <div className="mt-3">
            <MoreDetails>
              <Dl
                items={[
                  ["Delivery receipt number", s.deliveryReceiptNumber ?? (v.deliveryReceipt?.status === "draft" ? "Draft (numbered when sent out)" : "—")],
                  ["Who delivers · tracking", [s.carrier, s.trackingNumber].filter(Boolean).join(" · ") || "—"],
                  ["Boxes · weight", [s.packageCount, s.grossWeight ? `${Number(s.grossWeight)} ${s.weightUom ?? "kg"}` : null].filter(Boolean).join(" · ") || "—"],
                ]}
              />
              {rec && (
                <p className={`text-[13px] ${rec.balanced ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]"}`}>
                  Stock check: delivery {fmtQty(rec.linesQty, "pcs", 0)} vs stock moved {fmtQty(rec.movementsQty, "pcs", 0)} · {rec.balanced ? "no difference" : `difference ${rec.difference}`}
                </p>
              )}
              {drDoc && <p className="text-[12px] text-muted">{drDoc.documentNumber} · {drDoc.watermark ?? "issued"} · printing again from the document page asks why.</p>}
              <p className="text-[13px] font-medium">Papers</p>
              {v.documents.length === 0 ? (
                <p className="text-[13px] text-muted">No papers yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {v.documents.map((d) => (
                    <li key={d.id}>
                      <Link href={`/documents/${d.id}`} className="text-primary-text hover:underline">
                        {d.documentKind.replace(/_/g, " ")}
                      </Link>{" "}
                      <span className="font-mono text-[12px] text-muted">{d.documentNumber}</span> · {d.status}
                      {d.watermark ? ` · ${d.watermark}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </MoreDetails>
          </div>
        </Card>

        <MoreDetails title="What happened">
          {v.history.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {v.history.map((h) => (
                <li key={h.id}>
                  {fmtDateTime(h.at)} · {h.fromState ? `${shipWord(h.fromState)} → ` : ""}
                  {shipWord(h.toState)} · {h.byName}
                  {h.reason ? ` · ${h.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </MoreDetails>
      </div>
    </div>
  );
}
