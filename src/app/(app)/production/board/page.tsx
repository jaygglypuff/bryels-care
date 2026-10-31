import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { getProductionBoard, listProductionLines, listProducts } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader, Select } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { BoardView } from "./board-view";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Production board" };
export const dynamic = "force-dynamic";

type SP = { siteId?: string; lineId?: string; productId?: string; from?: string; to?: string; assigneeId?: string };

export default async function BoardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view") || !ctx.can("production.batch.view")) return <Forbidden what="the production board" />;
  const sp = await searchParams;
  const siteId = sp.siteId && ctx.allowedSiteIds.includes(sp.siteId) ? sp.siteId : ctx.currentSiteId;
  const board = await getProductionBoard(ctx, { ...sp, siteId });
  const lines = await listProductionLines(ctx, siteId);
  const products = ctx.can("masterdata.product.view") ? await listProducts(ctx) : [];
  const site = ctx.allowedSites.find((s) => s.id === siteId)!;
  const field = "min-h-[40px] rounded-[12px] border border-line-strong bg-surface px-3 text-[13px]";
  return (
    <div>
      <PageHeader
        title="Production board"
        subtitle={`${site.code} · ${site.name} · ${board.total} card${board.total === 1 ? "" : "s"} · drag a card to move it when your role allows`}
        actions={
          <>
            <LinkButton href="/production/work-orders" variant="secondary">Production orders</LinkButton>
            {ctx.can("production.work_order.create") && <LinkButton href="/production/work-orders/new" variant="cta">New production order</LinkButton>}
          </>
        }
      />
      <PageIntro>All batches by step, so you can see what is waiting.</PageIntro>
      <details className="mb-4">
        <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] font-medium text-fg-2">Filter the board (site, line, product, dates, person)</summary>
      <form method="get" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end" aria-label="Board filters">
        {ctx.allowedSites.length > 1 && (
          <label className="flex flex-col gap-1 text-[12px] font-medium">
            Site
            <Select name="siteId" defaultValue={siteId} className={field}>
              {ctx.allowedSites.map((s) => (
                <option key={s.id} value={s.id}>{s.code}</option>
              ))}
            </Select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          Line
          <Select name="lineId" defaultValue={sp.lineId ?? ""} className={field}>
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.code}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          Product
          <Select name="productId" defaultValue={sp.productId ?? ""} className={field}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.skuCode}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          From
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          To
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium">
          Assignee
          <Select name="assigneeId" defaultValue={sp.assigneeId ?? ""} className={field}>
            <option value="">Anyone</option>
            {board.assigneeOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </label>
        <button type="submit" className="min-h-[44px] rounded-full border border-line bg-surface px-4 text-[13px] font-medium hover:bg-surface-2">Apply</button>
      </form>
      </details>
      {board.total === 0 ? (
        <EmptyState title="Nothing on the board" action={ctx.can("production.work_order.create") ? <LinkButton href="/production/work-orders/new">Create a production order</LinkButton> : undefined}>
          Production orders and batches of this site appear here by state. Clear the filters or plan the next production order.
        </EmptyState>
      ) : (
        <BoardView board={board} />
      )}
    </div>
  );
}
