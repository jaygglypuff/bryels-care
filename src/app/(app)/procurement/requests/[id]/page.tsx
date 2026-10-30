import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getPurchaseRequest } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Input, LinkButton, PageHeader, Table, Td, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Forbidden } from "../../../forbidden";
import { cancelRequestAction, decideRequestAction, submitRequestAction } from "../../actions";
import { PrChip, Steps, SubNav, money } from "../../_ui";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.view")) return <Forbidden what="purchase requests" />;
  const { id } = await params;
  let v: Awaited<ReturnType<typeof getPurchaseRequest>>;
  try {
    v = await getPurchaseRequest(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Request not found" action={<LinkButton href="/procurement/requests" variant="secondary">Requests</LinkButton>}>
          It does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const r = v.request;
  return (
    <>
      <PageHeader
        title={r.requestNumber}
        subtitle={`${v.site?.code ?? ""} · requested by ${v.requestedByName}`}
        actions={
          <>
            {v.can.convert && <LinkButton href="/procurement/orders/new" variant="cta">Create purchase order</LinkButton>}
            <LinkButton href="/procurement/requests" variant="secondary">Requests</LinkButton>
          </>
        }
      />
      <SubNav />
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle action={<PrChip status={r.status} />}>Request</CardTitle>
          <Dl
            items={[
              ["Needed by", r.neededByDate ? fmtDate(r.neededByDate) : "—"],
              ["Why", r.justification ?? "—"],
              ...(v.can.seePrices ? ([["Estimate", r.estimatedTotalAmount ? money(r.estimatedTotalAmount, r.currency) : "—"]] as [string, string][]) : []),
              ["Submitted", r.submittedAt ? fmtDateTime(r.submittedAt) : "—"],
              ["Approved", r.approvedAt ? fmtDateTime(r.approvedAt) : "—"],
              ...(r.rejectReason ? ([["Rejected", r.rejectReason]] as [string, string][]) : []),
              ...(r.cancelReason ? ([["Cancelled", r.cancelReason]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Materials</CardTitle>
          <Table head={["#", "Material", "Quantity", "Suggested supplier", ...(v.can.seePrices ? ["Estimate"] : []), "On a PO"]}>
            {v.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.lineNo}</Td>
                <Td>
                  {l.materialCode}
                  <div className="text-[12px] text-muted">{l.materialName}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  {Number(l.qtyEntered)} {l.uomEntered}
                </Td>
                <Td>{l.supplierName ?? "—"}</Td>
                {v.can.seePrices && <Td>{l.estimatedUnitAmount ? `${money(l.estimatedUnitAmount)}/${l.uomEntered}` : "—"}</Td>}
                <Td>{l.convertedPoLineId ? "yes" : "no"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardTitle>Approval</CardTitle>
          <Steps steps={v.progress.steps} />
          <div className="mt-3 flex flex-col gap-3">
            {v.can.submit && <ActionForm action={submitRequestAction} hidden={{ requestId: r.id }} submit="Submit for approval" variant="cta" />}
            {v.can.decide && (
              <div className="grid gap-3 sm:grid-cols-3">
                <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "approve" }} submit="Approve" variant="cta">
                  <Input name="note" placeholder="Note (optional)" aria-label="Note" />
                </ActionForm>
                <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "return" }} submit="Return for changes" variant="secondary">
                  <Input name="note" placeholder="What must change?" aria-label="Reason" required />
                </ActionForm>
                <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "reject" }} submit="Reject" variant="danger">
                  <Input name="note" placeholder="Why rejected?" aria-label="Reason" required />
                </ActionForm>
              </div>
            )}
            {v.can.cancel && (
              <details>
                <summary className="cursor-pointer text-[14px] text-[var(--bad-fg)]">Cancel the request</summary>
                <ActionForm action={cancelRequestAction} hidden={{ requestId: r.id }} submit="Cancel request" variant="danger" confirm="Cancel this request?">
                  <Textarea name="reason" rows={2} placeholder="Reason" aria-label="Reason" required />
                </ActionForm>
              </details>
            )}
          </div>
        </Card>
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
        {r.status === "draft" && (ctx.can("procurement.purchase_request.edit") || ctx.can("procurement.purchase_request.create")) && <DeleteDraftCard kind="purchase_request" id={r.id} what="purchase request" />}
      </div>
    </>
  );
}
