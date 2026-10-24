import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getQuote, manilaToday } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { MaskedNote, Money, SalesStatus } from "../../orders/sales-ui";
import { ConvertQuoteForm, QuoteCommand } from "./commands";

export const metadata = { title: "Quotation" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.view")) return <Forbidden what="quotations" />;
  const { id } = await params;
  const { saved } = await searchParams;
  let d: Awaited<ReturnType<typeof getQuote>>;
  try {
    d = await getQuote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const q = d.quote;
  const today = manilaToday();
  const mine = q.createdBy === ctx.userId || q.submittedBy === ctx.userId;
  return (
    <>
      <PageHeader
        title={q.quoteNumber}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SalesStatus status={q.status} />
            <span>{d.customer.name}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href="/sales/quotations" variant="secondary">All quotations</LinkButton>
            {["sent", "accepted", "converted"].includes(q.status) && (
              <LinkButton href={`/print/quotation/${q.id}`} target="_blank" variant="secondary">
                Print quotation
              </LinkButton>
            )}
          </>
        }
      />
      {saved && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Quotation saved as a draft. Submit it to issue it." />
        </div>
      )}
      {d.expiredByDate && ["sent", "accepted"].includes(q.status) && (
        <div className="mb-4">
          <Banner tone="warn" title={`Validity ended on ${fmtDate(q.validUntil)}`}>It will be marked expired by the nightly job and can no longer be converted.</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Lines</CardTitle>
            <Table head={["#", "SKU", "Product", "Qty", "List", "Price", "Discount", "Value"]}>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td className="font-medium">{l.sku}</Td>
                  <Td>{l.productName}</Td>
                  <Td>{fmtQty(l.qtyUnits, "pcs", 0)}</Td>
                  <Td>
                    <Money value={l.listUnitAmount} />
                  </Td>
                  <Td>
                    <Money value={l.unitAmount} />
                  </Td>
                  <Td>{l.discountPct === undefined ? "—" : `${Number(l.discountPct).toFixed(1)} %`}</Td>
                  <Td className="font-medium">
                    <Money value={l.value} />
                  </Td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <Td colSpan={7}>Total{q.taxAmount && q.taxAmount !== "0.0000" ? " (incl. tax)" : ""}</Td>
                <Td>
                  <Money value={q.totalAmount} />
                </Td>
              </tr>
            </Table>
            <MaskedNote fields={q._masked} />
          </Card>
          {(q.notesCustomer || q.notesInternal) && (
            <Card>
              <CardTitle>Notes</CardTitle>
              {q.notesCustomer && <p className="text-[13px]">{q.notesCustomer}</p>}
              {q.notesInternal && <p className="mt-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-fg-2">Internal: {q.notesInternal}</p>}
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["Customer", ctx.can("masterdata.customer.view") ? <Link key="c" className="text-primary-text hover:underline" href={`/sales/customers/${d.customer.id}`}>{d.customer.name}</Link> : d.customer.name],
                ["Ship to", d.shipTo?.text ?? d.customer.shipToAddress],
                ["Valid until", fmtDate(q.validUntil)],
                ["Prepared by", q.createdByName ?? "—"],
                ["Issued", q.sentAt ? fmtDateTime(q.sentAt) : "—"],
                ...(d.order ? ([["Sales order", <Link key="o" className="text-primary-text hover:underline" href={`/sales/${d.order.id}`}>{d.order.orderNumber}</Link>]] as [string, React.ReactNode][]) : []),
                ...(q.decisionReason ? ([["Reason", q.decisionReason]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {q.status === "draft" && ctx.can("sales.quote.submit") && <QuoteCommand quoteId={q.id} command="submit" label="Submit quotation" variant="cta" />}
              {q.status === "draft" && ctx.can("sales.quote.edit") && (
                <LinkButton href={`/sales/quotations/${q.id}/edit`} variant="secondary">
                  Edit draft
                </LinkButton>
              )}
              {q.status === "pending_approval" && (
                <>
                  <Banner tone="warn" title="Discount needs approval">
                    {d.approval?.next ? `Waiting for step ${d.approval.next.step}: ${d.approval.next.label}.` : "Waiting for the approver."}
                  </Banner>
                  {d.approval?.canApprove ? (
                    <>
                      <QuoteCommand quoteId={q.id} command="approve" label="Approve discount" note variant="cta" />
                      <QuoteCommand quoteId={q.id} command="return" label="Return to draft" reason />
                    </>
                  ) : (
                    <p className="text-[13px] text-muted">{mine ? "You prepared this quotation, so another person approves it." : "Only the approver of this step can decide."}</p>
                  )}
                </>
              )}
              {q.status === "sent" && ctx.can("sales.quote.edit") && (
                <>
                  {ctx.can("sales.sales_order.create") && !d.expiredByDate && <ConvertQuoteForm quoteId={q.id} today={today} />}
                  <QuoteCommand quoteId={q.id} command="accept" label="Customer accepted" />
                  <QuoteCommand quoteId={q.id} command="reject" label="Customer declined" reason />
                </>
              )}
              {q.status === "accepted" && ctx.can("sales.sales_order.create") && !d.expiredByDate && <ConvertQuoteForm quoteId={q.id} today={today} />}
              {["draft", "pending_approval", "sent", "accepted"].includes(q.status) && ctx.can("sales.quote.void") && <QuoteCommand quoteId={q.id} command="void" label="Void quotation" reason variant="danger" />}
              {["rejected", "expired", "converted", "voided"].includes(q.status) && <p className="text-[13px] text-muted">This quotation is closed.</p>}
            </div>
          </Card>
          {d.decisions.length > 0 && (
            <Card>
              <CardTitle>Approval decisions</CardTitle>
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.decisions.map((x) => (
                  <li key={x.id}>
                    Step {x.step}: {x.decision} by {x.decidedByName} · {fmtDateTime(x.decidedAt)}
                    {x.note ? ` · ${x.note}` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
