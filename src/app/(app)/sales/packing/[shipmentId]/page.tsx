import Link from "next/link";
import { plural } from "@/lib/plural";
import { NextApprover } from "@/ui/next-approver";
import { packCheckNext } from "@/modules/sales";
import { PlaceName } from "@/ui/inventory/place-name";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { screenPreferences } from "@/modules/governance";
import { getPackingView } from "@/modules/sales";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, Select } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { approveExceptionAction, completePackingAction, removeShipmentLineAction, verifyScanAction } from "../../fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../fulfilment-forms";
import { ShipChip } from "../../orders/sales-ui";
import { DoNext, whoDoes } from "../../next-step";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Second check of the box" };

const q = (v: string, uom = "pcs") => fmtQty(v, uom, uom === "pcs" ? 0 : 3);
/** "1 piece", "6 pieces"; other units unchanged ("2.500 kg"). */
const qWords = (v: string, uom = "pcs") => (uom === "pcs" ? plural(fmtQty(v, "", 0), "piece") : q(v, uom));

/**
 * Second check of the box (pack verification, W09-07, US-4-11), phone first: someone who did not take the items
 * off the shelf scans every box against the order. Sending more than ordered, or part of an order for a customer
 * who wants everything at once, stops (CX-SHIP) until a site manager allows it. The checker ≠ picker rule and
 * the exception approval are enforced by the services; this page only shows them.
 */
export default async function PackingPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const ctx = await requireContext();
  const { typedChecks } = await screenPreferences(ctx); // ADR-126: typing the label number may be turned off for checks
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="shipments" permission="sales.shipment.view" />;
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
  const lastFailure = v.scans[0]?.result === "not_in_pack" && /Over-shipment|Not on the pick list/.test(v.scans[0].note ?? "") ? v.scans[0] : null;
  // ADR-110 C1: more than ordered on a line blocks "Finish the check" (plain words, never counted silently).
  const overLines = v.orderLines.filter((l) => Number(l.tooMany) > 0);
  const checking = canVerify && !v.isPicker;
  // UX audit B #10: a delivery that already left shows no "0 of 0 checked" or "still to send" (it contradicted "done").
  const gone = ["dispatched", "delivered", "cancelled", "reversed"].includes(s.status);

  const next =
    gone ? (
      <DoNext text={s.status === "cancelled" ? "This delivery was cancelled. Nothing to check." : `Already sent out${s.dispatchedAt ? ` on ${fmtDateTime(s.dispatchedAt)}` : ""}. The second check was done before it left.`} action={{ label: "Open the delivery", href: `/sales/shipments/${s.id}` }} />
    ) : s.status === "packed" ? (
      <DoNext text="The second check is done. Next: send it out." action={{ label: "Send it out", href: `/sales/shipments/${s.id}` }} />
    ) : s.status !== "picked" ? (
      <DoNext text="The items are still being taken off the shelf." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.pick.create", s.siteId, "the warehouse")} to finish getting them from the shelf.`} />
    ) : v.isPicker ? (
      <DoNext text="You took these off the shelf, so someone else does the second check." waitingFor={<NextApprover next={await packCheckNext(ctx, { shipmentId: s.id })} inline />} />
    ) : !canVerify ? (
      <DoNext text="Waiting for the second check of the box." waitingFor={<NextApprover next={await packCheckNext(ctx, { shipmentId: s.id })} inline />} />
    ) : unverified.length > 0 ? (
      <DoNext text={`Next: scan or type each box label (${unverified.length} left). A box that is not on the order is refused.`} />
    ) : (
      <DoNext text="Every box is checked. Next: say how many boxes go on the truck and press “Finish the check” below." />
    );

  return (
    <div className="mx-auto max-w-2xl">
      <RecordHeader
        typeLabel="Second check"
        reference={s.shipmentNumber ?? ""}
        title={v.customerName}
        chip={<ShipChip status={s.status} />}
        meta={[["Order", v.order.orderNumber]]}
        actions={
          <MoreMenu compact>
            <div className="flex flex-col gap-2">
              <LinkButton href={`/sales/shipments/${s.id}`} variant="secondary">Open the delivery</LinkButton>
              <Help screen="sales.fulfilment" />
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for the second check of the box: a different person scans every box before it is sent out, so the customer gets exactly what they ordered.</PageIntro>
      {next}
      {v.fullShipmentRequired && (
        <div className="mb-4">
          <Banner tone="info" title="This customer wants everything at once">Sending only part of the order needs a site manager to allow it.</Banner>
        </div>
      )}
      {lastFailure && (
        <div className="mb-4">
          <Banner tone="bad" title={/Not on the pick list/.test(lastFailure.note ?? "") ? "Not on the pick list: refused" : "More than ordered: refused"}>{lastFailure.note}</Banner>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Owner screenshot 2026-11-08: the boxes to check come first (the next one marked), then the scan/type area. */}
        {!gone && (
        <Card>
          <CardTitle>
            Boxes · {v.picked.length - unverified.length} of {v.picked.length} checked
          </CardTitle>
          {v.picked.length === 0 ? (
            <EmptyState title="Nothing taken off the shelf yet">The boxes show here after they are taken off the shelf.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {v.picked.map((p) => {
                const isNext = checking && p.id === unverified[0]?.id;
                return (
                <li
                  key={p.id}
                  data-testid="picked-row"
                  data-lot={p.lotNumber}
                  data-box={p.boxNumber ?? ""}
                  data-qty={String(Number(p.qtyBase))}
                  data-verified={p.verified ? "yes" : "no"}
                  data-next={isNext ? "yes" : "no"}
                  aria-current={isNext ? "step" : undefined}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-[8px] border p-3 ${p.verified ? "border-[var(--ok-bd)] bg-[var(--ok-bg)]" : isNext ? "border-2 border-primary bg-primary-soft" : "border-line"}`}
                >
                  <span className="min-w-0">
                    {isNext && <span className="mb-0.5 block text-[12px] font-semibold uppercase tracking-wide text-primary-text">Next to check</span>}
                    <span className="block text-[15px] font-semibold">{p.boxNumber ? <>Box <span className="font-mono">{p.boxNumber}</span></> : <>Loose pieces, lot <span className="font-mono">{p.lotNumber}</span></>}</span>
                    <span className="block text-[12px] text-muted">
                      <PlaceName name={p.locationName} code={p.locationCode} /> · taken by {p.pickedByName}
                    </span>
                  </span>
                  <span className={p.verified ? "text-[15px] font-semibold text-[var(--ok-fg)]" : "text-[15px] text-fg-2"}>
                    {qWords(p.qtyBase, p.baseUom)} {p.verified ? "✓ checked" : "to check"}
                  </span>
                </li>
                );
              })}
            </ul>
          )}
        </Card>
        )}

        {checking && unverified.length > 0 && (
          <Card>
            <CardTitle>{typedChecks ? "Scan or type the box label" : "Scan the box label"}</CardTitle>
            <ScanPanel
              scan={verifyScanAction.bind(null, s.id)}
              allowTyping={typedChecks}
              label={typedChecks ? "Scan each box label, or type the number printed on it" : "Scan each box label"}
              hint={`For loose pieces, scan the lot label${typedChecks ? " (or type it)" : ""}, then say how many. A box that is not on the order, or more than ordered, is refused and not added.`}
              withQty
              candidates={unverified.map((p) => ({ value: p.boxNumber ? `BC:BOX:${p.boxNumber}` : `BC:LOT:${p.lotNumber}`, title: p.boxNumber ? `Box ${p.boxNumber}` : `Loose pieces`, code: p.boxNumber ?? p.lotNumber, codes: [p.boxNumber ?? p.lotNumber] }))}
              showCandidates={false}
            />
          </Card>
        )}

        {!gone && (
        <Card>
          <CardTitle>What the customer ordered</CardTitle>
          <ul className="flex flex-col gap-2">
            {v.orderLines.map((l) => (
              <li key={l.id} className={`rounded-[8px] border p-3 text-[14px] ${Number(l.tooMany) > 0 ? "border-[var(--bad-bd)] bg-[var(--bad-bg)]" : "border-line"}`} data-testid="order-line" data-over={Number(l.tooMany) > 0 ? "yes" : "no"}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{l.productName}</span>
                  <span className={Number(l.tooMany) > 0 ? "tabular font-semibold text-[var(--bad-fg)]" : "tabular"}>
                    checked {q(l.verified)} of {q(l.qty)}
                  </span>
                </div>
                {l.overMessage && <p className="mt-1 text-[14px] font-semibold text-[var(--bad-fg)]">{l.overMessage}</p>}
                <p className="text-[13px] text-fg-2">
                  Taken off the shelf: {q(l.picked)} · Sent before: {q(l.shippedBefore)} · Still to send: {q(l.remaining)} <span className="font-mono text-[12px] text-muted">· {l.sku}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
        )}

        {s.status === "picked" && checking && (
          <Card>
            <span id="finish" className="block scroll-mt-24" />
            <CardTitle>Finish the check</CardTitle>
            {unverified.length > 0 && (
              <div className="mb-3">
                <Banner tone="warn" title={`${unverified.length === 1 ? "1 box is" : `${unverified.length} boxes are`} not checked yet`}>Scan or type them first.</Banner>
              </div>
            )}
            {overLines.length > 0 ? (
              <Banner tone="bad" title="More than ordered: you cannot finish yet">
                {overLines.map((l) => l.overMessage).join(" ")} Open “Boxes on this delivery and scans” and take the extra box off.
              </Banner>
            ) : (
            <Cmd action={completePackingAction} fields={{ shipmentId: s.id }} label="Finish the check" pending="Finishing…" variant={unverified.length > 0 ? "secondary" : "cta"} size="lg">
              <Field label="Boxes on the truck" htmlFor="packageCount">
                <Input id="packageCount" name="packageCount" inputMode="numeric" defaultValue={String(Math.max(new Set(v.lines.map((l) => l.containerId).filter(Boolean)).size, 1))} />
              </Field>
              <Field label="Who delivers" htmlFor="carrierName">
                <Input id="carrierName" name="carrierName" defaultValue="Own truck" required maxLength={80} />
              </Field>
              <MoreDetails>
                <Field label="Tracking number (optional)" htmlFor="trackingNumber">
                  <Input id="trackingNumber" name="trackingNumber" maxLength={80} />
                </Field>
                <Field label="Total weight in kg (optional)" htmlFor="grossWeightKg">
                  <Input id="grossWeightKg" name="grossWeightKg" inputMode="decimal" />
                </Field>
              </MoreDetails>
            </Cmd>
            )}
          </Card>
        )}

        {s.status === "picked" && v.canOverApprove && (
          <MoreDetails title="Manager: allow sending more or less than ordered" open={!!lastFailure}>
            <Cmd action={approveExceptionAction} fields={{ shipmentId: s.id }} label="Allow it" pending="Saving…" variant="secondary">
              <Field label="What to allow" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="over_shipment">
                  <option value="over_shipment">Send more of a product than ordered</option>
                  <option value="partial_shipment">Send only part (customer wants everything at once)</option>
                </Select>
              </Field>
              <Field label="Product (for more than ordered)" htmlFor="salesOrderLineId">
                <Select id="salesOrderLineId" name="salesOrderLineId">
                  {v.orderLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.productName} · ordered {q(l.qty)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How many extra" htmlFor="extraQty">
                <Input id="extraQty" name="extraQty" inputMode="decimal" />
              </Field>
              <Field label="Why?" htmlFor="reason">
                <Input id="reason" name="reason" required minLength={5} maxLength={300} />
              </Field>
              <Field label="The customer said so where?" htmlFor="customerReference" hint="Changed order, e-mail or phone call">
                <Input id="customerReference" name="customerReference" required maxLength={80} />
              </Field>
              <Field label="Your password" htmlFor="password" hint="To confirm it is you">
                <Input id="password" name="password" type="password" autoComplete="current-password" />
              </Field>
            </Cmd>
          </MoreDetails>
        )}

        {v.exceptions.length > 0 && (
          <Card>
            <CardTitle>Allowed by a manager</CardTitle>
            <ul className="flex flex-col gap-2 text-[13px]">
              {v.exceptions.map((e) => (
                <li key={e.id}>
                  {e.kind === "over_shipment" ? "More than ordered" : "Only part"}
                  {e.extraQtyBase ? ` +${q(e.extraQtyBase)}` : ""} · {e.reason} · {e.customerReference} · {e.approvedByName}, {fmtDateTime(e.approvedAt)}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <MoreDetails title={`Boxes on this delivery and scans (${v.lines.length})`} open={overLines.length > 0}>
          {v.lines.length === 0 ? (
            <p className="text-[13px] text-muted">No checked boxes yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[13px]">
              {v.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {l.boxNumber ? `Box ${l.boxNumber}` : `Lot ${l.lotNumber} loose`} · {l.sku} · {q(l.qtyBase, l.baseUom)}
                    {l.isOverShipment ? " · more than ordered" : ""}
                  </span>
                  {s.status === "picked" && ctx.can("sales.shipment.edit") && <ReasonCmd action={removeShipmentLineAction} fields={{ shipmentLineId: l.id }} label="Take off" placeholder="e.g. Scanned the wrong box" />}
                </li>
              ))}
            </ul>
          )}
          {v.scans.length > 0 && (
            <ul className="flex flex-col divide-y divide-line text-[12px]">
              {v.scans.map((x) => (
                <li key={x.id} className="py-1.5">
                  {fmtDateTime(x.scannedAt)} · {x.scannedByName} · <span className="font-mono">{x.scanPayload}</span>
                  {x.entryMode === "typed" ? " (typed)" : ""} · {x.result.replace(/_/g, " ")}
                  {x.note ? ` · ${x.note}` : ""}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/sales/${v.order.id}`} className="text-[13px] text-primary-text hover:underline">
            Open the order
          </Link>
        </MoreDetails>
      </div>
    </div>
  );
}
