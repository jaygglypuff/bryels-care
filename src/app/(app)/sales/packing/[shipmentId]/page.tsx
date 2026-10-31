import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { getPackingView } from "@/modules/sales";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { approveExceptionAction, completePackingAction, removeShipmentLineAction, verifyScanAction } from "../../fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../fulfilment-forms";
import { ShipChip } from "../../orders/sales-ui";
import { DoNext, whoDoes } from "../../next-step";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Second check of the box" };

const q = (v: string, uom = "pcs") => fmtQty(v, uom, uom === "pcs" ? 0 : 3);

/**
 * Second check of the box (pack verification, W09-07, US-4-11), phone first: someone who did not take the items
 * off the shelf scans every box against the order. Sending more than ordered, or part of an order for a customer
 * who wants everything at once, stops (CX-SHIP) until a site manager allows it. The checker ≠ picker rule and
 * the exception approval are enforced by the services; this page only shows them.
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
  const checking = canVerify && !v.isPicker;

  const next =
    s.status !== "picked" ? (
      <DoNext text={s.status === "draft" ? "The items are still being taken off the shelf." : "The second check is done."} action={{ label: "Open the shipment", href: `/sales/shipments/${s.id}` }} />
    ) : v.isPicker ? (
      <DoNext text="You took these off the shelf, so someone else does the second check." waitingFor={`Waiting for ${await whoDoes(ctx, "inventory.pack.approve", s.siteId, "a checker")}.`} />
    ) : !canVerify ? (
      <DoNext text="Waiting for the second check of the box." waitingFor={`Waiting for ${await whoDoes(ctx, "inventory.pack.approve", s.siteId, "a checker")}.`} />
    ) : unverified.length > 0 ? (
      <DoNext text={`Next: scan each box (${unverified.length} left). A box that is not on the order is refused.`} />
    ) : (
      <DoNext text="Every box is checked. Next: say how many boxes go on the truck and finish." action={{ label: "Finish the check", href: "#finish" }} />
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Second check: ${v.customerName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ShipChip status={s.status} />
            <RecordNo>{s.shipmentNumber ?? ""}</RecordNo>
            <span className="font-mono text-[12px] text-muted">{v.order.orderNumber}</span>
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <LinkButton href={`/sales/shipments/${s.id}`} variant="secondary">Open the shipment</LinkButton>
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
          <Banner tone="bad" title="More than ordered: refused">{lastFailure.note}</Banner>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {checking && unverified.length > 0 && (
          <Card>
            <CardTitle>Scan the box</CardTitle>
            <ScanPanel scan={verifyScanAction.bind(null, s.id)} label="Scan each box (or the lot label with the loose pieces you counted)" hint="A box that is not on the order, or more than ordered, is refused and not added." withQty />
          </Card>
        )}

        <Card>
          <CardTitle>
            Boxes · {v.picked.length - unverified.length} of {v.picked.length} checked
          </CardTitle>
          {v.picked.length === 0 ? (
            <EmptyState title="Nothing taken off the shelf yet">The boxes show here after they are taken off the shelf.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {v.picked.map((p) => (
                <li
                  key={p.id}
                  data-testid="picked-row"
                  data-lot={p.lotNumber}
                  data-box={p.boxNumber ?? ""}
                  data-qty={String(Number(p.qtyBase))}
                  data-verified={p.verified ? "yes" : "no"}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-[14px] border p-3 ${p.verified ? "border-[var(--ok-bd)] bg-[var(--ok-bg)]" : "border-line"}`}
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">{p.boxNumber ? <>Box <span className="font-mono">{p.boxNumber}</span></> : <>Loose pieces, lot <span className="font-mono">{p.lotNumber}</span></>}</span>
                    <span className="block text-[12px] text-muted">
                      shelf {p.locationCode} · taken by {p.pickedByName}
                    </span>
                  </span>
                  <span className={p.verified ? "text-[15px] font-semibold text-[var(--ok-fg)]" : "text-[15px] text-fg-2"}>
                    {q(p.qtyBase, p.baseUom)} {p.verified ? "✓ checked" : "to check"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>What the customer ordered</CardTitle>
          <ul className="flex flex-col gap-2">
            {v.orderLines.map((l) => (
              <li key={l.id} className="rounded-[12px] border border-line p-3 text-[14px]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{l.productName}</span>
                  <span className="tabular">
                    checked {q(l.verified)} of {q(l.qty)}
                  </span>
                </div>
                <p className="text-[13px] text-fg-2">
                  Taken off the shelf {q(l.picked)} · sent before {q(l.shippedBefore)} · still to send after this {q(l.remaining)} <span className="font-mono text-[12px] text-muted">· {l.sku}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>

        {s.status === "picked" && checking && (
          <Card>
            <span id="finish" className="block scroll-mt-24" />
            <CardTitle>Finish the check</CardTitle>
            {unverified.length > 0 && (
              <div className="mb-3">
                <Banner tone="warn" title={`${unverified.length} box(es) not checked yet`}>Scan them first.</Banner>
              </div>
            )}
            <Cmd action={completePackingAction} fields={{ shipmentId: s.id }} label="Finish the check" pending="Finishing…" variant="cta" size="lg">
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

        <MoreDetails title={`Boxes on this shipment and scans (${v.lines.length})`}>
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
                  {fmtDateTime(x.scannedAt)} · {x.scannedByName} · <span className="font-mono">{x.scanPayload}</span> · {x.result.replace(/_/g, " ")}
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
