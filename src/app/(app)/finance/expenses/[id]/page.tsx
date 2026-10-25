import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/qty";
import { EXPENSE_STATUS_LABEL, getExpenseClaim } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";
import { ReceiptForm } from "./receipt-form";

export const metadata = { title: "Expense claim" };

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.expense_claim.create") && !ctx.can("finance.expense_claim.view") && !ctx.can("finance.expense_claim.approve")) return <Forbidden what="expense claims" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getExpenseClaim>>;
  try {
    d = await getExpenseClaim(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const c = d.claim;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  return (
    <>
      <PageHeader
        title={`Expense claim ${c.claimNumber}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <FinanceStatus status={c.status} label={EXPENSE_STATUS_LABEL[c.status]} />
            <span>{name(c.claimantUserId)}</span>
          </span>
        }
        actions={
          <LinkButton href="/finance/expenses" variant="secondary">
            All claims
          </LinkButton>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Claim saved as a draft.">{d.receiptRequired ? `Attach the receipt (required above ${fmtMoney(d.receiptLimit)}), then submit it.` : "Attach the receipt if you have one, then submit it."}</Banner>
        </div>
      )}
      {c.status === "rejected" && (
        <div className="mb-4">
          <Banner tone="bad" title="Rejected">{c.rejectionReason}</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Claim</CardTitle>
            <Dl
              items={[
                ["Category", d.categoryLabel],
                ["Date", fmtDate(c.expenseDate)],
                ["Amount", <Money key="a" value={c.amount} />],
                ["Paid", <Money key="p" value={c.paidAmount} />],
                ["Description", c.description],
                ["Receipt", d.receipt ? `${d.receipt.fileName} (${Math.ceil(d.receipt.sizeBytes / 1024)} KB)` : d.receiptRequired ? "Required, not attached" : "None"],
                ["Approved by", name(c.approvedBy)],
                ["Posted", c.postedBy ? `${name(c.postedBy)} · ${fmtDateTime(c.postedAt)}` : "—"],
              ]}
            />
          </Card>
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {c.status === "draft" && d.isClaimant && (
                <>
                  {!d.receipt && <ReceiptForm id={c.id} storageReady={d.storageReady} />}
                  <FinanceCommand entity="expense" id={c.id} command="submit" label="Submit for approval" variant="cta" />
                </>
              )}
              {c.status === "submitted" &&
                (d.canApprove ? (
                  <>
                    <FinanceCommand entity="expense" id={c.id} command="approve" label="Approve claim" note variant="cta" />
                    <FinanceCommand entity="expense" id={c.id} command="return" label="Return to the claimant" reason />
                    <FinanceCommand entity="expense" id={c.id} command="reject" label="Reject" reason variant="danger" />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">
                    {d.isClaimant ? "Waiting for approval. You cannot approve your own claim." : d.progress?.next ? `Waiting for step ${d.progress.next.step}: ${d.progress.next.label}.` : "Waiting for approval."}
                  </p>
                ))}
              {c.status === "approved" &&
                ctx.can("finance.expense_claim.post") &&
                (d.posterBlocked ? (
                  <p className="text-[13px] text-muted">You claimed or approved this claim, so another finance person posts it.</p>
                ) : (
                  <FinanceCommand entity="expense" id={c.id} command="post" label="Post claim" password variant="cta" hint="Posting writes the expense (immutable) dated on the approval date; the claim becomes payable to the claimant." />
                ))}
              {c.status === "posted" && ctx.can("finance.payment_record.create") && (
                <LinkButton href={`/finance/payments/new?counterparty=claimant:${c.claimantUserId}`} variant="secondary">
                  Pay the claimant
                </LinkButton>
              )}
              {c.status === "posted" && Number(c.paidAmount) === 0 && ctx.can("finance.expense_claim.void") && <FinanceCommand entity="expense" id={c.id} command="void" label="Void claim (reversal)" reason password variant="danger" />}
              {["draft", "submitted", "approved"].includes(c.status) && d.isClaimant && <FinanceCommand entity="expense" id={c.id} command="cancel" label="Withdraw claim" reason variant="danger" />}
              {["paid", "rejected", "cancelled", "voided"].includes(c.status) && <p className="text-[13px] text-muted">Nothing left to do on this claim.</p>}
            </div>
          </Card>
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
        </div>
      </div>
    </>
  );
}
