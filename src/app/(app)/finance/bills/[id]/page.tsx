import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getSupplierBill } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NextStepBox } from "@/ui/next-step-box";
import { waitingFor } from "../../../waiting-for";
import { approvalWaiting } from "../../approval-waiting";
import { MoreMenu } from "@/ui/more-menu";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";

export const metadata = { title: "Supplier bill" };

const MATCH_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neu"> = { matched: "ok", no_po: "info", qty_variance: "bad", price_variance: "bad", no_receipt: "warn" };
/** "Check bill against order and delivery" results in words (stored codes unchanged). */
const MATCH_WORD: Record<string, string> = { matched: "Matches order and delivery", no_po: "Matches the delivery", qty_variance: "Amount differs from the delivery", price_variance: "Price differs from the order", no_receipt: "Not on a delivery" };

/** One supplier bill (money we owe): supplier first, the check against order and delivery, next step by state; posting rules unchanged. */
export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.view")) return <Forbidden what="supplier bills" permission="finance.supplier_bill.view" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getSupplierBill>>;
  try {
    d = await getSupplierBill(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = d.bill;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  const isCredit = b.billKind === "credit";
  const canSubmit = b.status === "draft" && ctx.can("finance.supplier_bill.submit");
  const canDecide = b.status === "submitted" && d.canApprove;
  const canPost = b.status === "approved" && ctx.can("finance.supplier_bill.post") && !d.posterBlocked;
  const canPay = ["posted", "partially_paid"].includes(b.status) && !isCredit && ctx.can("finance.payment_record.create");
  const canCancel = ["draft", "submitted", "disputed", "approved"].includes(b.status) && ctx.can("finance.supplier_bill.create");
  const canVoid = b.status === "posted" && Number(b.paidAmount) === 0 && !isCredit && ctx.can("finance.supplier_bill.void");
  const payHref = `/finance/payments/new?counterparty=supplier:${d.supplier.id}`;
  // UX audit round 2 part 2: the form for the next step sits inside the one "What to do next" box.
  const doNow = (
    <>
        {canSubmit && <FinanceCommand entity="bill" id={b.id} command="submit" label="Check against order and delivery, then send" variant="cta" />}
        {b.status === "disputed" && (
          <>
            {ctx.can("finance.supplier_bill.submit") && <FinanceCommand entity="bill" id={b.id} command="rematch" label="Check again" />}
            {d.canApproveVariance ? (
              <FinanceCommand entity="bill" id={b.id} command="approve_variance" label="Accept the difference" reason variant="cta" />
            ) : (
              <p className="text-[14px] text-fg-2">Another finance person (not the one who typed or sent this bill) can accept the difference.</p>
            )}
          </>
        )}
        {canDecide && (
          <>
            <FinanceCommand entity="bill" id={b.id} command="approve" label="Approve" note variant="cta" />
            <FinanceCommand entity="bill" id={b.id} command="return" label="Send back to change" reason />
          </>
        )}
        {canPost && <FinanceCommand entity="bill" id={b.id} command="post" label="Save to the books" password variant="cta" hint="After this it cannot be changed. It is dated on the bill date and the day to pay comes from the supplier's terms." />}
    </>
  );
  return (
    <>
      <RecordHeader
        back={{ href: "/finance/bills", label: "Supplier bills" }}
        typeLabel={isCredit ? "Money back from supplier" : "Supplier bill"}
        reference={b.billNumber}
        title={d.supplier.name}
        chip={<FinanceStatus status={b.status} />}
        actions={
          <MoreMenu compact>
            <div className="flex flex-col gap-3">
              <LinkButton href="/finance/bills" variant="secondary">
                All supplier bills
              </LinkButton>
              {b.status === "disputed" && ctx.can("finance.supplier_bill.create") && !isCredit && (
                <LinkButton href="/finance/bills/new" variant="secondary">
                  Enter money back from the supplier
                </LinkButton>
              )}
              {canCancel && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel only a bill typed by mistake or twice. It is not in the books yet.</p>
                  <FinanceCommand entity="bill" id={b.id} command="cancel" label="Cancel the bill" reason variant="danger" />
                </div>
              )}
              {canVoid && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel (kept on record): a cancelling entry is saved to the books. Type the right bill again if needed.</p>
                  <FinanceCommand entity="bill" id={b.id} command="void" label="Cancel (kept on record)" reason password variant="danger" confirm="Cancel this bill? It stays on record and a cancelling entry is saved to the books." />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one bill a supplier sent us: what they charge, whether it matches the order and the delivery, and paying it.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Supplier bill saved.">Send it for approval: the system first checks it against the order and the delivery.</Banner>
        </div>
      )}
      {canSubmit ? (
        <NextStepBox text="Next: send it for approval. The system first checks it against the order and the delivery.">{doNow}</NextStepBox>
      ) : b.status === "draft" ? (
        <NextStep text="This supplier bill is a draft." waitingFor={await waitingFor(ctx, "finance.supplier_bill.submit", b.siteId, "to send it for approval", "finance")} />
      ) : b.status === "disputed" ? (
        <NextStepBox
          text="This bill does not match the order or the delivery (see below). Ask the supplier for money back, check again, or accept the difference with a reason."
          waitingFor={d.canApproveVariance ? undefined : await waitingFor(ctx, "finance.supplier_bill.approve", b.siteId, "to accept the difference", "another finance person", { exclude: [b.createdBy, b.submittedBy], operational: true })}
        >
          {doNow}
        </NextStepBox>
      ) : canDecide ? (
        <NextStepBox text="Next: approve this supplier bill, or send it back with what to change.">{doNow}</NextStepBox>
      ) : b.status === "submitted" ? (
        <NextStep text="This supplier bill waits for approval." waitingFor={`${(await approvalWaiting(ctx, "finance.supplier_bill.approve", d.progress, { siteId: b.siteId, exclude: [b.createdBy, b.submittedBy], pendingSince: b.submittedAt }))}${!b.goodsReceiptId ? " Bills not for a delivery are approved by finance." : ""}`} />
      ) : canPost ? (
        <NextStepBox text="Next: save it to the books. The day to pay is set from the supplier's terms.">{doNow}</NextStepBox>
      ) : b.status === "approved" ? (
        <NextStep text="Approved." waitingFor={d.posterBlocked ? "You approved it, so another finance person saves it to the books (above the set amount)." : await waitingFor(ctx, "finance.supplier_bill.post", b.siteId, "to save it to the books", "finance", { exclude: [...(d.progress && !d.progress.posterMayEqualApprover ? d.progress.approvers : [])], operational: true })} />
      ) : canPay ? (
        <NextStep text={`Next: pay ${d.supplier.name}${b.dueDate ? ` by ${fmtDate(b.dueDate)}` : ""}, then save the payment.`} action={{ label: "Record a payment", href: payHref }} />
      ) : (
        <NextStep text={b.status === "paid" || b.status === "closed" ? "Paid. Nothing more to do." : ["posted", "partially_paid"].includes(b.status) ? "Saved to the books. Finance pays it by the day to pay." : "Cancelled. Nothing more to do."} />
      )}

      <div className="flex flex-col gap-4">
        {b.status === "disputed" && d.expectedSupplierCredits.length > 0 && (
          <Banner tone="info" title="Money back we expect from this supplier">
            {d.expectedSupplierCredits.map((c, i) => (
              <span key={c.returnId}>
                {i > 0 && ", "}
                <Link className="underline" href={`/procurement/returns/${c.returnId}`}>
                  return {c.returnNumber}
                </Link>{" "}
                (<Money value={c.creditExpectedAmount} />)
              </span>
            ))}
            .
          </Banner>
        )}

        <Card>
          <CardTitle action={<Money value={b.totalAmount} className="text-value" />}>What they charge</CardTitle>
          <p className="mb-2 text-[14px] text-fg-2">
            Checked against the order and the delivery:
          </p>
          <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {d.lines.map((l) => {
              const det = (l.matchDetail ?? {}) as Record<string, string | null>;
              return (
                <li key={l.id} className="flex flex-col gap-1 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.description}</span>
                      <span className="text-[13px] text-fg-2">
                        {fmtQty(l.qty, l.uom ?? "", 2)} × <Money value={l.unitAmount} />
                        {l.taxCode ? ` · tax ${Number(l.taxRatePct)} %` : ""}
                        {l.chargeKind !== "goods" ? ` · ${l.chargeKind}` : ""}
                      </span>
                    </span>
                    <Money value={l.lineAmount} className="shrink-0 font-semibold" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {l.matchResult ? <Chip tone={MATCH_TONE[l.matchResult] ?? "neu"}>{MATCH_WORD[l.matchResult] ?? l.matchResult}</Chip> : <span className="text-[13px] text-muted">Not checked yet</span>}
                    {det.receivedQty !== undefined && (
                      <span className="text-[13px] text-muted">
                        delivered {fmtQty(det.receivedQty, "", 2)}
                        {det.billedElsewhere && Number(det.billedElsewhere) > 0 ? `, already on another bill ${fmtQty(det.billedElsewhere, "", 2)}` : ""}
                      </span>
                    )}
                    {det.poNumber && (
                      <span className="text-[13px] text-muted">
                        order {det.poNumber}: expected <Money value={det.expectedAmount} />, allowed difference <Money value={det.priceTolerance} />
                      </span>
                    )}
                    {det.note && <span className="text-[13px] text-muted">{det.note}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-4">
            <div>
              <dt className="text-muted">Before tax</dt>
              <dd className="font-medium"><Money value={b.subtotalAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Tax</dt>
              <dd className="font-medium"><Money value={b.taxAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Paid so far</dt>
              <dd className="font-medium"><Money value={b.paidAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Still to pay</dt>
              <dd className="font-semibold"><Money value={b.openAmount} /></dd>
            </div>
          </dl>
          {b.varianceReason && <p className="mt-2 text-[14px]">Difference accepted by {name(b.varianceApprovedBy)} on {fmtDateTime(b.varianceApprovedAt)}: {b.varianceReason}</p>}
        </Card>

        <MoreDetails title="Details, approvals and book entries">
          <Dl
            items={[
              ["Their bill number", b.supplierReference],
              ["Delivery", d.receipt ? (ctx.can("procurement.goods_receipt.view") ? <Link key="g" className="text-primary-text hover:underline" href={`/inventory/receive/${d.receipt.id}`}>{d.receipt.receiptNumber}</Link> : d.receipt.receiptNumber) : "Not for a delivery"],
              ["What it was for", b.categoryCode ? b.categoryCode.replace(/_/g, " ") : "—"],
              ["Date on the bill", fmtDate(b.billDate)],
              ["Pay by", fmtDate(b.dueDate)],
              ...(d.creditFor ? ([["Lowers their bill", <Link key="cf" className="text-primary-text hover:underline" href={`/finance/bills/${d.creditFor.id}`}>{d.creditFor.billNumber}</Link>]] as [string, React.ReactNode][]) : []),
              ["Typed in by", name(b.createdBy)],
              ["Approved by", name(b.approvedBy)],
              ["Saved to the books by", b.postedBy ? `${name(b.postedBy)} · ${fmtDateTime(b.postedAt)}` : "—"],
            ]}
          />
          {d.credits.length > 0 && (
            <ul className="text-[14px]">
              {d.credits.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  Money back{" "}
                  <Link className="text-primary-text hover:underline" href={`/finance/bills/${c.id}`}>
                    {c.billNumber}
                  </Link>
                  <FinanceStatus status={c.status} /> <Money value={c.total} />
                </li>
              ))}
            </ul>
          )}
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </MoreDetails>
      </div>
    </>
  );
}
