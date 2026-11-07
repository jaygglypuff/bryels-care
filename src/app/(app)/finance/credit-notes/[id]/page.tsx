import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCreditNote } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { NextStepBox } from "@/ui/next-step-box";
import { waitingFor } from "../../../waiting-for";
import { approvalWaiting } from "../../approval-waiting";
import { MoreMenu } from "@/ui/more-menu";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";

export const metadata = { title: "Credit (money back)" };

/** One credit (money back) on an invoice: next step by state; cancel and "cancel (kept on record)" in ⋯ More. Posting rules unchanged. */
export default async function CreditNotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.view")) return <Forbidden what="credits (money back)" permission="finance.credit_note.view" />;
  const { id } = await params;
  const { created } = await searchParams;
  let d: Awaited<ReturnType<typeof getCreditNote>>;
  try {
    d = await getCreditNote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const c = d.creditNote;
  const name = (u: string | null) => (u ? d.names[u] ?? "—" : "—");
  const canSubmit = c.status === "draft" && ctx.can("finance.credit_note.submit");
  const canDecide = c.status === "submitted" && d.canApprove;
  const canIssue = c.status === "approved" && ctx.can("finance.credit_note.post") && !d.posterBlocked;
  const canCancel = ["draft", "submitted", "approved"].includes(c.status) && ctx.can("finance.credit_note.create");
  const canVoid = ["issued", "applied"].includes(c.status) && !c.voidsInvoice && ctx.can("finance.credit_note.void");
  // UX audit round 2 part 2: the form for the next step sits inside the one "What to do next" box.
  const doNow = (
    <>
        {canSubmit && <FinanceCommand entity="credit_note" id={c.id} command="submit" label="Send for approval" variant="cta" />}
        {canDecide && (
          <>
            <FinanceCommand entity="credit_note" id={c.id} command="approve" label="Approve" note variant="cta" />
            <FinanceCommand entity="credit_note" id={c.id} command="return" label="Send back to change" reason />
          </>
        )}
        {canIssue && <FinanceCommand entity="credit_note" id={c.id} command="issue" label="Save to the books" password variant="cta" hint="This numbers the credit and takes it off the invoice. After this it cannot be changed." />}
    </>
  );
  return (
    <>
      <RecordHeader
        back={{ href: "/finance/credit-notes", label: "Credits (money back)" }}
        typeLabel="Credit (money back)"
        reference={c.creditNoteNumber ?? "No number yet"}
        title={d.customer.name}
        chip={<FinanceStatus status={c.status} />}
        actions={
          <MoreMenu compact>
            <div className="flex flex-col gap-3">
              {c.creditNoteNumber && (
                <LinkButton href={`/print/credit-note/${c.id}`} target="_blank" variant="secondary">
                  Print the credit
                </LinkButton>
              )}
              <LinkButton href="/finance/credit-notes" variant="secondary">
                All credits
              </LinkButton>
              {canCancel && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel only a credit made by mistake. It is not in the books yet.</p>
                  <FinanceCommand entity="credit_note" id={c.id} command="cancel" label="Cancel the credit" reason variant="danger" />
                </div>
              )}
              {canVoid && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel (kept on record): the customer owes the amount again.</p>
                  <FinanceCommand entity="credit_note" id={c.id} command="void" label="Cancel (kept on record)" reason password variant="danger" confirm="Cancel this credit? It stays on record and the invoice's amount to pay comes back." />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one credit (money back): how much we take off the customer&apos;s invoice, and why.</PageIntro>
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Credit saved.">Send it for approval; after approval finance saves it to the books.</Banner>
        </div>
      )}
      {canSubmit ? (
        <NextStepBox text="Next: send this credit for approval.">{doNow}</NextStepBox>
      ) : c.status === "draft" ? (
        <NextStep text="This credit is a draft." waitingFor={await waitingFor(ctx, "finance.credit_note.submit", c.siteId, "to send it for approval", "finance")} />
      ) : canDecide ? (
        <NextStepBox text="Next: approve this credit, or send it back with what to change.">{doNow}</NextStepBox>
      ) : c.status === "submitted" ? (
        <NextStep text="This credit waits for approval." waitingFor={(await approvalWaiting(ctx, "finance.credit_note.approve", d.progress, { siteId: c.siteId, exclude: [c.createdBy, c.submittedBy], pendingSince: c.submittedAt }))} />
      ) : canIssue ? (
        <NextStepBox text="Next: save it to the books. It gets its number and is taken off the invoice.">{doNow}</NextStepBox>
      ) : c.status === "approved" ? (
        <NextStep text="Approved." waitingFor={d.posterBlocked ? "You approved it, so another finance person saves it to the books (above the set amount)." : await waitingFor(ctx, "finance.credit_note.post", c.siteId, "to save it to the books", "finance", { exclude: [...(d.progress && !d.progress.posterMayEqualApprover ? d.progress.approvers : [])], operational: true })} />
      ) : (
        <NextStep text={c.status === "issued" || c.status === "applied" ? "Saved to the books and taken off the invoice. Nothing more to do." : c.status === "voided" ? "Cancelled (kept on record). Nothing more to do." : "Cancelled before it was saved to the books. Nothing more to do."} />
      )}
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle action={<Money value={c.amount} className="text-value" />}>Money back</CardTitle>
          <Dl
            items={[
              ["On invoice", <Link key="i" className="text-primary-text hover:underline" href={`/finance/invoices/${d.invoice.id}`}>{d.invoice.invoiceNumber}</Link>],
              ["Why", `${d.reasonLabel} — ${c.reason}`],
              ["Tax in it", <Money key="t" value={c.taxAmount} />],
              ["Whole invoice", c.voidsInvoice ? "Yes: the invoice is cancelled (kept on record)" : "No"],
              ["Goods sent back", d.customerReturn ? <Link key="r" className="text-primary-text hover:underline" href={`/sales/returns/${d.customerReturn.id}`}>{d.customerReturn.number}</Link> : "—"],
              ["Customer still owes on the invoice", <Money key="o" value={d.invoice.openAmount} />],
            ]}
          />
        </Card>
        <MoreDetails title="Details, approvals and book entries">
          <Dl items={[["Made by", name(c.createdBy)], ["Saved to the books", c.postedBy ? `${name(c.postedBy)} · ${fmtDateTime(c.postedAt)}` : "—"], ["Date", fmtDate(c.issueDate)]]} />
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </MoreDetails>
      </div>
    </>
  );
}
