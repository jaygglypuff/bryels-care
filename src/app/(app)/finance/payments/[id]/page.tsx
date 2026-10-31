import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { PAYMENT_METHOD_LABEL, getPayment } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, DoNow, FinanceStatus, HistoryCard, Money, PostingsCard, waitingText } from "../../finance-ui";

export const metadata = { title: "Payment" };

/** One payment: who, how much, what it pays; next step by state; cancel and "cancel (kept on record)" in ⋯ More. */
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.payment_record.view")) return <Forbidden what="payments" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getPayment>>;
  try {
    d = await getPayment(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const p = d.payment;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  const inbound = p.direction === "inbound";
  const canSubmit = p.status === "draft" && ctx.can("finance.payment_record.create");
  const canDecide = p.status === "submitted" && d.canApprove;
  const canRecord = p.status === "approved" && ctx.can("finance.payment_record.post") && !d.posterBlocked;
  const canCancel = ["draft", "submitted", "approved"].includes(p.status) && ctx.can("finance.payment_record.create");
  const canVoid = p.status === "recorded" && ctx.can("finance.payment_record.void");
  const done = p.status === "recorded" || p.status === "voided";
  return (
    <>
      <PageHeader
        title={d.counterpartyName}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {inbound ? "Money in" : "Money out"} · <RecordNo>{p.paymentNumber}</RecordNo> <FinanceStatus status={p.status} />
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/finance/payments" variant="secondary">
                All payments
              </LinkButton>
              {canCancel && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel only a payment typed by mistake. It is not in the books yet.</p>
                  <FinanceCommand entity="payment" id={p.id} command="cancel" label="Cancel the payment" reason variant="danger" />
                </div>
              )}
              {canVoid && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel (kept on record): what it paid is undone, so those invoices or bills are open again.</p>
                  <FinanceCommand entity="payment" id={p.id} command="void" label="Cancel (kept on record)" reason password variant="danger" confirm="Cancel this payment? It stays on record; the invoices or bills it paid are open again." />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one payment: {inbound ? "money a customer paid us" : "money we paid"}, and which invoices or bills it pays.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Payment saved.">Send it for approval; after approval finance saves it to the books.</Banner>
        </div>
      )}
      {canSubmit ? (
        <NextStep text="Next: send this payment for approval." action={{ label: "Send for approval", href: "#do" }} />
      ) : p.status === "draft" ? (
        <NextStep text="This payment is a draft." waitingFor="Waiting for finance to send it for approval." />
      ) : canDecide ? (
        <NextStep text="Next: approve this payment, or send it back with what to change." action={{ label: "Approve or send back", href: "#do" }} />
      ) : p.status === "submitted" ? (
        <NextStep text="This payment waits for approval." waitingFor={`${waitingText(d.progress)} The person who typed it cannot approve it.`} />
      ) : canRecord ? (
        <NextStep text="Next: save it to the books. Then the invoices or bills it pays are marked paid." action={{ label: "Save to the books", href: "#do" }} />
      ) : p.status === "approved" ? (
        <NextStep text="Approved." waitingFor={d.posterBlocked ? "You approved it, so another finance person saves it to the books (above the set amount)." : "Waiting for finance to save it to the books."} />
      ) : null}
      <div className="flex flex-col gap-4">
        {(canSubmit || canDecide || canRecord) && (
          <DoNow>
            {canSubmit && <FinanceCommand entity="payment" id={p.id} command="submit" label="Send for approval" variant="cta" />}
            {canDecide && (
              <>
                <FinanceCommand entity="payment" id={p.id} command="approve" label="Approve" note variant="cta" />
                <FinanceCommand entity="payment" id={p.id} command="return" label="Send back to change" reason />
              </>
            )}
            {canRecord && <FinanceCommand entity="payment" id={p.id} command="record" label="Save to the books" password variant="cta" hint="After this it cannot be changed. The day the money moved must be in a month that is not closed." />}
          </DoNow>
        )}
        <Card>
          <CardTitle action={<Money value={p.amount} className="text-[20px] font-semibold" />}>{done ? "What it paid" : "What it will pay"}</CardTitle>
          <p className="mb-2 text-[14px] text-fg-2">
            {fmtDate(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method}
          </p>
          {done ? (
            d.applications.length === 0 ? (
              <p className="text-[14px] text-fg-2">Nothing paid with it: the whole amount is kept for later (on their account).</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[14px]">
                {d.applications.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <Link className="text-primary-text hover:underline" href={a.documentHref}>
                      {a.documentNumber}
                      {a.reversalOfId ? " (undone)" : ""}
                    </Link>
                    <Money value={a.appliedAmount} className="font-medium" />
                  </li>
                ))}
              </ul>
            )
          ) : d.preview.length === 0 ? (
            <p className="text-[14px] text-fg-2">Nothing open for them right now: the payment would be kept for later (on their account).</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-line text-[14px]">
                {d.preview.map((a) => (
                  <li key={a.documentId} className="flex items-center justify-between gap-2 py-2">
                    <span className="font-mono text-[13px]">{a.number}</span>
                    <Money value={a.amount} className="font-medium" />
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[13px] text-muted">{p.applicationPlan?.length ? "Amounts chosen by hand." : "Oldest first; worked out again when it is saved to the books."}</p>
            </>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-3">
            <div>
              <dt className="text-muted">Used</dt>
              <dd className="font-medium"><Money value={p.appliedAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Kept for later</dt>
              <dd className="font-medium"><Money value={p.unapplied} /></dd>
            </div>
            {Number(p.withheldAmount) > 0 && (
              <div>
                <dt className="text-muted">Kept back for tax</dt>
                <dd className="font-medium"><Money value={p.withheldAmount} /></dd>
              </div>
            )}
          </dl>
        </Card>
        <MoreDetails title="Details, approvals and book entries">
          <Dl
            items={[
              ["Receipt or slip number", p.reference ?? "—"],
              ["Bank's reference", p.bankReference ?? "—"],
              ["Typed in by", name(p.createdBy)],
              ["Approved by", name(p.approvedBy)],
              ["Saved to the books", p.postedBy ? `${name(p.postedBy)} · ${fmtDateTime(p.postedAt)}` : "—"],
              ...(p.voidReason ? ([["Why cancelled", p.voidReason]] as [string, string][]) : []),
            ]}
          />
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </MoreDetails>
      </div>
    </>
  );
}
