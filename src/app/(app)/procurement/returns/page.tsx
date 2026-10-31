import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listSupplierReturns } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { Amount, SrChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send back to supplier" };

const FILTERS = [
  ["open", "Not done"],
  ["submitted", "To approve"],
  ["approved", "Ready to send back"],
  ["posted", "Sent back"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

/** Supplier returns (W04-09) as "Send back to supplier": supplier first, money back expected on the right. */
export default async function SupplierReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.supplier_return.view")) return <Forbidden what="returns to suppliers" />;
  const { status = "open" } = await searchParams;
  const rows = await listSupplierReturns(ctx, { status });
  const prices = ctx.can("masterdata.supplier_price.view");
  const canCreate = ctx.can("procurement.supplier_return.create");
  return (
    <>
      <PageHeader title="Send back to supplier" actions={canCreate ? <LinkButton href="/procurement/returns/new" variant="cta">Send something back</LinkButton> : undefined} />
      <PageIntro>
        This screen is for goods that QA said are not OK and that go back to the supplier: a second person approves, then the goods leave and the stock goes down. <Explain term="lot" />
      </PageIntro>
      <SubNav />
      <Card>
        <FilterTabs label="Filter returns" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/procurement/returns?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="Nothing going back here" action={canCreate ? <LinkButton href="/procurement/returns/new" variant="secondary">Send something back</LinkButton> : undefined}>
            Only lots that QA marked “Not OK” can go back. Ask QA if a delivery should be returned.
          </EmptyState>
        ) : (
          <PlainList label="Returns to suppliers">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                testId="sr-row"
                href={`/procurement/returns/${r.id}`}
                title={r.supplierName}
                code={r.number}
                status={<SrChip status={r.status} />}
                facts={`${r.lines} lot(s) · started ${fmtDate(r.createdAt)}${r.postedAt ? ` · sent back ${fmtDate(r.postedAt)}` : ""} · ${r.siteCode}`}
                aside={prices && r.credit ? <Amount>{money(r.credit)} back</Amount> : undefined}
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}
