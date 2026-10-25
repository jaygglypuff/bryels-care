import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getInvoice, taxCodeOptionsFor } from "@/modules/finance";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { FinanceCommand } from "../../commands";
import { ApprovalCard, FinanceStatus, HistoryCard, Money, PostingsCard } from "../../finance-ui";
import { EditInvoiceDraft } from "../forms";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="invoices" />;
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
  const taxOptions = i.status === "draft" && ctx.can("finance.invoice.edit") ? await taxCodeOptionsFor(ctx, "sales") : [];
  return (
    <>
      <PageHeader
        title={i.invoiceNumber ? `Invoice ${i.invoiceNumber}` : "Invoice draft"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <FinanceStatus status={i.status} />
            {i.overdue && <FinanceStatus status="overdue" />}
            <span>{d.customer.name}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href="/finance/invoices" variant="secondary">
              All invoices
            </LinkButton>
            {posted && (
              <LinkButton href={`/print/invoice/${i.id}`} target="_blank" variant="secondary">
                Print invoice
              </LinkButton>
            )}
          </>
        }
      />
      {created && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Invoice draft created from the shipment.">Check the lines and tax, then submit it for approval.</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Lines</CardTitle>
            <Table head={["#", "Item", "Qty", "Unit price", "Tax", "Amount"]}>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td>{l.description}</Td>
                  <Td>{fmtQty(l.qty, l.uom, 0)}</Td>
                  <Td>
                    <Money value={l.unitAmount} />
                  </Td>
                  <Td>{l.taxCode ? `${l.taxCode} ${Number(l.taxRatePct)} %` : "—"}</Td>
                  <Td className="font-medium">
                    <Money value={l.totalAmount} />
                  </Td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <Td colSpan={5}>Subtotal</Td>
                <Td>
                  <Money value={i.subtotalAmount} />
                </Td>
              </tr>
              <tr className="bg-surface-2">
                <Td colSpan={5}>Tax (reviewed configuration)</Td>
                <Td>
                  <Money value={i.taxAmount} />
                </Td>
              </tr>
              <tr className="bg-surface-2 font-semibold">
                <Td colSpan={5}>Total ({i.currency})</Td>
                <Td>
                  <Money value={i.totalAmount} />
                </Td>
              </tr>
            </Table>
          </Card>
          {(d.applications.length > 0 || d.credits.length > 0) && (
            <Card>
              <CardTitle>Payments and credits</CardTitle>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {d.applications.map((a) => (
                  <li key={a.id}>
                    <Link className="text-primary-text hover:underline" href={`/finance/payments/${a.paymentRecordId}`}>
                      {a.paymentNumber}
                    </Link>{" "}
                    · {fmtDate(a.appliedOn)} · <Money value={a.appliedAmount} />
                    {a.reversalOfId ? " (reversal)" : ""}
                  </li>
                ))}
                {d.credits.map((c) => (
                  <li key={c.id}>
                    <Link className="text-primary-text hover:underline" href={`/finance/credit-notes/${c.id}`}>
                      {c.creditNoteNumber ?? "Credit note draft"}
                    </Link>{" "}
                    · <FinanceStatus status={c.status} /> · <Money value={c.amount} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <PostingsCard postings={d.postings} />
          <HistoryCard history={d.history} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["Customer", d.customer.name],
                ["Bill to", i.billToText ?? "—"],
                ["Order", ctx.can("sales.sales_order.view") ? <Link key="o" className="text-primary-text hover:underline" href={`/sales/${d.order.id}`}>{d.order.orderNumber}</Link> : d.order.orderNumber],
                ["Shipment", d.shipment.number ?? "—"],
                ["Customer PO", i.customerPoNumber ?? "—"],
                ["Issued", fmtDate(i.issueDate)],
                ["Due", fmtDate(i.dueDate)],
                ["Terms", i.paymentTermsDays === null ? "—" : `${i.paymentTermsDays} days`],
                ["Paid", <Money key="p" value={i.paidAmount} />],
                ["Credited", <Money key="c" value={i.creditedAmount} />],
                ["Open", <Money key="op" value={i.openAmount} />],
                ["Prepared by", name(i.createdBy)],
                ["Approved by", name(i.approvedBy)],
                ["Issued by", i.postedBy ? `${name(i.postedBy)} · ${fmtDateTime(i.postedAt)}` : "—"],
                ...(i.voidReason ? ([["Void reason", i.voidReason]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {i.status === "draft" && ctx.can("finance.invoice.edit") && <EditInvoiceDraft id={i.id} notes={i.notes} taxCode={d.lines[0]?.taxCode ?? null} options={taxOptions} />}
              {i.status === "draft" && ctx.can("finance.invoice.submit") && <FinanceCommand entity="invoice" id={i.id} command="submit" label="Submit for approval" variant="cta" />}
              {i.status === "submitted" &&
                (d.canApprove ? (
                  <>
                    <FinanceCommand entity="invoice" id={i.id} command="approve" label="Approve invoice" note variant="cta" />
                    <FinanceCommand entity="invoice" id={i.id} command="return" label="Return to draft" reason />
                  </>
                ) : (
                  <p className="text-[13px] text-muted">{d.progress?.next ? `Waiting for step ${d.progress.next.step}: ${d.progress.next.label}.` : "Waiting for approval."} The person who prepared or submitted it cannot approve it.</p>
                ))}
              {i.status === "approved" &&
                ctx.can("finance.invoice.post") &&
                (d.posterBlocked ? (
                  <p className="text-[13px] text-muted">You approved this invoice; above the threshold another finance person issues it.</p>
                ) : (
                  <FinanceCommand entity="invoice" id={i.id} command="issue" label="Issue invoice" password variant="cta" hint="Issuing posts the invoice (immutable), allocates its number and starts the payment terms. The period of today must be open." />
                ))}
              {i.status === "approved" && !ctx.can("finance.invoice.post") && <p className="text-[13px] text-muted">Approved. Finance issues it.</p>}
              {["draft", "submitted", "approved"].includes(i.status) && ctx.can("finance.invoice.create") && <FinanceCommand entity="invoice" id={i.id} command="cancel" label="Cancel invoice" reason variant="danger" />}
              {["issued", "partially_paid"].includes(i.status) && ctx.can("finance.credit_note.create") && (
                <LinkButton href={`/finance/credit-notes/new?invoiceId=${i.id}`} variant="secondary">
                  Create credit note
                </LinkButton>
              )}
              {["issued", "partially_paid"].includes(i.status) && ctx.can("finance.payment_record.create") && (
                <LinkButton href={`/finance/payments/new?counterparty=customer:${d.customer.id}`} variant="secondary">
                  Record a payment
                </LinkButton>
              )}
              {i.status === "issued" && Number(i.paidAmount) === 0 && Number(i.creditedAmount) === 0 && ctx.can("finance.invoice.void") && (
                <FinanceCommand entity="invoice" id={i.id} command="void" label="Void invoice (reversal)" reason password variant="danger" confirm="Void this invoice? A reversal posting is written; the invoice itself stays on record." />
              )}
              {["paid", "closed", "voided", "cancelled"].includes(i.status) && <p className="text-[13px] text-muted">Nothing left to do on this invoice.</p>}
            </div>
          </Card>
          <ApprovalCard progress={d.progress} decisions={d.decisions} />
        </div>
      </div>
    </>
  );
}
