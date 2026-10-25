import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSupplierReturns } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FilterPills, SrChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier returns" };

const FILTERS = [
  ["open", "Open"],
  ["submitted", "To approve"],
  ["approved", "To post"],
  ["posted", "Posted"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function SupplierReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.view")) return <Forbidden what="supplier returns" />;
  const { status = "open" } = await searchParams;
  const rows = await listSupplierReturns(ctx, { status });
  const prices = ctx.can("masterdata.supplier_price.view");
  return (
    <>
      <PageHeader
        title="Supplier returns"
        subtitle="Rejected lots go back to the supplier: draft, approval by a second person, then posting issues the stock (W04-09)."
        actions={ctx.can("procurement.supplier_return.create") ? <LinkButton href="/procurement/returns/new" variant="cta">New supplier return</LinkButton> : undefined}
      />
      <SubNav />
      <Card>
        <FilterPills base="/procurement/returns" current={status} items={FILTERS} />
        {rows.length === 0 ? (
          <EmptyState title="No supplier returns here">Only lots that QA rejected can be returned.</EmptyState>
        ) : (
          <Table head={["Return", "Status", "Supplier", "Lines", ...(prices ? ["Expected credit"] : []), "Created", "Posted"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/procurement/returns/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <SrChip status={r.status} />
                </Td>
                <Td>{r.supplierName}</Td>
                <Td>{r.lines}</Td>
                {prices && <Td>{r.credit ? money(r.credit) : "—"}</Td>}
                <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                <Td className="whitespace-nowrap">{r.postedAt ? fmtDateTime(r.postedAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
