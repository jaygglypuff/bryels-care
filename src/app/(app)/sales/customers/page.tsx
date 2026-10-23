import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listCustomers } from "@/modules/sales";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.customer.view")) return <Forbidden what="customers" />;
  const rows = await listCustomers(ctx);
  const canCreate = ctx.can("masterdata.customer.create");
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Ship-to address and minimum remaining shelf life used for FEFO allocation."
        actions={canCreate ? <LinkButton href="/sales/customers/new" variant="cta">New customer</LinkButton> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="No customers yet" action={canCreate ? <LinkButton href="/sales/customers/new">Add a customer</LinkButton> : undefined}>
          Customers you add here can be chosen on new sales orders.
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
                      <span className="font-mono text-[12px] text-muted">{c.code}</span>
                    </div>
                    <p className="text-[13px] text-fg-2">{c.shipToAddress}</p>
                    <p className="text-[12px] text-muted">
                      {c.contactName ?? "No contact"} · min shelf life {c.minShelfLifeDays} d · {c.orders} order{c.orders === 1 ? "" : "s"}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Code", "Name", "Contact", "Ship to", "Min shelf life", "Orders", "Last order"]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <Td className="font-mono text-[12px]">{c.code}</Td>
                <Td>
                  <Link href={`/sales/customers/${c.id}`} className="font-medium text-primary-text hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td>
                  {c.contactName ?? "—"}
                  {c.phone && <span className="block text-[12px] text-muted">{c.phone}</span>}
                </Td>
                <Td className="max-w-[260px] text-fg-2">{c.shipToAddress}</Td>
                <Td>{c.minShelfLifeDays} days</Td>
                <Td>{c.orders}</Td>
                <Td>{c.lastOrderAt ? fmtDate(c.lastOrderAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
