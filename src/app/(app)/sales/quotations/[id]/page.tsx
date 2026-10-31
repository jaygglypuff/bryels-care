import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getQuote, manilaToday } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { MaskedNote, Money, SalesStatus } from "../../orders/sales-ui";
import { ConvertQuoteForm, QuoteCommand } from "./commands";
import { DeleteDraftButton } from "../../../delete-draft-button";
import { DoNext, whoDoes } from "../../next-step";

export const metadata = { title: "Price offer" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.view")) return <Forbidden what="price offers" />;
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
  const canEdit = ctx.can("sales.quote.edit");
  const canConvert = ctx.can("sales.sales_order.create") && !d.expiredByDate;
  const open = ["draft", "pending_approval", "sent", "accepted"].includes(q.status);
  const canVoid = open && ctx.can("sales.quote.void");
  const canDelete = q.status === "draft" && (canEdit || ctx.can("sales.quote.create"));

  const next =
    q.status === "draft" ? (
      ctx.can("sales.quote.submit") ? (
        <DoNext text="Next: send the price offer. A big discount goes to the approver first.">
          <QuoteCommand quoteId={q.id} command="submit" label="Send the price offer" variant="cta" />
        </DoNext>
      ) : (
        <DoNext text="This price offer is a draft." waitingFor="Waiting for sales to send it." />
      )
    ) : q.status === "pending_approval" ? (
      d.approval?.canApprove ? (
        <DoNext text={mine ? "Next: approve your own discount (recorded as your own request), or send it back." : "Next: approve the discount, or send it back."} action={{ label: "Approve now", href: "#approve" }} />
      ) : (
        <DoNext
          text={mine ? "You made this offer, so someone else approves the discount." : "The discount needs approval."}
          waitingFor={`Waiting for ${await whoDoes(ctx, "sales.quote.approve", q.siteId, "the approver")} to approve.`}
        />
      )
    ) : (q.status === "sent" || q.status === "accepted") && canConvert && (q.status === "accepted" || canEdit) ? (
      <DoNext text="Next: when the customer says yes, make it an order." action={{ label: "Make it an order", href: "#convert" }} />
    ) : q.status === "sent" || q.status === "accepted" ? (
      <DoNext text={d.expiredByDate ? `This offer was good until ${fmtDate(q.validUntil)}. Make a new one.` : "Sent to the customer."} waitingFor={d.expiredByDate ? undefined : "Waiting for the customer's answer."} />
    ) : q.status === "converted" && d.order ? (
      <DoNext text="This offer is now an order." action={{ label: "Open the order", href: `/sales/${d.order.id}` }} />
    ) : (
      <DoNext text="This price offer is closed. Nothing more to do." />
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Price offer for ${d.customer.name}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/sales/quotations" className="text-primary-text hover:underline">Price offers</Link>
            <RecordNo>{q.quoteNumber}</RecordNo>
            <SalesStatus status={q.status} />
          </span>
        }
        actions={
          <>
            {["sent", "accepted", "converted"].includes(q.status) && (
              <LinkButton href={`/print/quotation/${q.id}`} target="_blank" variant="secondary">
                Print
              </LinkButton>
            )}
            {(q.status === "draft" && canEdit) || canVoid || canDelete || (q.status === "sent" && canEdit) ? (
              <MoreMenu>
                <div className="flex flex-col gap-3">
                  {q.status === "draft" && canEdit && <LinkButton href={`/sales/quotations/${q.id}/edit`} variant="secondary">Change the draft</LinkButton>}
                  {q.status === "sent" && canEdit && <QuoteCommand quoteId={q.id} command="accept" label="Customer said yes (order later)" />}
                  {q.status === "sent" && canEdit && <QuoteCommand quoteId={q.id} command="reject" label="Customer said no" reason />}
                  {canVoid && <QuoteCommand quoteId={q.id} command="void" label="Cancel this price offer" reason variant="danger" />}
                  {canDelete && <DeleteDraftButton kind="quote" id={q.id} what="this draft price offer" />}
                </div>
              </MoreMenu>
            ) : null}
          </>
        }
      />
      <PageIntro>This screen is for one price offer: the prices we promised {d.customer.name}, until when, and the next step.</PageIntro>
      {saved && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Price offer saved as a draft. Send it when it is ready." />
        </div>
      )}
      {d.expiredByDate && ["sent", "accepted"].includes(q.status) && (
        <div className="mb-4">
          <Banner tone="warn" title={`Good until ${fmtDate(q.validUntil)}: too old now`}>It will be marked too old tonight and can no longer become an order.</Banner>
        </div>
      )}
      {next}

      <div className="flex flex-col gap-4">
        {q.status === "pending_approval" && (
          <Card>
            <span id="approve" className="block scroll-mt-24" />
            <CardTitle>Discount approval</CardTitle>
            <div className="flex flex-col gap-3">
              <Banner tone="warn" title="The discount needs approval">
                {d.approval?.next ? `Step ${d.approval.next.step}: ${d.approval.next.label}.` : "Waiting for the approver."}
              </Banner>
              {d.approval?.canApprove ? (
                <>
                  <QuoteCommand quoteId={q.id} command="approve" label="Approve discount" note variant="cta" />
                  <QuoteCommand quoteId={q.id} command="return" label="Send back to draft" reason />
                </>
              ) : (
                <p className="text-[13px] text-muted">{mine ? "You made this offer, so another person approves it." : "Only the approver of this step can decide."}</p>
              )}
            </div>
          </Card>
        )}

        {(q.status === "sent" || q.status === "accepted") && canConvert && (q.status === "accepted" || canEdit) && (
          <Card>
            <span id="convert" className="block scroll-mt-24" />
            <CardTitle>Make it an order</CardTitle>
            <ConvertQuoteForm quoteId={q.id} today={today} />
          </Card>
        )}

        <Card>
          <CardTitle>Products and prices</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {d.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{l.productName}</p>
                  <p className="text-[13px] tabular text-fg-2">
                    {fmtQty(l.qtyUnits, "pcs", 0)} × <Money value={l.unitAmount} />
                    {l.discountPct !== undefined && Number(l.discountPct) > 0 ? ` · ${Number(l.discountPct).toFixed(1)}% off the usual ` : ""}
                    {l.discountPct !== undefined && Number(l.discountPct) > 0 && <Money value={l.listUnitAmount} />}
                  </p>
                  <p className="font-mono text-[12px] text-muted">{l.sku}</p>
                </div>
                <Money className="whitespace-nowrap text-right font-semibold tabular" value={l.value} />
              </li>
            ))}
            <li className="flex justify-between gap-3 py-2.5 font-semibold">
              <span>Total{q.taxAmount && q.taxAmount !== "0.0000" ? " (with tax)" : ""}</span>
              <Money className="text-right tabular" value={q.totalAmount} />
            </li>
          </ul>
          <MaskedNote fields={q._masked} />
        </Card>

        <Card>
          <CardTitle>About this offer</CardTitle>
          <Dl
            items={[
              ["Customer", ctx.can("masterdata.customer.view") ? <Link key="c" className="text-primary-text hover:underline" href={`/sales/customers/${d.customer.id}`}>{d.customer.name}</Link> : d.customer.name],
              ["Good until", fmtDate(q.validUntil)],
              ["Deliver to", d.shipTo?.text ?? d.customer.shipToAddress],
              ...(d.order ? ([["Order", <Link key="o" className="text-primary-text hover:underline" href={`/sales/${d.order.id}`}>{d.order.orderNumber}</Link>]] as [string, React.ReactNode][]) : []),
              ...(q.decisionReason ? ([["Why", q.decisionReason]] as [string, string][]) : []),
            ]}
          />
          {q.notesCustomer && <p className="mt-3 text-[13px]">Note to the customer: {q.notesCustomer}</p>}
          {q.notesInternal && <p className="mt-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] text-fg-2">For our team: {q.notesInternal}</p>}
          <div className="mt-3">
            <MoreDetails>
              <Dl
                items={[
                  ["Made by", q.createdByName ?? "—"],
                  ["Sent", q.sentAt ? fmtDateTime(q.sentAt) : "—"],
                ]}
              />
              {d.decisions.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {d.decisions.map((x) => (
                    <li key={x.id}>
                      Step {x.step}: {x.decision} by {x.decidedByName} · {fmtDateTime(x.decidedAt)}
                      {x.note ? ` · ${x.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </MoreDetails>
          </div>
        </Card>
      </div>
    </div>
  );
}
