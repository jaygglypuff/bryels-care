import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { getPackingView } from "@/modules/sales";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { approveExceptionAction, completePackingAction, removeShipmentLineAction, verifyScanAction } from "../../fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../fulfilment-forms";

export const metadata = { title: "Pack verification" };

const q = (v: string, uom = "pcs") => fmtQty(v, uom, uom === "pcs" ? 0 : 3);

/**
 * Pack verification (W09-07, US-4-11): a checker who did not pick scans every picked box against the
 * order; over-shipment and partial-for-full-shipment customers stop with CX-SHIP until a site manager
 * approves. Carrier, tracking, weight and packages are captured when packing is completed.
 */
export default async function PackingPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="shipments" />;
  const { shipmentId } = await params;
  let v: Awaited<ReturnType<typeof getPackingView>>;
  try {
    v = await getPackingView(ctx, shipmentId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const s = v.shipment;
  const canVerify = ctx.can("inventory.pack.approve") && ctx.can("sales.shipment.edit") && s.status === "picked";
  const unverified = v.picked.filter((p) => !p.verified);
  const lastFailure = v.scans.find((x) => x.result === "not_in_pack" && /Over-shipment/.test(x.note ?? ""));
  return (
    <>
      <PageHeader
        title={`Verify ${s.shipmentNumber}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusChip status={s.status} /> {v.order.orderNumber} · {v.customerName}</span>}
        actions={<LinkButton href={`/sales/shipments/${s.id}`} variant="secondary">Shipment</LinkButton>}
      />
      {v.isPicker && s.status === "picked" && (
        <div className="mb-4"><Banner tone="warn" title="You picked this shipment">Pack verification must be done by someone else (checker ≠ packer).</Banner></div>
      )}
      {v.fullShipmentRequired && <div className="mb-4"><Banner tone="info" title="This customer requires full shipment">A partial shipment needs a site manager&apos;s approval (CX-SHIP).</Banner></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {canVerify && !v.isPicker && (
            <Card>
              <CardTitle>Scan picked boxes</CardTitle>
              <ScanPanel scan={verifyScanAction.bind(null, s.id)} label="Scan each box (or the lot label with the counted loose quantity)" hint="A box beyond the allocation or the order is refused with OVER_SHIPMENT and not added." withQty />
            </Card>
          )}
          <Card>
            <CardTitle>Order lines</CardTitle>
            <ul className="flex flex-col gap-2">
              {v.orderLines.map((l) => (
                <li key={l.id} className="rounded-[12px] border border-line p-3 text-[13px]">
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{l.sku} · {l.productName}</span><span className="tabular">verified {q(l.verified)} · picked {q(l.picked)} · ordered {q(l.qty)}</span></div>
                  <p className="text-fg-2">Shipped before: {q(l.shippedBefore)} · remaining after this shipment: {q(l.remaining)}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardTitle>Picked · {v.picked.length - unverified.length} of {v.picked.length} verified</CardTitle>
            {v.picked.length === 0 ? (
              <EmptyState title="Nothing picked" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {v.picked.map((p) => (
                  <li key={p.id} data-testid="picked-row" data-lot={p.lotNumber} data-box={p.boxNumber ?? ""} data-qty={String(Number(p.qtyBase))} data-verified={p.verified ? "yes" : "no"} className="flex justify-between gap-2 py-2">
                    <span>{p.boxNumber ? `Box ${p.boxNumber}` : `Lot ${p.lotNumber} loose`} · {p.locationCode} · picked by {p.pickedByName}</span>
                    <span className={p.verified ? "font-medium text-[var(--ok-fg)]" : "text-muted"}>{q(p.qtyBase, p.baseUom)} {p.verified ? "✓" : "to verify"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>On this shipment</CardTitle>
            {v.lines.length === 0 ? (
              <EmptyState title="No verified boxes yet" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {v.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{l.boxNumber ? `Box ${l.boxNumber}` : `Lot ${l.lotNumber} loose`} · {l.sku} · {q(l.qtyBase, l.baseUom)}{l.isOverShipment ? " · OVER-SHIPMENT" : ""}</span>
                    {s.status === "picked" && ctx.can("sales.shipment.edit") && <ReasonCmd action={removeShipmentLineAction} fields={{ shipmentLineId: l.id }} label="Remove" placeholder="e.g. Scanned the wrong box" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Verification scans</CardTitle>
            {v.scans.length === 0 ? <EmptyState title="No scans yet" /> : (
              <ul className="flex flex-col divide-y divide-line text-[12px]">
                {v.scans.map((x) => (
                  <li key={x.id} className="py-1.5">{fmtDateTime(x.scannedAt)} · {x.scannedByName} · <span className="font-mono">{x.scanPayload}</span> · {x.result.replace(/_/g, " ")}{x.note ? ` · ${x.note}` : ""}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {s.status === "picked" && canVerify && !v.isPicker && (
            <Card>
              <CardTitle>Complete packing</CardTitle>
              {unverified.length > 0 && <div className="mb-3"><Banner tone="warn" title={`${unverified.length} picked item(s) not verified`}>Scan them first.</Banner></div>}
              <Cmd action={completePackingAction} fields={{ shipmentId: s.id }} label="Complete packing" pending="Completing…" variant="cta" size="lg">
                <Field label="Carrier" htmlFor="carrierName"><Input id="carrierName" name="carrierName" defaultValue="Own truck" required maxLength={80} /></Field>
                <Field label="Tracking number" htmlFor="trackingNumber"><Input id="trackingNumber" name="trackingNumber" maxLength={80} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gross weight (kg)" htmlFor="grossWeightKg"><Input id="grossWeightKg" name="grossWeightKg" inputMode="decimal" /></Field>
                  <Field label="Packages" htmlFor="packageCount"><Input id="packageCount" name="packageCount" inputMode="numeric" defaultValue={String(Math.max(new Set(v.lines.map((l) => l.containerId).filter(Boolean)).size, 1))} /></Field>
                </div>
              </Cmd>
            </Card>
          )}
          {s.status === "picked" && v.canOverApprove && (
            <Card>
              <CardTitle>CX-SHIP approval (site manager)</CardTitle>
              {lastFailure && <div className="mb-3"><Banner tone="bad" title="Over-shipment refused">{lastFailure.note}</Banner></div>}
              <Cmd action={approveExceptionAction} fields={{ shipmentId: s.id }} label="Approve exception" pending="Approving…" variant="secondary">
                <Field label="Exception" htmlFor="kind">
                  <Select id="kind" name="kind" defaultValue="over_shipment">
                    <option value="over_shipment">Over-shipment of a line</option>
                    <option value="partial_shipment">Partial shipment (customer requires full)</option>
                  </Select>
                </Field>
                <Field label="Order line (over-shipment)" htmlFor="salesOrderLineId">
                  <Select id="salesOrderLineId" name="salesOrderLineId">{v.orderLines.map((l) => <option key={l.id} value={l.id}>{l.sku} · ordered {q(l.qty)}</option>)}</Select>
                </Field>
                <Field label="Extra quantity approved" htmlFor="extraQty"><Input id="extraQty" name="extraQty" inputMode="decimal" /></Field>
                <Field label="Reason" htmlFor="reason"><Input id="reason" name="reason" required minLength={5} maxLength={300} /></Field>
                <Field label="Customer reference" htmlFor="customerReference" hint="PO amendment, email or call log"><Input id="customerReference" name="customerReference" required maxLength={80} /></Field>
                <Field label="Your password" htmlFor="password" hint="Restricted approval: confirm it's you"><Input id="password" name="password" type="password" autoComplete="current-password" /></Field>
              </Cmd>
            </Card>
          )}
          {v.exceptions.length > 0 && (
            <Card>
              <CardTitle>Approved exceptions</CardTitle>
              <ul className="flex flex-col gap-2 text-[13px]">
                {v.exceptions.map((e) => <li key={e.id}>{e.kind.replace(/_/g, " ")}{e.extraQtyBase ? ` +${q(e.extraQtyBase)}` : ""} · {e.reason} · ref {e.customerReference} · {e.approvedByName}, {fmtDateTime(e.approvedAt)}</li>)}
              </ul>
            </Card>
          )}
          {s.status !== "picked" && <Banner tone="info" title={`Shipment is ${s.status}`}>Verification is done while the shipment is picked.</Banner>}
        </div>
      </div>
    </>
  );
}
