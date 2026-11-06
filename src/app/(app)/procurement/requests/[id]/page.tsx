import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getPurchaseRequest, procurementNextActors } from "@/modules/procurement";
import { NextApprover } from "@/ui/next-approver";
import { Card, CardTitle, Dl, EmptyState, Input, LinkButton, PageHeader, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { NextStepBox } from "@/ui/next-step-box";
import { RecordNo } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { waitingFor } from "../../../waiting-for";
import { cancelRequestAction, decideRequestAction, submitRequestAction } from "../../actions";
import { Amount, History, PrChip, Steps, SubNav, money } from "../../_ui";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request to buy" };

/** One request to buy: what is wanted, the next step by state, approve / send back / say no, cancel in ⋯ More. */
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.view")) return <Forbidden what="requests to buy" permission="procurement.purchase_request.view" />;
  const { id } = await params;
  let v: Awaited<ReturnType<typeof getPurchaseRequest>>;
  try {
    v = await getPurchaseRequest(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Request not found" action={<LinkButton href="/procurement/requests" variant="secondary">All requests</LinkButton>}>
          It does not exist or is not at one of your sites. Ask the person who made it.
        </EmptyState>
      );
    }
    throw e;
  }
  const r = v.request;
  // ADR-110 C15: the order made from this request keeps its supplier (when the request named one).
  const open = v.lines.filter((l) => !l.convertedPoLineId);
  const supplierIds = [...new Set(open.map((l) => l.suggestedSupplierId).filter((x): x is string => !!x))];
  const oneApproval = supplierIds.length === 1 && open.every((l) => l.suggestedSupplierId && l.estimatedUnitAmount !== null);
  const title = v.lines.length ? v.lines.map((l) => l.materialName).slice(0, 3).join(", ") + (v.lines.length > 3 ? ` and ${v.lines.length - 3} more` : "") : "Request to buy";
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            Request to buy · <RecordNo>{r.requestNumber}</RecordNo> <PrChip status={r.status} />
          </span>
        }
        actions={
          v.can.cancel ? (
            <MoreMenu>
              <p className="mb-2 text-[13px] text-muted">Cancel only a request made by mistake or no longer needed. It stays on record.</p>
              <ActionForm action={cancelRequestAction} hidden={{ requestId: r.id }} submit="Cancel the request" variant="danger" confirm="Cancel this request? It stays on record as cancelled.">
                <Textarea name="reason" rows={2} placeholder="Why" aria-label="Why" required />
              </ActionForm>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for one request to buy: what is needed, who approves it, and when it becomes a purchase order.</PageIntro>
      {v.can.submit ? (
        <NextStepBox text="Next: send this request for approval.">
          <ActionForm action={submitRequestAction} hidden={{ requestId: r.id }} submit="Send for approval" variant="cta" />
        </NextStepBox>
      ) : v.can.decide ? (
        <NextStepBox text="Next: approve this request, send it back, or say no.">
          <div className="grid gap-4 sm:grid-cols-3">
            <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "approve" }} submit="Approve" variant="cta">
              <Input name="note" placeholder="Note (you can skip this)" aria-label="Note" />
            </ActionForm>
            <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "return" }} submit="Send back to change" variant="secondary">
              <Input name="note" placeholder="What must change?" aria-label="What must change" required />
            </ActionForm>
            <ActionForm action={decideRequestAction} hidden={{ requestId: r.id, decision: "reject" }} submit="Say no" variant="danger" confirm="Say no to this request? It cannot be ordered after this.">
              <Input name="note" placeholder="Why not?" aria-label="Why not" required />
            </ActionForm>
          </div>
        </NextStepBox>
      ) : v.can.convert ? (
        <NextStep
          text={`Next: approved. Make the purchase order${supplierIds.length === 1 ? ` to ${v.lines.find((l) => l.suggestedSupplierId)?.supplierName ?? "the supplier"}` : ""}.`}
          action={{ label: "Make the purchase order", href: `/procurement/orders/new?request=${r.id}${supplierIds.length === 1 ? `&supplier=${supplierIds[0]}` : ""}` }}
          waitingFor={
            oneApproval && r.estimatedTotalAmount
              ? `It needs no second approval while it stays with this supplier, these items and up to ${money(r.estimatedTotalAmount, r.currency)}.`
              : "No supplier or price was named on the request, so the order goes to the manager for approval."
          }
        />
      ) : r.status === "draft" ? (
        <NextStep text="This request is a draft." waitingFor={`Waiting for ${v.requestedByName} to send it for approval.`} />
      ) : r.status === "submitted" ? (
        <NextStep text="This request waits for approval." waitingFor={<NextApprover next={await procurementNextActors(ctx, "purchase_request", r.id)} inline />} />
      ) : r.status === "approved" ? (
        <NextStep text="Approved." waitingFor={await waitingFor(ctx, "procurement.purchase_order.create", r.siteId, "to order it from a supplier", "purchasing")} />
      ) : null}
      <SubNav />
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle action={v.can.seeTotal && r.estimatedTotalAmount ? <Amount>about {money(r.estimatedTotalAmount, r.currency)}</Amount> : undefined}>What is needed</CardTitle>
          <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {v.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{l.materialName}</span>
                    {l.convertedPoLineId && <Chip tone="info">On a purchase order</Chip>}
                  </p>
                  <p className="text-[14px] text-fg-2">
                    {Number(l.qtyEntered).toLocaleString("en-PH", { maximumFractionDigits: 3 })} {l.uomEntered}
                    {l.supplierName ? ` · suggested supplier ${l.supplierName}` : ""}
                    <span className="ml-1 font-mono text-[12px] text-muted">· {l.materialCode}</span>
                  </p>
                </div>
                {v.can.seePrices && l.estimatedUnitAmount && <span className="shrink-0 text-[14px] text-fg-2 tabular-nums">{money(l.estimatedUnitAmount)} per {l.uomEntered}</span>}
              </li>
            ))}
          </ul>
          <Dl
            items={[
              ["Needed by", r.neededByDate ? fmtDate(r.neededByDate) : "—"],
              ["Why", r.justification ?? "—"],
              ["Asked by", v.requestedByName],
              ...(r.rejectReason ? ([["Why not approved", r.rejectReason]] as [string, string][]) : []),
              ...(r.cancelReason ? ([["Why cancelled", r.cancelReason]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <MoreDetails title="Approvals and history">
          <Dl items={[["Sent for approval", r.submittedAt ? fmtDateTime(r.submittedAt) : "—"], ["Approved", r.approvedAt ? fmtDateTime(r.approvedAt) : "—"], ["Site", v.site?.name ?? "—"]]} />
          <div>
            <p className="mb-2 text-[14px] font-semibold">Approval</p>
            <Steps steps={v.progress.steps} />
          </div>
          <div>
            <p className="mb-2 text-[14px] font-semibold">History</p>
            <History rows={v.transitions} />
          </div>
        </MoreDetails>
        {r.status === "draft" && (ctx.can("procurement.purchase_request.edit") || ctx.can("procurement.purchase_request.create")) && <DeleteDraftCard kind="purchase_request" id={r.id} what="request to buy" />}
      </div>
    </>
  );
}
