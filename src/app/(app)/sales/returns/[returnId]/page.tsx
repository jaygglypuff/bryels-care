import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCustomerReturn } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { QaStatusChip, fmtLotQty } from "../../../quality/_ui";
import { ReturnStatusChip, returnWord } from "../_ui";
import { ApproveReturnForm, CancelReturnForm, CloseReturnButton, InspectReturnButton, PostReturnButton, RemoveLineButton, ScanLineForm, SendBackForm, SubmitReturnButton } from "../forms";
import { DoNext, whoDoes } from "../../next-step";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer return" };

const SHIPMENT_WORD = { not_returned: "Nothing came back yet", partially_returned: "Part came back", returned: "All came back" } as const;
const DECISION_WORD: Record<string, string> = { release: "OK to sell again", release_from_hold: "OK to sell again", hold: "Stopped by QA", reject: "Not OK – don't use" };

export default async function ReturnPage({ params }: { params: Promise<{ returnId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.view")) return <Forbidden what="customer returns" />;
  const { returnId } = await params;
  let v: Awaited<ReturnType<typeof getCustomerReturn>>;
  try {
    v = await getCustomerReturn(ctx, returnId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Customer return not found" action={<LinkButton href="/sales/returns" variant="secondary">All customer returns</LinkButton>}>
          This return does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const h = v.header;
  const live = h.status !== "closed" && h.status !== "cancelled";

  const next = !live ? (
    <DoNext text={h.status === "closed" ? "Done. Nothing more to do." : "Cancelled. Nothing more to do."} />
  ) : v.can.submit ? (
    <DoNext text="Next: when every box is scanned, send the return for approval.">
      <SubmitReturnButton returnId={h.id} />
    </DoNext>
  ) : v.can.scan ? (
    <DoNext text="Next: scan each box or lot that came back." action={{ label: "Scan a box", href: "#scan" }} />
  ) : v.can.approve ? (
    <DoNext text="Next: approve the return (or send it back to be fixed)." action={{ label: "Approve now", href: "#decide" }} />
  ) : v.can.post ? (
    <DoNext text="Next: take the goods in. They are kept apart until QA checks them.">
      <PostReturnButton returnId={h.id} />
    </DoNext>
  ) : v.can.inspect ? (
    <DoNext text="QA has decided every lot. Next: mark it so.">
      <InspectReturnButton returnId={h.id} />
    </DoNext>
  ) : v.can.close ? (
    <DoNext text="Next: finish the return.">
      <CloseReturnButton returnId={h.id} />
    </DoNext>
  ) : h.status === "submitted" ? (
    <DoNext text={v.can.approveBlockedReason ?? "Sent for approval."} waitingFor={`Waiting for ${await whoDoes(ctx, "sales.customer_return.approve", h.siteId, "a site manager or QA")} to approve.`} />
  ) : h.status === "approved" ? (
    <DoNext text="Approved." waitingFor={`Waiting for ${await whoDoes(ctx, "sales.customer_return.post", h.siteId, "a site manager")} to take the goods in.`} />
  ) : h.status === "received" ? (
    <DoNext text="The goods are back in, kept apart." waitingFor={v.can.inspectBlockedReason ? "Waiting for QA to decide each returned lot (open the lot from its line below)." : "Waiting for QA."} />
  ) : (
    <DoNext text={returnWord(h.status)} />
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Customer return: ${h.customerName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/sales/returns" className="text-primary-text hover:underline">Customer returns</Link>
            <RecordNo>{h.returnNumber}</RecordNo>
            <ReturnStatusChip status={h.status} />
          </span>
        }
        actions={
          <>
            {h.receivedAt && (
              <LinkButton href={`/print/return-receipt/${h.id}`} variant="secondary">
                Print return receipt
              </LinkButton>
            )}
            <MoreMenu>
              <div className="flex flex-col gap-3">
                {v.can.sendBack && !v.can.approve && <SendBackForm returnId={h.id} />}
                {v.can.cancel && (
                  <div>
                    <p className="mb-2 text-[14px] font-medium">Cancel this return</p>
                    <CancelReturnForm returnId={h.id} />
                  </div>
                )}
                <Help screen="sales.return" />
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for one customer return: what came back, from which delivery, and the next step until QA has decided.</PageIntro>
      {next}
      {h.status === "received" && (
        <div className="mb-4">
          <Banner tone="q" title="Kept apart, waiting for QA">
            QA decides each returned lot from its lot page (OK to sell again, stop, or not OK). Nothing is sold or thrown away before that.
          </Banner>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {v.can.approve && (
          <Card>
            <span id="decide" className="block scroll-mt-24" />
            <CardTitle>Approve</CardTitle>
            <div className="flex flex-col gap-4">
              <ApproveReturnForm returnId={h.id} />
              {v.can.sendBack && (
                <MoreDetails title="Send back to be fixed">
                  <SendBackForm returnId={h.id} />
                </MoreDetails>
              )}
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>What came back</CardTitle>
          {v.lines.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing yet. Scan the first box or lot below.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.lines.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.productName ?? "Product"}</span>
                      <span className="block text-[13px] text-fg-2">
                        {l.conditionLabel}
                        {l.boxNumber ? ` · box ${l.boxNumber}` : ""} · kept at {l.toLocationCode}
                        {l.manualEntry && (
                          <>
                            {" "}
                            <Chip tone="warn">typed by hand</Chip>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-[15px] font-semibold tabular">{fmtLotQty(l.qtyBase, l.baseUom)}</span>
                  </div>
                  <p className="text-[13px]">
                    {l.returnLotId ? (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        Return lot{" "}
                        <Link className="font-mono text-primary-text hover:underline" href={`/quality/lots/${l.returnLotId}`}>
                          {l.returnLotNumber}
                        </Link>
                        <QaStatusChip status={l.returnLotStatus ?? "quarantine"} />
                        {l.disposition ? ` · QA: ${DECISION_WORD[l.disposition.decision] ?? l.disposition.decision}, ${fmtDate(l.disposition.decidedAt)}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted">Gets its own return lot when it is taken in.</span>
                    )}
                  </p>
                  <p className="font-mono text-[12px] text-muted">sent as lot {l.lotNumber}</p>
                  {v.can.scan && (
                    <div>
                      <RemoveLineButton returnId={h.id} lineId={l.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.can.scan && (
            <div className="mt-4 border-t border-line pt-4">
              <span id="scan" className="block scroll-mt-24" />
              {v.locations.length ? <ScanLineForm returnId={h.id} locations={v.locations} defaultLocationId={h.toLocationId} /> : <p className="text-[13px] text-muted">This site has no place to keep returned goods apart. Ask an administrator.</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>About this return</CardTitle>
          <Dl
            items={[
              ["Customer", h.customerName],
              ["Why", `${h.reasonName}${h.reasonNote ? ` — ${h.reasonNote}` : ""}`],
              ["From the delivery", `sent ${fmtDate(h.dispatchedAt)}${h.deliveredAt ? `, delivered ${fmtDate(h.deliveredAt)}` : ""} · ${SHIPMENT_WORD[v.shipment.state]}`],
              ["Order", h.salesOrderId ? <Link key="o" className="text-primary-text hover:underline" href={`/sales/${h.salesOrderId}`}>{h.orderNumber}</Link> : "—"],
              ...(h.complaintId ? ([["Complaint", <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${h.complaintId}`}>{h.complaintNumber}</Link>]] as [string, React.ReactNode][]) : []),
            ]}
          />
          <div className="mt-3">
            <MoreDetails>
              <Dl
                items={[
                  ["Customer number", h.customerCode],
                  ["Delivery receipt", h.drNumber],
                  ["Kept at", h.toLocationCode],
                  ["Started", `${fmtDateTime(h.createdAt)} · ${h.createdByName}`],
                  ["Approved", h.approvedAt ? `${fmtDateTime(h.approvedAt)} · ${h.approvedByName}${h.approvalNote ? ` — ${h.approvalNote}` : ""}` : "—"],
                  ["Taken in", h.receivedAt ? `${fmtDateTime(h.receivedAt)} · ${h.receivedByName}` : "—"],
                  ...(h.cancelReason ? ([["Cancelled", h.cancelReason]] as [string, string][]) : []),
                ]}
              />
              <p className="text-[13px] font-medium">Sent and came back on this delivery</p>
              <ul className="flex flex-col gap-1 text-[13px]">
                {v.shipment.lines.map((s) => (
                  <li key={s.lotId}>
                    Lot <span className="font-mono">{s.lotNumber}</span>: sent {fmtLotQty(s.qtyBase, s.baseUom)}, came back {fmtLotQty(s.returnedQty, s.baseUom)}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-muted">Credit notes for returns are not made here yet; finance makes them separately.</p>
            </MoreDetails>
          </div>
        </Card>

        <MoreDetails title="What happened">
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${returnWord(t.from)} → ` : ""}
                {returnWord(t.to)}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </MoreDetails>
      </div>
    </div>
  );
}
