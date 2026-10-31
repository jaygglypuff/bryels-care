import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listPriceLists } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { SalesStatus } from "../orders/sales-ui";

export const metadata = { title: "Prices" };

export default async function PriceListsPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.view")) return <Forbidden what="prices" />;
  const rows = await listPriceLists(ctx);
  const pending = rows.filter((r) => r.status === "pending_approval");
  const canEdit = ctx.can("sales.price_list.edit");
  return (
    <>
      <PageHeader title="Prices" actions={canEdit ? <LinkButton href="/sales/price-lists/new" variant="cta">Set new prices</LinkButton> : undefined} />
      <PageIntro>This screen is for our selling prices: the prices for everyone, and special prices for some customers. A change is approved by finance or the owner before orders use it.</PageIntro>
      {pending.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${pending.length} price change${pending.length === 1 ? "" : "s"} waiting for approval`}>Orders keep the old prices until it is approved.</Banner>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No prices yet" action={canEdit ? <LinkButton href="/sales/price-lists/new">Set new prices</LinkButton> : undefined}>
          {canEdit ? "Tap Set new prices and type the price of each product. Until then every order needs a price typed by hand." : "Until prices are set, every order needs a price typed by hand. Ask finance or the owner to set them."}
        </EmptyState>
      ) : (
        <PlainList label="Prices">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              href={`/sales/price-lists/${r.id}`}
              title={r.customerName ?? "Everyone (general prices)"}
              code={`${r.code} v${r.versionNo}`}
              status={<SalesStatus status={r.effective ? "effective" : r.status} />}
              facts={
                <>
                  From {fmtDate(r.effectiveFrom)}
                  {r.effectiveTo ? ` to ${fmtDate(r.effectiveTo)}` : ""} · {r.name}
                </>
              }
              aside={`${r.lineCount} product${r.lineCount === 1 ? "" : "s"}`}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}
