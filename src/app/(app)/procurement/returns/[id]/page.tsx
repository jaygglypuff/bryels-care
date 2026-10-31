import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getSupplierReturn, returnableLots } from "@/modules/procurement";
import { Card, CardTitle, Dl, EmptyState, Field, Input, LinkButton, PageHeader, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, StatusChip } from "@/ui/status";
import { ScanOrPick } from "@/ui/scan-or-pick";
import { Forbidden } from "../../../forbidden";
import { addReturnLineAction, cancelReturnAction, decideReturnAction, postReturnAction, removeReturnLineAction, submitReturnAction } from "../../actions";
import { Amount, History, SrChip, Steps, SubNav, approverWords, fmtBase, money } from "../../_ui";

export const dynamic = "force-dynamic";

/** One return to a supplier: lots going back, the next step by state (add lots, approve, send back), cancel in ⋯ More. */
export default async function SupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.view")) return <Forbidden what="returns to suppliers" />;
  const { id } = await params;
  let v: Awaited<ReturnType<typeof getSupplierReturn>>;
  try {
    v = await getSupplierReturn(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Return not found" action={<LinkButton href="/procurement/returns" variant="secondary">All returns</LinkButton>}>
          It does not exist or is not at one of your sites. Ask purchasing.
        </EmptyState>
      );
    }
    throw e;
  }
  const { sr, can } = v;
  const lots = can.edit ? (await returnableLots(ctx, v.supplier.id)).filter((l) => l.returnable) : [];
  const waiting = `Waiting for ${approverWords(v.progress.next)} to approve.`;
  return (
    <>
      <PageHeader
        title={v.supplier.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            Return to supplier · <RecordNo>{sr.returnNumber}</RecordNo> <SrChip status={sr.status} />
          </span>
        }
        actions={
          can.cancel ? (
            <MoreMenu>
              <p className="mb-2 text-[13px] text-muted">Cancel only a return started by mistake. It stays on record.</p>
              <ActionForm action={cancelReturnAction} hidden={{ returnId: sr.id }} submit="Cancel the return" variant="danger" confirm="Cancel this return? It stays on record as cancelled.">
                <Textarea name="reason" rows={2} placeholder="Why" aria-label="Why" required />
              </ActionForm>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>
        This screen is for one return to a supplier: which lots go back, who approves, and the moment the goods leave. <Explain term="lot" />
      </PageIntro>
      {can.edit && v.lines.length === 0 ? (
        <NextStep text="Next: add the lots that go back." action={{ label: "Add a lot", href: "#add" }} />
      ) : can.submit ? (
        <NextStep text="Next: all lots added? Send the return for approval." action={{ label: "Send for approval", href: "#do" }} />
      ) : can.decide ? (
        <NextStep text="Next: approve this return, or send it back with what to change." action={{ label: "Approve or send back", href: "#do" }} />
      ) : can.post ? (
        <NextStep text="Next: when the goods leave, save it — the stock goes down." action={{ label: "The goods left", href: "#do" }} />
      ) : sr.status === "submitted" ? (
        <NextStep text="This return waits for approval." waitingFor={waiting} />
      ) : sr.status === "approved" ? (
        <NextStep text="Approved." waitingFor="Waiting for the warehouse or purchasing (not the approver) to send the goods and save it." />
      ) : sr.status === "draft" ? (
        <NextStep text="This return is a draft." waitingFor="Waiting for purchasing to add the lots and send it for approval." />
      ) : null}
      <SubNav />
      <div className="flex flex-col gap-5">
        {sr.status === "posted" && <Banner tone="ok" title="Sent back">The stock went down for every lot. The money back from the supplier is followed up on their supplier bill.</Banner>}
        {(can.submit || can.decide || can.post) && (
          <Card>
            <span id="do" className="block scroll-mt-24" />
            <CardTitle>Do it now</CardTitle>
            <div className="flex flex-col gap-4">
              {can.submit && <ActionForm action={submitReturnAction} hidden={{ returnId: sr.id }} submit="Send for approval" variant="cta" />}
              {can.decide && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <ActionForm action={decideReturnAction} hidden={{ returnId: sr.id, decision: "approve" }} submit="Approve" variant="cta">
                    <Input name="note" placeholder="Note (you can skip this)" aria-label="Note" />
                  </ActionForm>
                  <ActionForm action={decideReturnAction} hidden={{ returnId: sr.id, decision: "return" }} submit="Send back to change" variant="secondary">
                    <Input name="note" placeholder="What must change?" aria-label="What must change" required />
                  </ActionForm>
                </div>
              )}
              {can.post && <ActionForm action={postReturnAction} hidden={{ returnId: sr.id, idempotencyKey: randomUUID() }} submit="The goods left: take them out of stock" variant="cta" confirm="Take every lot on this return out of stock now? This is saved and cannot be edited later." />}
            </div>
          </Card>
        )}
        <Card>
          <CardTitle action={can.seePrices && sr.creditExpectedAmount ? <Amount>{money(sr.creditExpectedAmount, sr.currency)} back</Amount> : undefined}>Lots going back</CardTitle>
          {v.lines.length === 0 ? (
            <p className="text-[14px] text-fg-2">No lots yet.{can.edit ? " Add them below." : ""}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
              {v.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{l.materialName}</span> <StatusChip status={l.lotStatus} />
                    </p>
                    <p className="text-[14px] text-fg-2">
                      {fmtBase(l.qtyBase, l.baseUom)} from {l.locationCode}
                      {l.stockMovementId ? " · out of stock" : ""}
                      <span className="ml-1 font-mono text-[12px] text-muted">
                        · {l.lotNumber}
                        {l.supplierLot ? ` · supplier lot ${l.supplierLot}` : ""}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {can.seePrices && l.creditExpectedAmount && <Amount>{money(l.creditExpectedAmount, l.currency)}</Amount>}
                    {can.edit && <ActionForm action={removeReturnLineAction} hidden={{ returnId: sr.id, lineId: l.id }} submit="Remove" variant="ghost" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {can.edit && (
            <div className="mt-4 border-t border-line pt-4">
              <span id="add" className="block scroll-mt-24" />
              {lots.length === 0 ? (
                <p className="text-[14px] text-fg-2">No lot of this supplier marked “Not OK” has stock here. QA marks a lot “Not OK” first; ask QA.</p>
              ) : (
                <ActionForm action={addReturnLineAction} hidden={{ returnId: sr.id }} submit="Add this lot" variant="secondary">
                  {(fe) => (
                    <>
                      <ScanOrPick
                        kind="lot"
                        name="lotLocation"
                        label="Which lot?"
                        hint="Tap it, or scan its lot label."
                        candidates={lots.map((l) => ({ value: `${l.lotId}|${l.locationId}`, title: l.materialName, detail: `${fmtBase(l.qty, l.baseUom)} on ${l.locationCode} · lot ${l.lotNumber}`, code: l.lotNumber, codes: [l.lotNumber] }))}
                        defaultValue={lots.length === 1 ? `${lots[0].lotId}|${lots[0].locationId}` : null}
                        onlyCandidates
                        required
                        error={fe.lotId ?? fe.lotLocation}
                      />
                      <Field label="How much goes back" htmlFor="qty" error={fe.qty} hint="In the lot's unit (for example 25000 g), or type it with the unit: 25 kg.">
                        <Input id="qty" name="qty" inputMode="decimal" required />
                      </Field>
                      <MoreDetails>
                        <Field label="Unit (if not typed above)" htmlFor="uom" hint="Empty = the lot's own unit.">
                          <Input id="uom" name="uom" />
                        </Field>
                        {can.seePrices && (
                          <Field label="Money back expected (₱)" htmlFor="creditExpectedAmount" hint="Empty = worked out from the order price.">
                            <Input id="creditExpectedAmount" name="creditExpectedAmount" inputMode="decimal" />
                          </Field>
                        )}
                      </MoreDetails>
                    </>
                  )}
                </ActionForm>
              )}
            </div>
          )}
        </Card>
        <MoreDetails title="Details, approvals and history">
          <Dl
            items={[
              ["Why", `${sr.reasonCode.replace(/_/g, " ")}${sr.reasonNote ? ` — ${sr.reasonNote}` : ""}`],
              ["From delivery", v.receipt ? <Link key="r" className="text-primary-text hover:underline" href={`/inventory/receive/${v.receipt.id}`}>{v.receipt.receiptNumber}</Link> : "—"],
              ["Purchase order", v.po ? <Link key="p" className="text-primary-text hover:underline" href={`/procurement/orders/${v.po.id}`}>{v.po.poNumber}</Link> : "—"],
              ["Supplier's return number", sr.supplierRmaReference ?? "—"],
              ...(can.seePrices ? ([["Money back expected", sr.creditExpectedAmount ? money(sr.creditExpectedAmount, sr.currency) : "not filled in (needs the higher approval)"]] as [string, string][]) : []),
              ["Sent back", sr.postedAt ? fmtDateTime(sr.postedAt) : "—"],
              ...(sr.cancelReason ? ([["Why cancelled", sr.cancelReason]] as [string, string][]) : []),
            ]}
          />
          <div>
            <p className="mb-2 text-[14px] font-semibold">Approval</p>
            <Steps steps={v.progress.steps} />
          </div>
          <div>
            <p className="mb-2 text-[14px] font-semibold">History</p>
            <History rows={v.transitions} />
          </div>
        </MoreDetails>
      </div>
    </>
  );
}
