import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listReceipts } from "@/modules/inventory/receiving";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { ReceiptStatusChip } from "@/ui/receiving";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Goods receipts" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; open?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.view")) return <Forbidden what="goods receipts" />;
  const sp = await searchParams;
  const rows = await listReceipts(ctx, { status: sp.status, q: sp.q, openDiscrepancies: sp.open === "1" });
  const filtered = !!(sp.status || sp.q || sp.open);
  const exportQs = new URLSearchParams(Object.entries({ status: sp.status ?? "", q: sp.q ?? "" }).filter(([, v]) => v)).toString();
  return (
    <>
      <PageHeader
        title="Goods receipts"
        subtitle={`${ctx.currentSite.code} · drafts, posted and reversed receipts, newest first`}
        actions={
          <>
            {ctx.can("procurement.goods_receipt.export") && (
              <a href={`/api/v1/procurement/goods-receipts/export${exportQs ? `?${exportQs}` : ""}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
                Export CSV
              </a>
            )}
            {ctx.can("procurement.goods_receipt.create") && <LinkButton href="/inventory/receive" variant="cta">Receive materials</LinkButton>}
          </>
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="GR number, supplier, DR no." />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Status
            <Select name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 pb-3 text-[13px]">
            <input type="checkbox" name="open" value="1" defaultChecked={sp.open === "1"} className="size-4" /> Open discrepancies only
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No receipts match these filters" : "No goods receipts yet"}
          action={filtered ? <LinkButton href="/inventory/receipts" variant="secondary">Clear filters</LinkButton> : ctx.can("procurement.goods_receipt.create") ? <LinkButton href="/inventory/receive">Receive materials</LinkButton> : undefined}
        >
          {filtered ? "Try another search or status." : "Receipts you save or post at this site appear here."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/inventory/receive/${r.id}`}>
                  <Card className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-primary-text">{r.receiptNumber ?? "Draft"}</span>
                      <ReceiptStatusChip status={r.status} />
                    </div>
                    <p className="text-[13px]">{r.supplierName}</p>
                    <p className="text-[12px] text-muted">
                      {fmtDateTime(r.receivedAt)} · {r.lineCount} {r.lineCount === 1 ? "line" : "lines"}
                      {r.openDiscrepancies ? ` · ${r.openDiscrepancies} open discrepancy` : ""}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Receipt", "Status", "Supplier", "Supplier doc", "Received", "Lines", "Attention"]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/inventory/receive/${r.id}`} className="font-mono font-medium text-primary-text hover:underline">
                    {r.receiptNumber ?? "Draft"}
                  </Link>
                </Td>
                <Td><ReceiptStatusChip status={r.status} /></Td>
                <Td>
                  {r.supplierName}
                  {!r.supplierId && <span className="block text-[12px] text-[var(--warn-fg)]">not in supplier list</span>}
                </Td>
                <Td>{r.supplierDocumentNumber ?? "—"}</Td>
                <Td>
                  {fmtDateTime(r.receivedAt)}
                  <span className="block text-[12px] text-muted">{r.receivedByName}</span>
                </Td>
                <Td>{r.lineCount}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.openDiscrepancies > 0 && <Chip tone="warn">{r.openDiscrepancies} discrepancy</Chip>}
                    {r.documentsMissing > 0 && <Chip tone="warn">CoA missing</Chip>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
