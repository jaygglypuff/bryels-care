import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { AGING_BUCKETS, customerStatement } from "@/modules/finance";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { LATE_WORD, Money, RowAmount } from "../../finance-ui";

export const metadata = { title: "Customer statement" };

/** One customer's statement: what they still owe, how late each invoice is, recent payments and credits. */
export default async function StatementPage({ params, searchParams }: { params: Promise<{ customerId: string }>; searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="customer statements" />;
  const { customerId } = await params;
  const { asOf } = await searchParams;
  let st: Awaited<ReturnType<typeof customerStatement>>;
  try {
    st = await customerStatement(ctx, customerId, { asOf });
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const late = st.items.filter((i) => i.daysOverdue > 0);
  const canPrint = ctx.can("finance.invoice.export");
  return (
    <>
      <PageHeader
        title={st.customer.name}
        subtitle={`Statement · as of ${fmtDate(st.asOf)}`}
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/finance/statements" variant="secondary">
                All customers
              </LinkButton>
              <form className="flex flex-col gap-2" method="get">
                <label className="text-[14px] font-medium" htmlFor="asOf">
                  Show it as of another day
                </label>
                <Input id="asOf" name="asOf" type="date" defaultValue={st.asOf} />
                <button className={buttonClass("secondary")} type="submit">
                  Show
                </button>
              </form>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one customer: what they still owe us, which invoices are late, and what they paid lately.</PageIntro>
      {canPrint && Number(st.balanceDue) > 0 ? (
        <NextStep text={late.length ? `${late.length} invoice(s) are late. Print the statement and send it to ${st.customer.name}.` : `Print the statement and send it to ${st.customer.name}.`} action={{ label: "Print the statement", href: `/print/statement/${st.customer.id}?asOf=${st.asOf}` }} />
      ) : null}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] text-muted">They owe us</p>
            <p className="text-[28px] font-semibold tabular-nums">
              <Money value={st.balanceDue} />
            </p>
          </div>
          <p className="text-[14px] text-fg-2">
            Unpaid invoices <Money value={st.totalOpen} /> − paid ahead <Money value={st.unappliedOnAccount} />
          </p>
        </div>
        <p className="mb-2 mt-4 text-[14px] font-semibold">How late</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AGING_BUCKETS.map((b) => (
            <li key={b} className="rounded-[12px] border border-line px-3 py-2">
              <p className="text-[12px] font-semibold text-muted">{LATE_WORD[b] ?? b}</p>
              <p className="mt-1 font-semibold tabular-nums">
                <Money value={st.buckets[b]} />
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mb-4">
        <CardTitle>Unpaid invoices</CardTitle>
        {st.items.length === 0 ? (
          <EmptyState title="Nothing unpaid">This customer owes nothing on this day.</EmptyState>
        ) : (
          <PlainList label="Unpaid invoices">
            {st.items.map((i) => (
              <PlainRow
                key={i.id}
                href={`/finance/invoices/${i.id}`}
                title={`Due ${fmtDate(i.dueDate)}`}
                code={i.invoiceNumber}
                tone={i.daysOverdue > 30 ? "bad" : i.daysOverdue > 0 ? "warn" : undefined}
                status={i.daysOverdue > 0 ? <Chip tone={i.daysOverdue > 30 ? "bad" : "warn"}>{i.daysOverdue} day(s) late</Chip> : undefined}
                facts={
                  <>
                    Invoice <Money value={i.total} /> · paid <Money value={i.paid} />
                  </>
                }
                aside={<RowAmount value={i.open} note="still to pay" />}
              />
            ))}
          </PlainList>
        )}
      </Card>
      <MoreDetails title="Payments and credits (last 90 days)">
        <div>
          <p className="mb-2 text-[14px] font-semibold">Payments</p>
          {st.payments.length === 0 ? (
            <p className="text-[14px] text-fg-2">No payments in the last 90 days.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {st.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {fmtDate(p.paidOn)} <span className="font-mono text-[12px] text-muted">{p.paymentNumber}</span>
                    {Number(p.unapplied) > 0 ? (
                      <span className="text-muted">
                        {" "}
                        (<Money value={p.unapplied} /> kept for later)
                      </span>
                    ) : null}
                  </span>
                  <Money value={p.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-[14px] font-semibold">Credits (money back)</p>
          {st.credits.length === 0 ? (
            <p className="text-[14px] text-fg-2">No credits in the last 90 days.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {st.credits.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {fmtDate(c.issueDate)} on invoice {c.invoiceNumber} <span className="font-mono text-[12px] text-muted">{c.creditNoteNumber}</span>
                  </span>
                  <Money value={c.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[13px] text-muted">Activity since {fmtDate(st.from)}.</p>
        {canPrint && (
          <Link className="text-[14px] text-primary-text underline" href={`/print/statement/${st.customer.id}?asOf=${st.asOf}`} target="_blank">
            Print the statement
          </Link>
        )}
      </MoreDetails>
    </>
  );
}
