import { requireContext } from "@/lib/auth/context";
import { getContainer, takeoutFormData, takeoutSourcesForLabel } from "@/modules/inventory";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { MoreMenu } from "@/ui/more-menu";
import { Forbidden } from "../../forbidden";
import { TakeOutFlow } from "./take-out-flow";

export const metadata = { title: "Take a few out" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Take a few out (ADR-138): a few finished pieces leave stock for an online order, a sample, a giveaway, the display
 * shelf or staff use. Phone first: scan the box or tap the product, say how many and why, one tap to save.
 */
export default async function TakeOutPage({ searchParams }: { searchParams: Promise<{ box?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.takeout.create")) return <Forbidden what="taking pieces out of stock" permission="inventory.takeout.create" />;
  const sp = await searchParams;
  const data = await takeoutFormData(ctx);
  let initial = null;
  if (sp.box && UUID.test(sp.box) && ctx.can("inventory.container.view")) {
    try {
      const box = await getContainer(ctx, sp.box);
      const r = await takeoutSourcesForLabel(ctx, `BC:BOX:${box.containerNumber}`);
      initial = r.ok ? r.sources : null;
    } catch {
      initial = null;
    }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Take a few out"
        subtitle={ctx.currentSite.name}
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <Help screen="inventory.takeout" />
              <LinkButton href="/inventory/take-out/count" variant="secondary">Count what&apos;s left</LinkButton>
              {ctx.can("inventory.takeout.view") && <LinkButton href="/inventory/take-outs" variant="secondary">Taken out</LinkButton>}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for the few pieces that leave without a customer order: an online order, a sample, a gift. Scan the box or tap the product, say how many and why, then tap Take out.</PageIntro>
      {data.products.length === 0 && !initial ? (
        <EmptyState title="No finished pieces to take out here" action={<LinkButton href="/inventory?kind=product" variant="secondary">See the stock</LinkButton>}>
          Pieces can be taken only from finished goods that QA released, that are in date and not set aside for a customer order.
        </EmptyState>
      ) : (
        <TakeOutFlow
          products={data.products}
          channels={data.channels}
          customers={data.customers}
          shelves={data.shelves}
          limits={data.limits}
          initial={initial}
          canSeeCustomers={ctx.can("masterdata.customer.view")}
          canSeeList={ctx.can("inventory.takeout.view")}
        />
      )}
    </div>
  );
}
