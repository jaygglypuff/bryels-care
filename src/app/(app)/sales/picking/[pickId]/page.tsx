import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPick } from "@/modules/sales";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { cancelPickAction, completePickAction, generatePickListAction, pickScanAction, voidPickLineAction } from "../../fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../fulfilment-forms";

export const metadata = { title: "Pick" };

const q = (v: string, uom: string) => fmtQty(v, uom, uom === "pcs" ? 0 : 3);

/** Pick screen (W09-06): scan each allocated box (or lot + quantity for loose units); progress by line. */
export default async function PickPage({ params }: { params: Promise<{ pickId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.pick.view")) return <Forbidden what="pick lists" />;
  const { pickId } = await params;
  let v: Awaited<ReturnType<typeof getPick>>;
  try {
    v = await getPick(ctx, pickId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const open = v.pick.status === "in_progress";
  const short = v.rows.filter((r) => !r.done);
  return (
    <>
      <PageHeader
        title={v.pick.pickNumber}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StatusChip status={v.pick.status} /> {v.order.orderNumber} · {v.customerName} · due {fmtDate(v.order.requestedDeliveryOn)}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/print/pick-list/${v.pick.id}`} variant="secondary" target="_blank">Print pick list</LinkButton>
            <LinkButton href="/sales/picking" variant="secondary">All picks</LinkButton>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {open && ctx.can("sales.pick.create") && (
            <Card>
              <CardTitle>Scan</CardTitle>
              <ScanPanel scan={pickScanAction.bind(null, v.pick.id)} label="Scan the box label (or the lot label for loose units)" hint="A box that is not on this list is refused. Duplicate scans count once." withQty allowManual />
            </Card>
          )}
          <Card>
            <CardTitle>To pick · {v.progress.picked} of {v.progress.toPick} ({v.progress.pct}%)</CardTitle>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${v.progress.pct}%` }} />
            </div>
            {v.rows.length === 0 ? (
              <EmptyState title="Nothing allocated">This order has no open allocation left.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {v.rows.map((r) => (
                  <li key={r.id} data-testid="pick-row" data-lot={r.lotNumber} data-box={r.boxNumber ?? ""} data-qty={String(Number(r.qty) - Number(r.picked))} className={`rounded-[12px] border p-3 ${r.done ? "border-[var(--ok-bd)] bg-[var(--ok-bg)]" : "border-line"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-medium">{r.locationCode} · {r.boxNumber ? `Box ${r.boxNumber}` : "Loose units"}</span>
                      <span className="text-[15px] font-semibold tabular">{q(r.picked, r.baseUom)} / {q(r.qty, r.baseUom)}</span>
                    </div>
                    <p className="text-[13px] text-fg-2">{r.sku} · lot {r.lotNumber} · expires {fmtDate(r.expiresOn)}</p>
                    {r.blocked && <p className="text-[13px] font-medium text-[var(--bad-fg)]">BLOCKED – {r.qualityStatus.replace(/_/g, " ")}: do not pick, ask the office to re-allocate.</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Scans</CardTitle>
            {v.lines.length === 0 ? (
              <EmptyState title="No scans yet" />
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {v.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={l.voidedAt ? "text-muted line-through" : ""}>
                      {l.boxNumber ? `Box ${l.boxNumber}` : `Lot ${l.lotNumber} loose`} · {q(l.qtyBase, l.baseUom)} · {l.pickedByName} {fmtDateTime(l.scannedAt)}
                      {l.entryMode === "manual" && " · manual entry"}
                      {l.substitutedForContainerId && " · substitute"}
                    </span>
                    {open && !l.voidedAt && <ReasonCmd action={voidPickLineAction} fields={{ pickLineId: l.id }} label="Take back" placeholder="e.g. Wrong box scanned" />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {open && ctx.can("sales.pick.submit") && (
            <Card>
              <CardTitle>Finish</CardTitle>
              <Cmd action={completePickAction} fields={{ pickId: v.pick.id, shipmentId: v.pick.shipmentId }} label="Complete pick" pending="Completing…" variant="cta" size="lg">
                {short.length > 0 ? (
                  <>
                    <Banner tone="warn" title={`${short.length} line(s) not fully picked`}>They stay allocated for a later pick.</Banner>
                    <Field label="Short-pick reason" htmlFor="shortPickReason">
                      <Input id="shortPickReason" name="shortPickReason" maxLength={300} placeholder="e.g. Box damaged on the shelf" />
                    </Field>
                  </>
                ) : (
                  <p className="text-[13px] text-fg-2">Everything on the list is picked. Next: pack verification by a colleague.</p>
                )}
              </Cmd>
              <div className="mt-3 border-t border-line pt-3">
                <ReasonCmd action={cancelPickAction} fields={{ pickId: v.pick.id }} label="Cancel pick" placeholder="e.g. Truck cancelled" />
              </div>
            </Card>
          )}
          {!open && (
            <Card>
              <CardTitle>Shipment {v.shipmentNumber}</CardTitle>
              <p className="mb-3 text-[13px] text-fg-2">Status: {v.shipmentStatus}</p>
              <LinkButton href={`/sales/shipments/${v.pick.shipmentId}`} variant="primary">Open shipment</LinkButton>
            </Card>
          )}
          {ctx.can("documents.generated_document.create") && (
            <Card>
              <CardTitle>Pick list document</CardTitle>
              <p className="mb-3 text-[13px] text-fg-2">Records the list (no prices, no box barcodes) for printing or as a paper fallback.</p>
              <Cmd action={generatePickListAction} fields={{ pickId: v.pick.id }} label="Record pick list" variant="secondary" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
