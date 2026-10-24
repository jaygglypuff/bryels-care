import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { SEGMENT_LABEL, listCustomers, type CustomerSegment } from "@/modules/sales";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { Money, SalesStatus } from "../orders/sales-ui";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; segment?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.view")) return <Forbidden what="customers" />;
  const f = await searchParams;
  const rows = await listCustomers(ctx, { q: f.q, status: f.status, segment: f.segment });
  const canCreate = ctx.can("masterdata.customer.create");
  const credit = ctx.can("finance.credit_terms.view");
  const filtered = !!(f.q || f.status || f.segment);
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Profiles, addresses, requirements and terms. Credit terms are visible to finance-authorised roles only."
        actions={
          <>
            {ctx.can("masterdata.customer.export") && (
              <a className={buttonClass("secondary")} href={`/api/v1/sales/customers/export?format=csv${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`}>
                Export CSV
              </a>
            )}
            {canCreate ? <LinkButton href="/sales/customers/new" variant="cta">New customer</LinkButton> : null}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={f.q ?? ""} placeholder="Search name or code" aria-label="Search customers" className="max-w-[260px]" />
        <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="max-w-[180px]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="on_hold">Credit hold</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select name="segment" defaultValue={f.segment ?? ""} aria-label="Segment" className="max-w-[200px]">
          <option value="">All segments</option>
          {Object.entries(SEGMENT_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <button className={buttonClass("secondary", "md")} type="submit">
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={filtered ? "No customers match" : "No customers yet"} action={canCreate && !filtered ? <LinkButton href="/sales/customers/new">Add a customer</LinkButton> : undefined}>
          {filtered ? "Change the filters to see more customers." : "Customers you add here can be chosen on quotations and sales orders."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/sales/customers/${c.id}`}>
                  <Card className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-fg">{c.name}</span>
                      <SalesStatus status={c.status} />
                    </div>
                    <p className="font-mono text-[12px] text-muted">{c.code}</p>
                    <p className="text-[13px] text-fg-2">{c.shipToAddress}</p>
                    <p className="text-[12px] text-muted">
                      {c.segment ? SEGMENT_LABEL[c.segment as CustomerSegment] : "No segment"} · {c.openOrders} open order{c.openOrders === 1 ? "" : "s"}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Code", "Name", "Segment", "Status", "Ship to", ...(credit ? ["Credit limit"] : []), "Open / all orders", "Last order"]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <Td className="font-mono text-[12px]">{c.code}</Td>
                <Td>
                  <Link href={`/sales/customers/${c.id}`} className="font-medium text-primary-text hover:underline">
                    {c.name}
                  </Link>
                  {c.contactName && <span className="block text-[12px] text-muted">{c.contactName}</span>}
                </Td>
                <Td>{c.segment ? SEGMENT_LABEL[c.segment as CustomerSegment] : "—"}</Td>
                <Td>
                  <SalesStatus status={c.status} />
                </Td>
                <Td className="max-w-[240px] text-fg-2">{c.shipToAddress}</Td>
                {credit && (
                  <Td>
                    <Money value={c.creditLimitAmount ?? null} />
                  </Td>
                )}
                <Td>
                  {c.openOrders} / {c.orders}
                </Td>
                <Td>{c.lastOrderAt ? fmtDate(c.lastOrderAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
