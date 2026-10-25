import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { PAYMENT_METHOD_LABEL, getPayment } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";

export const metadata = { title: "Payment" };

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
  return (
    <>
      <PageHeader
        title={`Payment ${p.paymentNumber}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <FinanceStatus status={p.status} />
            <span>
              {p.direction === "inbound" ? "Money in from" : "Money out to"} {d.counterpartyName}
            </span>
          </span>
        }
        actions={
          <LinkButton href="/finance/payments" variant="secondary">
            All payments
          </LinkButton>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Payment draft saved.">Submit it for approval; finance records it after approval.</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>{p.status === "recorded" || p.status === "voided" ? "Applications" : "Will apply to"}</CardTitle>
            {p.status === "recorded" || p.status === "voided" ? (
              d.applications.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing applied: the whole amount is on account.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {d.applications.map((a) => (
                    <li key={a.id}>
                      <Link className="text-primary-text hover:underline" href={a.documentHref}>
                        {a.documentNumber}
                      </Link>{" "}
                      · {fmtDate(a.appliedOn)} · <Money value={a.appliedAmount} />
                      {a.reversalOfId ? " (reversed)" : ""}
                    </li>
                  ))}
                </ul>
              )
            ) : d.preview.length === 0 ? (
              <p className="text-[13px] text-muted">No open documents at the moment: the payment would stay on account.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {d.preview.map((a) => (
                  <li key={a.documentId}>
                    {a.number} · <Money value={a.amount} />
                  </li>
                ))}
                <li className="text-muted">{p.applicationPlan?.length ? "Chosen amounts." : "Oldest due first, worked out again when it is recorded."}</li>
              </ul>
            )}
          </Card>
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["Paid on", fmtDate(p.paidOn)],
                ["Method", PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method],
                ["Amount", <Money key="a" value={p.amount} />],
                ["Withheld", <Money key="w" value={p.withheldAmount} />],
                ["Applied", <Money key="ap" value={p.appliedAmount} />],
                ["On account", <Money key="u" value={p.unapplied} />],
                ["Reference", p.reference ?? "—"],
                ["Bank reference", p.bankReference ?? "—"],
                ["Entered by", name(p.createdBy)],
                ["Approved by", name(p.approvedBy)],
                ["Recorded", p.postedBy ? `${name(p.postedBy)} · ${fmtDateTime(p.postedAt)}` : "—"],
                ...(p.voidReason ? ([["Void reason", p.voidReason]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {p.status === "draft" && ctx.can("finance.payment_record.create") && <FinanceCommand entity="payment" id={p.id} command="submit" label="Submit for approval" variant="cta" />}
              {p.status === "submitted" &&
                (d.canApprove ? (
                  <>
                    <FinanceCommand entity="payment" id={p.id} command="approve" label="Approve payment" note variant="cta" />
                    <FinanceCommand entity="payment" id={p.id} command="return" label="Return to draft" reason />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{d.progress?.next ? `Waiting for step ${d.progress.next.step}: ${d.progress.next.label}.` : "Waiting for approval."} The person who entered it cannot approve it.</p>
                ))}
              {p.status === "approved" &&
                ctx.can("finance.payment_record.post") &&
                (d.posterBlocked ? (
                  <p className="text-[13px] text-muted">You approved this payment; above the threshold another finance person records it.</p>
                ) : (
                  <FinanceCommand entity="payment" id={p.id} command="record" label="Record payment" password variant="cta" hint="Recording posts the payment (immutable) and its applications. The paid-on date must be in an open period." />
                ))}
              {["draft", "submitted", "approved"].includes(p.status) && ctx.can("finance.payment_record.create") && <FinanceCommand entity="payment" id={p.id} command="cancel" label="Cancel" reason variant="danger" />}
              {p.status === "recorded" && ctx.can("finance.payment_record.void") && (
                <FinanceCommand entity="payment" id={p.id} command="void" label="Void payment (reversal)" reason password variant="danger" confirm="Void this payment? Its applications are reversed and the documents reopen." />
              )}
              {["voided", "cancelled", "reconciled"].includes(p.status) && <p className="text-[13px] text-muted">Nothing left to do on this payment.</p>}
            </div>
          </Card>
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
        </div>
      </div>
    </>
  );
}
