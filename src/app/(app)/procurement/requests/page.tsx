import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listPurchaseRequests } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FilterPills, PrChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase requests" };

const FILTERS = [
  ["open", "Open"],
  ["submitted", "To approve"],
  ["approved", "Approved"],
  ["converted", "Converted"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.view")) return <Forbidden what="purchase requests" />;
  const { status = "open" } = await searchParams;
  const rows = await listPurchaseRequests(ctx, { status });
  const prices = ctx.can("masterdata.supplier_price.view");
  return (
    <>
      <PageHeader
        title="Purchase requests"
        subtitle="Anyone who needs material asks here; the approver per the approval rules decides; procurement converts approved lines into purchase orders."
        actions={ctx.can("procurement.purchase_request.create") ? <LinkButton href="/procurement/requests/new" variant="cta">New request</LinkButton> : undefined}
      />
      <SubNav />
      <Card>
        <FilterPills base="/procurement/requests" current={status} items={FILTERS} />
        {rows.length === 0 ? (
          <EmptyState title="No requests here" action={ctx.can("procurement.purchase_request.create") ? <LinkButton href="/procurement/requests/new" variant="secondary">New request</LinkButton> : undefined}>
            Requests also come from accepted reorder suggestions.
          </EmptyState>
        ) : (
          <Table head={["Request", "Status", "Requested by", "Needed by", "Lines", ...(prices ? ["Estimate"] : []), "Created"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/procurement/requests/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <PrChip status={r.status} />
                </Td>
                <Td>{r.requestedByName}</Td>
                <Td className="whitespace-nowrap">{r.neededByDate ? fmtDate(r.neededByDate) : "—"}</Td>
                <Td>{r.lines}</Td>
                {prices && <Td className="whitespace-nowrap">{r.estimatedTotalAmount ? money(r.estimatedTotalAmount) : "—"}</Td>}
                <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
