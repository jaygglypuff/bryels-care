import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listPriceLists } from "@/modules/sales";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { SalesStatus } from "../orders/sales-ui";

export const metadata = { title: "Price lists" };

export default async function PriceListsPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.view")) return <Forbidden what="price lists" />;
  const rows = await listPriceLists(ctx);
  const pending = rows.filter((r) => r.status === "pending_approval");
  return (
    <>
      <PageHeader
        title="Price lists"
        subtitle="Customer and general prices. A change is a new version approved by finance or the owner (never by its editor) and applies from its effective date."
        actions={ctx.can("sales.price_list.edit") ? <LinkButton href="/sales/price-lists/new" variant="cta">New price list</LinkButton> : undefined}
      />
      {pending.length > 0 && (
        <p className="mb-3 text-[13px] text-[var(--warn-fg)]">
          {pending.length} version{pending.length === 1 ? "" : "s"} waiting for approval.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No price lists yet" action={ctx.can("sales.price_list.edit") ? <LinkButton href="/sales/price-lists/new">Create the first list</LinkButton> : undefined}>
          Without an approved list, order entry needs a manual price for every line.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/sales/price-lists/${r.id}`}>
                  <Card className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {r.code} v{r.versionNo}
                      </span>
                      <SalesStatus status={r.effective ? "effective" : r.status} />
                    </div>
                    <p className="text-[13px]">{r.name}</p>
                    <p className="text-[12px] text-muted">
                      {r.customerName ?? "General"} · from {fmtDate(r.effectiveFrom)} · {r.lineCount} prices
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["List", "Name", "For", "Effective", "Prices", "Status"]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <Link className="font-medium text-primary-text hover:underline" href={`/sales/price-lists/${r.id}`}>
                    {r.code} v{r.versionNo}
                  </Link>
                </Td>
                <Td>{r.name}</Td>
                <Td>{r.customerName ?? "General"}</Td>
                <Td>
                  {fmtDate(r.effectiveFrom)}
                  {r.effectiveTo ? ` – ${fmtDate(r.effectiveTo)}` : ""}
                </Td>
                <Td>{r.lineCount}</Td>
                <Td>
                  <SalesStatus status={r.effective ? "effective" : r.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
