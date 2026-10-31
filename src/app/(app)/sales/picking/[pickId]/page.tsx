import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPick } from "@/modules/sales";
import { Card, CardTitle, EmptyState, Field, Input, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { cancelPickAction, completePickAction, generatePickListAction, pickScanAction, voidPickLineAction } from "../../fulfilment-actions";
import { Cmd, ReasonCmd, ScanPanel } from "../../fulfilment-forms";
import { ShipChip } from "../../orders/sales-ui";
import { DoNext } from "../../next-step";

export const metadata = { title: "Get from shelf" };

const q = (v: string, uom: string) => fmtQty(v, uom, uom === "pcs" ? 0 : 3);

/**
 * Get from shelf (W09-06), phone first: the next shelf and box to take, one big scan box, the list with what is
 * left, and one green "finish" button once everything is scanned. Finishing early (something missing) asks why
 * and sits under "⋯ More" with print and cancel.
 */
export default async function PickPage({ params }: { params: Promise<{ pickId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.pick.view")) return <Forbidden what="getting orders from the shelf" />;
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
  const nextRow = short.find((r) => !r.blocked);
  const canScan = open && ctx.can("sales.pick.create");
  const canFinish = open && ctx.can("sales.pick.submit");
  const finishFields = { pickId: v.pick.id, shipmentId: v.pick.shipmentId };

  const next = !open ? (
    <DoNext
      text={v.pick.status === "cancelled" ? "Stopped. Nothing more to do here." : "Got everything. Next: a colleague checks the box a second time, then it is sent out."}
      action={{ label: "Open the shipment", href: `/sales/shipments/${v.pick.shipmentId}` }}
    />
  ) : short.length === 0 && canFinish ? (
    <DoNext text="Everything is scanned. Next: finish, so a colleague can check the box a second time.">
      <Cmd action={completePickAction} fields={finishFields} label="Finish getting from shelf" pending="Finishing…" variant="cta" size="lg" />
    </DoNext>
  ) : nextRow ? (
    <DoNext
      text={
        <>
          Next: go to shelf <span className="font-mono">{nextRow.locationCode}</span> and take {nextRow.boxNumber ? <>box <span className="font-mono">{nextRow.boxNumber}</span></> : `${q(String(Number(nextRow.qty) - Number(nextRow.picked)), nextRow.baseUom)} loose`} of {nextRow.productName}. Then scan it below.
        </>
      }
    />
  ) : (
    <DoNext text="Something on the list cannot be taken (stopped by QA)." waitingFor="Ask the office to set aside other stock, or finish with it missing (⋯ More)." />
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Get from shelf: ${v.customerName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/sales/picking" className="text-primary-text hover:underline">To get from shelf</Link>
            <ShipChip status={v.pick.status} />
            <span>deliver by {fmtDate(v.order.requestedDeliveryOn)}</span>
            <RecordNo>{v.pick.pickNumber}</RecordNo>
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href={`/print/pick-list/${v.pick.id}`} variant="secondary" target="_blank">Print the list</LinkButton>
              {ctx.can("documents.generated_document.create") && (
                <Cmd action={generatePickListAction} fields={{ pickId: v.pick.id }} label="Save the list as a paper copy" variant="secondary">
                  <p className="text-[13px] text-fg-2">Keeps the list (no prices) for printing or if the phones are down.</p>
                </Cmd>
              )}
              {canFinish && short.length > 0 && (
                <Cmd action={completePickAction} fields={finishFields} label="Finish with items missing" pending="Finishing…" variant="secondary">
                  <p className="text-[13px] text-fg-2">{short.length} place(s) not fully taken. They stay set aside for later.</p>
                  <Field label="Why is something missing?" htmlFor="shortPickReason">
                    <Input id="shortPickReason" name="shortPickReason" maxLength={300} required placeholder="e.g. Box damaged on the shelf" />
                  </Field>
                </Cmd>
              )}
              {canFinish && <ReasonCmd action={cancelPickAction} fields={{ pickId: v.pick.id }} label="Stop getting from shelf" placeholder="e.g. Truck cancelled" />}
              <LinkButton href={`/sales/${v.order.id}`} variant="ghost">Open the order <span className="font-mono text-[12px] text-muted">{v.order.orderNumber}</span></LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for taking one customer order off the shelf. Go to each shelf, take the box, and scan it. Stock leaves only when it is sent out.</PageIntro>
      {next}

      <div className="flex flex-col gap-4">
        {canScan && short.length > 0 && (
          <Card>
            <CardTitle>Scan the box</CardTitle>
            <ScanPanel scan={pickScanAction.bind(null, v.pick.id)} label="Scan the box label (or the lot label for loose pieces)" hint="A box that is not on this list is refused. Scanning the same box twice counts once." withQty allowManual candidates={short.filter((r) => !r.blocked).map((r) => ({ value: r.boxNumber ? `BC:BOX:${r.boxNumber}` : `BC:LOT:${r.lotNumber}`, title: r.productName, detail: `shelf ${r.locationCode} · ${r.boxNumber ? `box ${r.boxNumber}` : `${q(String(Number(r.qty) - Number(r.picked)), r.baseUom)} loose`} · lot ${r.lotNumber}`, codes: [r.boxNumber ?? r.lotNumber] }))} />
          </Card>
        )}

        <Card>
          <CardTitle>
            To take · {v.progress.picked} of {v.progress.toPick} ({v.progress.pct}%)
          </CardTitle>
          <div className="mb-3 h-3 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-3 rounded-full bg-primary" style={{ width: `${v.progress.pct}%` }} />
          </div>
          {v.rows.length === 0 ? (
            <EmptyState title="Nothing set aside">This order has no stock set aside any more. Ask the office.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {v.rows.map((r) => (
                <li
                  key={r.id}
                  data-testid="pick-row"
                  data-lot={r.lotNumber}
                  data-box={r.boxNumber ?? ""}
                  data-qty={String(Number(r.qty) - Number(r.picked))}
                  className={`rounded-[14px] border p-3 ${r.done ? "border-[var(--ok-bd)] bg-[var(--ok-bg)]" : r.blocked ? "border-[var(--bad-bd)] bg-[var(--bad-bg)]" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[16px] font-semibold">
                      Shelf <span className="font-mono">{r.locationCode}</span>
                    </span>
                    <span className="text-[17px] font-semibold tabular">
                      {q(r.picked, r.baseUom)} / {q(r.qty, r.baseUom)} {r.done ? "✓" : ""}
                    </span>
                  </div>
                  <p className="text-[14px] text-fg">
                    {r.productName} · {r.boxNumber ? <>box <span className="font-mono">{r.boxNumber}</span></> : "loose pieces"}
                  </p>
                  <p className="font-mono text-[12px] text-muted">
                    {r.sku} · lot {r.lotNumber} · expires {fmtDate(r.expiresOn)}
                  </p>
                  {r.blocked && <p className="mt-1 text-[14px] font-semibold text-[var(--bad-fg)]">Do not take: stopped by QA. Ask the office to set aside other stock.</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {short.length > 0 && open && <Banner tone="info" title="Something you cannot find?">Use ⋯ More → Finish with items missing, and say why. The rest stays set aside for later.</Banner>}

        <MoreDetails title={`Scans so far (${v.lines.filter((l) => !l.voidedAt).length})`}>
          {v.lines.length === 0 ? (
            <p className="text-[13px] text-muted">No scans yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[13px]">
              {v.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className={l.voidedAt ? "text-muted line-through" : ""}>
                    {l.boxNumber ? `Box ${l.boxNumber}` : `Lot ${l.lotNumber} loose`} · {q(l.qtyBase, l.baseUom)} · {l.pickedByName} {fmtDateTime(l.scannedAt)}
                    {l.entryMode === "manual" && " · typed by hand"}
                    {l.substitutedForContainerId && " · other box"}
                  </span>
                  {open && !l.voidedAt && <ReasonCmd action={voidPickLineAction} fields={{ pickLineId: l.id }} label="Undo this scan" placeholder="e.g. Wrong box scanned" />}
                </li>
              ))}
            </ul>
          )}
        </MoreDetails>
      </div>
    </div>
  );
}
