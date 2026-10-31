import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listPurchaseOrders } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { Amount, PoChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders" };

const FILTERS = [
  ["open", "Not done"],
  ["draft", "Drafts"],
  ["submitted", "To approve"],
  ["approved", "To send"],
  ["sent", "Waiting for delivery"],
  ["closed", "Done"],
  ["all", "All"],
] as const;

/** Purchase orders: supplier first, total on the right, order number small and grey (ADR-088). */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view")) return <Forbidden what="purchase orders" />;
  const { status = "open", q } = await searchParams;
  const rows = await listPurchaseOrders(ctx, { status, q });
  const prices = ctx.can("masterdata.supplier_price.view");
  const canCreate = ctx.can("procurement.purchase_order.create");
  return (
    <>
      <PageHeader
        title="Purchase orders"
        actions={
          <>
            {canCreate && <LinkButton href="/procurement/orders/new" variant="cta">New purchase order</LinkButton>}
            {ctx.can("procurement.purchase_order.export") && (
              <MoreMenu>
                <a className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline" href={`/api/v1/procurement/purchase-orders/export?status=${encodeURIComponent(status)}`}>
                  Download this list (CSV)
                </a>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for the orders we send to suppliers: which wait for approval, which to send, and which deliveries are still coming.</PageIntro>
      <SubNav />
      <Card>
        <form method="get" className="mb-3 flex flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="status" value={status} />
          <label htmlFor="po-q" className="sr-only">Find an order</label>
          <input id="po-q" name="q" defaultValue={q ?? ""} placeholder="Find by supplier or order number" className="min-h-[44px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[15px]" />
          <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2">Find</button>
        </form>
        <FilterTabs label="Filter orders" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/procurement/orders?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders here" action={canCreate ? <LinkButton href="/procurement/orders/new" variant="secondary">New purchase order</LinkButton> : undefined}>
            {canCreate ? "Make a purchase order for a supplier we may buy from, or from an approved request to buy." : "Purchasing makes the orders. Ask them if you expected one here."}
          </EmptyState>
        ) : (
          <PlainList label="Purchase orders">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                testId="po-row"
                href={`/procurement/orders/${r.id}`}
                title={r.supplierName}
                code={r.number}
                tone={r.late ? "warn" : undefined}
                status={
                  <>
                    <PoChip status={r.status} />
                    {r.late && <Chip tone="warn">Late</Chip>}
                    {r.urgent && <Chip tone="bad">Urgent</Chip>}
                  </>
                }
                facts={`${r.lines} item(s) · ordered ${fmtDate(r.orderDate)}${r.expectedDate ? ` · comes ${fmtDate(r.expectedDate)}` : ""} · ${r.siteCode}`}
                aside={prices ? <Amount>{money(r.totalAmount, r.currency)}</Amount> : undefined}
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}
