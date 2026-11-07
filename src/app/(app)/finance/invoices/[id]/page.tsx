import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getInvoice, taxCodeOptionsFor } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NextStepBox } from "@/ui/next-step-box";
import { waitingFor } from "../../../waiting-for";
import { approvalWaiting } from "../../approval-waiting";
import { MoreMenu } from "@/ui/more-menu";
import { Banner } from "@/ui/status";
import { LineName } from "@/ui/line-name";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";
import { EditInvoiceDraft } from "../forms";

export const metadata = { title: "Invoice" };

/** One invoice: customer first, the next step by state, amounts in ₱, rare and cancel actions in ⋯ More. Posting rules unchanged. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="invoices" permission="finance.invoice.view" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getInvoice>>;
  try {
    d = await getInvoice(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const i = d.invoice;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  const posted = ["issued", "partially_paid", "paid", "closed", "voided"].includes(i.status) && !!i.invoiceNumber;
  const canEdit = i.status === "draft" && ctx.can("finance.invoice.edit");
  const taxOptions = canEdit ? await taxCodeOptionsFor(ctx, "sales") : [];
  const canSubmit = i.status === "draft" && ctx.can("finance.invoice.submit");
  const canDecide = i.status === "submitted" && d.canApprove;
  const canIssue = i.status === "approved" && ctx.can("finance.invoice.post") && !d.posterBlocked;
  const open = ["issued", "partially_paid"].includes(i.status);
  const canPay = open && ctx.can("finance.payment_record.create");
  const canCredit = open && ctx.can("finance.credit_note.create");
  const canCancel = ["draft", "submitted", "approved"].includes(i.status) && ctx.can("finance.invoice.create");
  const canVoid = i.status === "issued" && Number(i.paidAmount) === 0 && Number(i.creditedAmount) === 0 && ctx.can("finance.invoice.void");
  const payHref = `/finance/payments/new?counterparty=customer:${d.customer.id}&invoice=${i.id}`;
  // UX audit round 2 part 2: the form for the next step sits inside the one "What to do next" box.
  const doNow = (
    <>
        {canSubmit && <FinanceCommand entity="invoice" id={i.id} command="submit" label="Send for approval" variant="cta" />}
        {canDecide && (
          <>
            <FinanceCommand entity="invoice" id={i.id} command="approve" label="Approve" note variant="cta" />
            <FinanceCommand entity="invoice" id={i.id} command="return" label="Send back to change" reason />
          </>
        )}
        {canIssue && <FinanceCommand entity="invoice" id={i.id} command="issue" label="Save to the books" password variant="cta" hint="This gives the invoice its number and starts the customer's days to pay. After this it cannot be changed: a mistake is fixed with a credit (money back). Today's month must not be closed." />}
    </>
  );
  return (
    <>
      <RecordHeader
        back={{ href: "/finance/invoices", label: "Invoices" }}
        typeLabel="Invoice"
        reference={i.invoiceNumber ?? "No number yet"}
        title={d.customer.name}
        chip={
          <>
            <FinanceStatus status={i.status} />
            {i.overdue && <FinanceStatus status="overdue" />}
          </>
        }
        actions={
          <MoreMenu compact>
            <div className="flex flex-col gap-3">
              {posted && (
                <LinkButton href={`/print/invoice/${i.id}`} target="_blank" variant="secondary">
                  Print the invoice
                </LinkButton>
              )}
              {canCredit && (
                <LinkButton href={`/finance/credit-notes/new?invoiceId=${i.id}`} variant="secondary">
                  Give a credit (money back)
                </LinkButton>
              )}
              <LinkButton href="/finance/invoices" variant="secondary">
                All invoices
              </LinkButton>
              {canCancel && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel only an invoice made by mistake. It is not in the books yet.</p>
                  <FinanceCommand entity="invoice" id={i.id} command="cancel" label="Cancel the invoice" reason variant="danger" />
                </div>
              )}
              {canVoid && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel (kept on record): the invoice stays on record and a cancelling entry is saved to the books.</p>
                  <FinanceCommand entity="invoice" id={i.id} command="void" label="Cancel (kept on record)" reason password variant="danger" confirm="Cancel this invoice? It stays on record and a cancelling entry is saved to the books." />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one invoice: what the customer must pay us, by when, and what is already paid.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Invoice made from the delivery.">Check the items and tax, then send it for approval.</Banner>
        </div>
      )}
      {canSubmit ? (
        <NextStepBox text="Next: check the items and the tax, then send it for approval.">{doNow}</NextStepBox>
      ) : i.status === "draft" ? (
        <NextStep text="This invoice is a draft." waitingFor={await waitingFor(ctx, "finance.invoice.submit", i.siteId, "to send it for approval", "finance")} />
      ) : canDecide ? (
        <NextStepBox text="Next: approve this invoice, or send it back with what to change.">{doNow}</NextStepBox>
      ) : i.status === "submitted" ? (
        <NextStep text="This invoice waits for approval." waitingFor={`${(await approvalWaiting(ctx, "finance.invoice.approve", d.progress, { siteId: i.siteId, exclude: [i.createdBy, i.submittedBy], pendingSince: i.submittedAt }))} The person who made or sent it cannot approve it.`} />
      ) : canIssue ? (
        <NextStepBox text="Next: save it to the books. It gets its number and the customer's days to pay start.">{doNow}</NextStepBox>
      ) : i.status === "approved" ? (
        <NextStep text="Approved." waitingFor={d.posterBlocked ? "You approved it, so another finance person saves it to the books (above the set amount)." : await waitingFor(ctx, "finance.invoice.post", i.siteId, "to save it to the books", "finance", { exclude: [...(d.progress && !d.progress.posterMayEqualApprover ? d.progress.approvers : [])], operational: true })} />
      ) : canPay ? (
        <NextStep text={`Next: when ${d.customer.name} pays, save the payment here.${i.overdue ? " This invoice is late." : ""}`} action={{ label: "Record a payment", href: payHref }} />
      ) : open ? (
        <NextStep text="Sent to the customer." waitingFor={`Waiting for ${d.customer.name} to pay by ${fmtDate(i.dueDate)}.`} />
      ) : (
        <NextStep text={i.status === "paid" || i.status === "closed" ? "Paid in full. Nothing more to do." : i.status === "voided" ? "Cancelled (kept on record). Nothing more to do." : "Cancelled before it was saved to the books. Nothing more to do."} />
      )}

      <div className="flex flex-col gap-4">

        <Card>
          <CardTitle action={<Money value={i.totalAmount} className="text-value" />}>What the customer pays</CardTitle>
          <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
            {d.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <LineName description={l.description} className="block font-medium" />
                  <span className="text-[13px] text-fg-2">
                    {fmtQty(l.qty, l.uom, 0)} × <Money value={l.unitAmount} />
                    {l.taxCode ? ` · tax ${Number(l.taxRatePct)} %` : ""}
                  </span>
                </span>
                <Money value={l.totalAmount} className="shrink-0 font-semibold" />
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] sm:grid-cols-4">
            <div>
              <dt className="text-muted">Before tax</dt>
              <dd className="font-medium"><Money value={i.subtotalAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Tax</dt>
              <dd className="font-medium"><Money value={i.taxAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Paid so far</dt>
              <dd className="font-medium"><Money value={i.paidAmount} /></dd>
            </div>
            <div>
              <dt className="text-muted">Still to pay</dt>
              <dd className="font-semibold"><Money value={i.openAmount} /></dd>
            </div>
          </dl>
          <p className="mt-2 text-[14px] text-fg-2">{i.dueDate ? `Due ${fmtDate(i.dueDate)}` : "The due date is set when it is saved to the books."}{i.paymentTermsDays ? ` (${i.paymentTermsDays} days to pay)` : i.paymentTermsDays === 0 ? " (pay on delivery)" : ""}</p>
          {canEdit && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] text-primary-text">Change the tax or the note</summary>
              <EditInvoiceDraft id={i.id} notes={i.notes} taxCode={d.lines[0]?.taxCode ?? null} options={taxOptions} />
            </details>
          )}
        </Card>

        {(d.applications.length > 0 || d.credits.length > 0) && (
          <Card>
            <CardTitle>Payments and credits</CardTitle>
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {d.applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <Link className="text-primary-text hover:underline" href={`/finance/payments/${a.paymentRecordId}`}>
                    Payment {fmtDate(a.appliedOn)}
                    {a.reversalOfId ? " (cancelled)" : ""} <span className="font-mono text-[12px] text-muted">{a.paymentNumber}</span>
                  </Link>
                  <Money value={a.appliedAmount} className="font-medium" />
                </li>
              ))}
              {d.credits.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link className="text-primary-text hover:underline" href={`/finance/credit-notes/${c.id}`}>
                    Credit (money back) <span className="font-mono text-[12px] text-muted">{c.creditNoteNumber ?? "draft"}</span>
                  </Link>
                  <span className="inline-flex items-center gap-2">
                    <FinanceStatus status={c.status} /> <Money value={c.amount} className="font-medium" />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <MoreDetails title="Details, approvals and book entries">
          <Dl
            items={[
              ["Customer", d.customer.name],
              ["Bill to", i.billToText ?? "—"],
              ["Customer order", ctx.can("sales.sales_order.view") ? <Link key="o" className="text-primary-text hover:underline" href={`/sales/${d.order.id}`}>{d.order.orderNumber}</Link> : d.order.orderNumber],
              ["Delivery", d.shipment.number ?? "—"],
              ["Customer's own order number", i.customerPoNumber ?? "—"],
              ["Sent on", fmtDate(i.issueDate)],
              ["Credited", <Money key="c" value={i.creditedAmount} />],
              ["Made by", name(i.createdBy)],
              ["Approved by", name(i.approvedBy)],
              ["Saved to the books by", i.postedBy ? `${name(i.postedBy)} · ${fmtDateTime(i.postedAt)}` : "—"],
              ...(i.voidReason ? ([["Why cancelled", i.voidReason]] as [string, string][]) : []),
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
