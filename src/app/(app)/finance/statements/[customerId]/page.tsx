import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate } from "@/lib/qty";
import { AGING_BUCKETS, AGING_LABEL, customerStatement } from "@/modules/finance";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { Money } from "../../finance-ui";

export const metadata = { title: "Statement of account" };

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
  return (
    <>
      <PageHeader
        title={`Statement · ${st.customer.name}`}
        subtitle={`As of ${fmtDate(st.asOf)} · activity since ${fmtDate(st.from)}`}
        actions={
          <>
            <LinkButton href="/finance/statements" variant="secondary">
              All customers
            </LinkButton>
            {ctx.can("finance.invoice.export") && (
              <LinkButton href={`/print/statement/${st.customer.id}?asOf=${st.asOf}`} target="_blank" variant="secondary">
                Print statement
              </LinkButton>
            )}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col gap-1 text-[13px] font-medium" htmlFor="asOf">
          As of
          <Input id="asOf" name="asOf" type="date" defaultValue={st.asOf} className="w-44" />
        </label>
        <button className={buttonClass("secondary")} type="submit">
          Show
        </button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <Card key={b}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{AGING_LABEL[b]}</p>
            <p className="mt-1 font-semibold tabular-nums">
              <Money value={st.buckets[b]} />
            </p>
          </Card>
        ))}
      </div>
      <Card className="mb-4">
        <CardTitle>Open invoices</CardTitle>
        {st.items.length === 0 ? (
          <EmptyState title="Nothing open">This customer has no open invoices as of this date.</EmptyState>
        ) : (
          <Table head={["Invoice", "Issued", "Due", "Days overdue", "Total", "Paid / credited", "Open"]}>
            {st.items.map((i) => (
              <tr key={i.id}>
                <Td>
                  <Link className="font-medium text-primary-text hover:underline" href={`/finance/invoices/${i.id}`}>
                    {i.invoiceNumber}
                  </Link>
                </Td>
                <Td>{fmtDate(i.issueDate)}</Td>
                <Td>{fmtDate(i.dueDate)}</Td>
                <Td>{i.daysOverdue || "—"}</Td>
                <Td>
                  <Money value={i.total} />
                </Td>
                <Td>
                  <Money value={i.paid} />
                </Td>
                <Td className="font-medium">
                  <Money value={i.open} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <dl className="mt-3 grid grid-cols-1 gap-1 text-[14px] sm:grid-cols-3">
          <div>
            <dt className="text-muted">Total open</dt>
            <dd className="font-semibold">
              <Money value={st.totalOpen} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Unapplied payments on account</dt>
            <dd className="font-semibold">
              <Money value={st.unappliedOnAccount} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">Balance due</dt>
            <dd className="font-semibold">
              <Money value={st.balanceDue} />
            </dd>
          </div>
        </dl>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Payments (last 90 days)</CardTitle>
          {st.payments.length === 0 ? (
            <p className="text-[13px] text-muted">No payments recorded in this window.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {st.payments.map((p) => (
                <li key={p.id}>
                  {p.paymentNumber} · {fmtDate(p.paidOn)} · <Money value={p.amount} />
                  {Number(p.unapplied) > 0 ? (
                    <span className="text-muted">
                      {" "}
                      (<Money value={p.unapplied} /> on account)
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Credit notes (last 90 days)</CardTitle>
          {st.credits.length === 0 ? (
            <p className="text-[13px] text-muted">No credit notes in this window.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {st.credits.map((c) => (
                <li key={c.id}>
                  {c.creditNoteNumber} · {fmtDate(c.issueDate)} · on {c.invoiceNumber} · <Money value={c.amount} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
