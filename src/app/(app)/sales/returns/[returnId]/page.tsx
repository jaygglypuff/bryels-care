import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCustomerReturn } from "@/modules/sales";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { fmtLotQty } from "../../../quality/_ui";
import { ReturnStatusChip } from "../_ui";
import { ApproveReturnForm, CancelReturnForm, CloseReturnButton, InspectReturnButton, PostReturnButton, RemoveLineButton, ScanLineForm, SendBackForm, SubmitReturnButton } from "../forms";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

const SHIPMENT_WORD = { not_returned: "Nothing returned yet", partially_returned: "Partly returned", returned: "Fully returned" } as const;

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
        <EmptyState title="Return not found" action={<LinkButton href="/sales/returns" variant="secondary">Returns</LinkButton>}>
          This return does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const h = v.header;
  const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2";
  return (
    <>
      <PageHeader
        title={h.returnNumber}
        subtitle={`${h.customerName} · ${h.drNumber} · ${h.siteCode}`}
        actions={
          <>
            <Help screen="sales.return" />
            {h.receivedAt && (
              <a className={linkCls} href={`/print/return-receipt/${h.id}`}>
                Return receipt
              </a>
            )}
            <LinkButton href="/sales/returns" variant="secondary">
              Returns
            </LinkButton>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {h.status === "received" && (
          <Banner tone="q" title="In quarantine, waiting for QA">
            Each returned lot is decided by QA from its lot page (release, hold or reject). Nothing is resold or scrapped before that.
          </Banner>
        )}
        <Card>
          <CardTitle action={<ReturnStatusChip status={h.status} label={h.statusLabel} />}>Return</CardTitle>
          <Dl
            items={[
              ["Customer", `${h.customerName} (${h.customerCode})`],
              ["Delivery receipt", `${h.drNumber} · dispatched ${fmtDate(h.dispatchedAt)}${h.deliveredAt ? ` · delivered ${fmtDate(h.deliveredAt)}` : ""}`],
              ["Order", h.salesOrderId ? <Link key="o" className="text-primary-text hover:underline" href={`/sales/${h.salesOrderId}`}>{h.orderNumber}</Link> : "—"],
              ["Reason", `${h.reasonName}${h.reasonNote ? ` — ${h.reasonNote}` : ""}`],
              ["Complaint", h.complaintId ? <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${h.complaintId}`}>{h.complaintNumber}</Link> : "—"],
              ["Receive into", h.toLocationCode],
              ["Opened", `${fmtDateTime(h.createdAt)} · ${h.createdByName}`],
              ["Approved", h.approvedAt ? `${fmtDateTime(h.approvedAt)} · ${h.approvedByName}${h.approvalNote ? ` — ${h.approvalNote}` : ""}` : "—"],
              ["Received", h.receivedAt ? `${fmtDateTime(h.receivedAt)} · ${h.receivedByName}` : "—"],
              ["Shipment", SHIPMENT_WORD[v.shipment.state]],
              ...(h.cancelReason ? ([["Cancelled", h.cancelReason]] as [string, string][]) : []),
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Returned goods</CardTitle>
          {v.lines.length === 0 ? (
            <p className="text-[13px] text-muted">No lines yet. Scan the first returned box or lot below.</p>
          ) : (
            <Table head={["#", "Lot shipped", "Box", "Quantity", "Condition", "Into", "Return lot", "QA decision", ""]}>
              {v.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td>
                    {l.lotNumber}
                    <div className="text-[12px] text-muted">{l.productName ?? ""}</div>
                  </Td>
                  <Td className="text-[13px]">
                    {l.boxNumber ?? "—"}
                    {l.manualEntry && (
                      <div>
                        <Chip tone="warn">typed by hand</Chip>
                      </div>
                    )}
                  </Td>
                  <Td>{fmtLotQty(l.qtyBase, l.baseUom)}</Td>
                  <Td className="text-[13px]">{l.conditionLabel}</Td>
                  <Td className="text-[13px]">{l.toLocationCode}</Td>
                  <Td>
                    {l.returnLotId ? (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <Link className="text-primary-text hover:underline" href={`/quality/lots/${l.returnLotId}`}>
                          {l.returnLotNumber}
                        </Link>
                        <StatusChip status={l.returnLotStatus ?? "quarantine"} />
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">at posting</span>
                    )}
                  </Td>
                  <Td className="text-[13px]">{l.disposition ? `${l.disposition.decision} · ${fmtDate(l.disposition.decidedAt)}` : l.returnLotId ? "Waiting for QA" : "—"}</Td>
                  <Td>{v.can.scan && <RemoveLineButton returnId={h.id} lineId={l.id} />}</Td>
                </tr>
              ))}
            </Table>
          )}
          {v.can.scan && (
            <div className="mt-4 border-t border-line pt-4">
              {v.locations.length ? <ScanLineForm returnId={h.id} locations={v.locations} defaultLocationId={h.toLocationId} /> : <p className="text-[13px] text-muted">No active quarantine location for returns at this site.</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Shipped and returned on {h.drNumber}</CardTitle>
          <Table head={["Lot", "Shipped", "Returned (posted)"]}>
            {v.shipment.lines.map((s) => (
              <tr key={s.lotId}>
                <Td>{s.lotNumber}</Td>
                <Td>{fmtLotQty(s.qtyBase, s.baseUom)}</Td>
                <Td>{fmtLotQty(s.returnedQty, s.baseUom)}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        {h.status !== "closed" && h.status !== "cancelled" && (
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-4">
              {v.can.submit && <SubmitReturnButton returnId={h.id} />}
              {v.can.approve && <ApproveReturnForm returnId={h.id} />}
              {v.can.approveBlockedReason && <p className="text-[13px] text-muted">{v.can.approveBlockedReason}</p>}
              {v.can.sendBack && (
                <details>
                  <summary className="cursor-pointer text-[13px] text-primary-text">Send back to draft</summary>
                  <div className="mt-3">
                    <SendBackForm returnId={h.id} />
                  </div>
                </details>
              )}
              {v.can.post && <PostReturnButton returnId={h.id} />}
              {v.can.inspect && <InspectReturnButton returnId={h.id} />}
              {v.can.inspectBlockedReason && <p className="text-[13px] text-muted">{v.can.inspectBlockedReason}</p>}
              {v.can.close && <CloseReturnButton returnId={h.id} />}
              {h.status === "submitted" && !v.can.approve && !v.can.approveBlockedReason && <p className="text-[13px] text-muted">Waiting for approval by a site manager or QA (sales.customer_return.approve).</p>}
              {h.status === "approved" && !v.can.post && <p className="text-[13px] text-muted">Waiting to be received by a site manager (sales.customer_return.post).</p>}
              {v.can.cancel && (
                <details>
                  <summary className="cursor-pointer text-[13px] text-primary-text">Cancel this return</summary>
                  <div className="mt-3">
                    <CancelReturnForm returnId={h.id} />
                  </div>
                </details>
              )}
              <p className="text-[12px] text-muted">Credit notes for returns are not available yet; finance issues them separately.</p>
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${t.from} → ` : ""}
                {t.to}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
