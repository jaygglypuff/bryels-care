import { requireContext } from "@/lib/auth/context";
import { orderBoard } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { OrderBoardView } from "./board-view";

export const metadata = { title: "Orders as a board" };

export default async function OrderBoardPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="customer orders" />;
  const board = await orderBoard(ctx);
  const total = board.columns.reduce((n, c) => n + c.cards.length, 0);
  return (
    <>
      <PageHeader
        title="Orders as a board"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {ctx.can("sales.sales_order.create") && <LinkButton href="/sales/new" variant="cta">New customer order</LinkButton>}
            <LinkButton href="/sales" variant="secondary">See as a list</LinkButton>
          </>
        }
      />
      <PageIntro>This screen is for seeing every customer order by step, from draft to sent out. Finished orders stay for 30 days. Use “Move to…” on a card for the next step.</PageIntro>
      {total === 0 ? (
        <EmptyState title="No orders at this site" action={ctx.can("sales.sales_order.create") ? <LinkButton href="/sales/new">New customer order</LinkButton> : undefined}>
          Orders of {ctx.currentSite.name} show here by step. Switch site in the top bar to see other sites.
        </EmptyState>
      ) : (
        <OrderBoardView board={board} />
      )}
    </>
  );
}
