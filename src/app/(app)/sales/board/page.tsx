import { requireContext } from "@/lib/auth/context";
import { orderBoard } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { OrderBoardView } from "./board-view";

export const metadata = { title: "Order board" };

export default async function OrderBoardPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="sales orders" />;
  const board = await orderBoard(ctx);
  const total = board.columns.reduce((n, c) => n + c.cards.length, 0);
  return (
    <>
      <PageHeader
        title="Order board"
        subtitle={`${ctx.currentSite.name} · one column per step; finished orders show for 30 days`}
        actions={
          <>
            <LinkButton href="/sales" variant="secondary">List</LinkButton>
            {ctx.can("sales.sales_order.create") && <LinkButton href="/sales/new" variant="cta">New order</LinkButton>}
          </>
        }
      />
      {total === 0 ? (
        <EmptyState title="No orders at this site" action={ctx.can("sales.sales_order.create") ? <LinkButton href="/sales/new">Create an order</LinkButton> : undefined}>
          Orders of {ctx.currentSite.name} appear here by state. Switch site in the top bar to see other sites.
        </EmptyState>
      ) : (
        <OrderBoardView board={board} />
      )}
    </>
  );
}
