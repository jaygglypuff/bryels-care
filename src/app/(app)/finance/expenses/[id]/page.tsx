import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/qty";
import { EXPENSE_STATUS_LABEL, getExpenseClaim } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, CLAIM_WORD, DoNow, FinanceStatus, HistoryCard, Money, PostingsCard, waitingText } from "../../finance-ui";
import { ReceiptForm } from "./receipt-form";

export const metadata = { title: "Expense claim" };

/** One expense claim: who spent what, the next step by state (receipt, send, approve, save to the books, pay back). */
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
  const claimant = name(c.claimantUserId);
  const canSubmit = c.status === "draft" && d.isClaimant;
  const needsReceipt = canSubmit && !d.receipt;
  const canDecide = c.status === "submitted" && d.canApprove;
  const canPost = c.status === "approved" && ctx.can("finance.expense_claim.post") && !d.posterBlocked;
  const canPay = c.status === "posted" && ctx.can("finance.payment_record.create");
  const canWithdraw = ["draft", "submitted", "approved"].includes(c.status) && d.isClaimant;
  const canVoid = c.status === "posted" && Number(c.paidAmount) === 0 && ctx.can("finance.expense_claim.void");
  const payHref = `/finance/payments/new?counterparty=claimant:${c.claimantUserId}`;
  return (
    <>
      <PageHeader
        title={claimant}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            Expense claim · <RecordNo>{c.claimNumber}</RecordNo> <FinanceStatus status={c.status} label={CLAIM_WORD[c.status] ?? EXPENSE_STATUS_LABEL[c.status]} />
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/finance/expenses" variant="secondary">
                All claims
              </LinkButton>
              {canWithdraw && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Take back your claim if it was a mistake. It stays on record.</p>
                  <FinanceCommand entity="expense" id={c.id} command="cancel" label="Take back my claim" reason variant="danger" />
                </div>
              )}
              {canVoid && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel (kept on record): a cancelling entry is saved to the books.</p>
                  <FinanceCommand entity="expense" id={c.id} command="void" label="Cancel (kept on record)" reason password variant="danger" />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one expense claim: what {d.isClaimant ? "you" : claimant} spent, the receipt, who approves it, and paying it back.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Claim saved.">{d.receiptRequired ? `Add the receipt photo (needed above ${fmtMoney(d.receiptLimit)}), then send it for approval.` : "Add the receipt photo if you have one, then send it for approval."}</Banner>
        </div>
      )}
      {c.status === "rejected" && (
        <div className="mb-4">
          <Banner tone="bad" title="Not approved">{c.rejectionReason}</Banner>
        </div>
      )}
      {needsReceipt ? (
        <NextStep text={d.receiptRequired ? "Next: add a photo of the receipt (needed for this amount), then send it." : "Next: add a photo of the receipt if you have one, then send it for approval."} action={{ label: "Add the receipt", href: "#do" }} />
      ) : canSubmit ? (
        <NextStep text="Next: send your claim for approval." action={{ label: "Send for approval", href: "#do" }} />
      ) : canDecide ? (
        <NextStep text="Next: approve this claim, send it back, or say no." action={{ label: "Decide", href: "#do" }} />
      ) : c.status === "submitted" ? (
        <NextStep text="This claim waits for approval." waitingFor={d.isClaimant ? `${waitingText(d.progress)} You cannot approve your own claim.` : waitingText(d.progress)} />
      ) : canPost ? (
        <NextStep text="Next: save it to the books. Then the person can be paid back." action={{ label: "Save to the books", href: "#do" }} />
      ) : c.status === "approved" ? (
        <NextStep text="Approved." waitingFor={d.posterBlocked ? "You claimed or approved it, so another finance person saves it to the books." : "Waiting for finance to save it to the books."} />
      ) : canPay ? (
        <NextStep text={`Next: pay ${claimant} back, then save the payment.`} action={{ label: "Pay back", href: payHref }} />
      ) : c.status === "posted" ? (
        <NextStep text="In the books." waitingFor="Waiting for finance to pay it back." />
      ) : null}
      <div className="flex flex-col gap-4">
        {(canSubmit || canDecide || canPost) && (
          <DoNow>
            {canSubmit && !d.receipt && <ReceiptForm id={c.id} storageReady={d.storageReady} />}
            {canSubmit && <FinanceCommand entity="expense" id={c.id} command="submit" label="Send for approval" variant={needsReceipt ? "secondary" : "cta"} />}
            {canDecide && (
              <>
                <FinanceCommand entity="expense" id={c.id} command="approve" label="Approve" note variant="cta" />
                <FinanceCommand entity="expense" id={c.id} command="return" label="Send back to change" reason />
                <FinanceCommand entity="expense" id={c.id} command="reject" label="Say no" reason variant="danger" />
              </>
            )}
            {canPost && <FinanceCommand entity="expense" id={c.id} command="post" label="Save to the books" password variant="cta" hint="It is dated on the approval day and the person can then be paid back. After this it cannot be changed." />}
          </DoNow>
        )}
        <Card>
          <CardTitle action={<Money value={c.amount} className="text-[20px] font-semibold" />}>What was spent</CardTitle>
          <p className="mb-3 text-[15px]">{c.description}</p>
          <Dl
            items={[
              ["Kind", d.categoryLabel],
              ["When", fmtDate(c.expenseDate)],
              ["Receipt", d.receipt ? `${d.receipt.fileName} (${Math.ceil(d.receipt.sizeBytes / 1024)} KB)` : d.receiptRequired ? "Needed, not added yet" : "None"],
              ["Paid back", <Money key="p" value={c.paidAmount} />],
            ]}
          />
        </Card>
        <MoreDetails title="Approvals and book entries">
          <Dl items={[["Approved by", name(c.approvedBy)], ["Saved to the books", c.postedBy ? `${name(c.postedBy)} · ${fmtDateTime(c.postedAt)}` : "—"]]} />
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </MoreDetails>
      </div>
    </>
  );
}
