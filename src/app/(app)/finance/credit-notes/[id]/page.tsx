import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCreditNote } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";

export const metadata = { title: "Credit note" };

export default async function CreditNotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.view")) return <Forbidden what="credit notes" />;
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
  return (
    <>
      <PageHeader
        title={c.creditNoteNumber ? `Credit note ${c.creditNoteNumber}` : "Credit note draft"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <FinanceStatus status={c.status} />
            <span>{d.customer.name}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href="/finance/credit-notes" variant="secondary">
              All credit notes
            </LinkButton>
            {c.creditNoteNumber && (
              <LinkButton href={`/print/credit-note/${c.id}`} target="_blank" variant="secondary">
                Print credit note
              </LinkButton>
            )}
          </>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Credit note draft saved.">Submit it for approval; finance issues it after approval.</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Credit</CardTitle>
            <Dl
              items={[
                ["Invoice", <Link key="i" className="text-primary-text hover:underline" href={`/finance/invoices/${d.invoice.id}`}>{d.invoice.invoiceNumber}</Link>],
                ["Reason", d.reasonLabel],
                ["Explanation", c.reason],
                ["Amount", <Money key="a" value={c.amount} />],
                ["of which tax", <Money key="t" value={c.taxAmount} />],
                ["Full void", c.voidsInvoice ? "Yes: voids the invoice" : "No"],
                ["Customer return", d.customerReturn ? <Link key="r" className="text-primary-text hover:underline" href={`/sales/returns/${d.customerReturn.id}`}>{d.customerReturn.number}</Link> : "—"],
                ["Invoice open now", <Money key="o" value={d.invoice.openAmount} />],
                ["Issued", fmtDate(c.issueDate)],
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
              {c.status === "draft" && ctx.can("finance.credit_note.submit") && <FinanceCommand entity="credit_note" id={c.id} command="submit" label="Submit for approval" variant="cta" />}
              {c.status === "submitted" &&
                (d.canApprove ? (
                  <>
                    <FinanceCommand entity="credit_note" id={c.id} command="approve" label="Approve credit" note variant="cta" />
                    <FinanceCommand entity="credit_note" id={c.id} command="return" label="Return to draft" reason />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{d.progress?.next ? `Waiting for step ${d.progress.next.step}: ${d.progress.next.label}.` : "Waiting for approval."}</p>
                ))}
              {c.status === "approved" &&
                ctx.can("finance.credit_note.post") &&
                (d.posterBlocked ? (
                  <p className="text-[13px] text-muted">You approved this credit; above the threshold another finance person issues it.</p>
                ) : (
                  <FinanceCommand entity="credit_note" id={c.id} command="issue" label="Issue and apply" password variant="cta" hint="Issuing posts the credit (immutable), numbers it and applies it to the invoice." />
                ))}
              {["draft", "submitted", "approved"].includes(c.status) && ctx.can("finance.credit_note.create") && <FinanceCommand entity="credit_note" id={c.id} command="cancel" label="Cancel" reason variant="danger" />}
              {["issued", "applied"].includes(c.status) && !c.voidsInvoice && ctx.can("finance.credit_note.void") && (
                <FinanceCommand entity="credit_note" id={c.id} command="void" label="Void credit (reversal)" reason password variant="danger" confirm="Void this credit note? The invoice's open amount comes back." />
              )}
              {["voided", "cancelled"].includes(c.status) || (c.status === "applied" && c.voidsInvoice) ? <p className="text-[13px] text-muted">Nothing left to do on this credit note.</p> : null}
            </div>
            <p className="mt-3 text-[12px] text-muted">
              Prepared by {name(c.createdBy)}
              {c.postedBy ? ` · issued by ${name(c.postedBy)} on ${fmtDateTime(c.postedAt)}` : ""}
            </p>
          </Card>
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
        </div>
      </div>
    </>
  );
}
