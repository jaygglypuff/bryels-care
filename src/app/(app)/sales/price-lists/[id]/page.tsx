import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPriceList, manilaToday } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { Money, SalesStatus } from "../../orders/sales-ui";
import { NewVersionForm, PriceListCommand } from "./commands";

export const metadata = { title: "Price list" };

export default async function PriceListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.view")) return <Forbidden what="price lists" />;
  const { id } = await params;
  const { saved } = await searchParams;
  let d: Awaited<ReturnType<typeof getPriceList>>;
  try {
    d = await getPriceList(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const pl = d.priceList;
  const today = manilaToday();
  const effective = pl.status === "approved" && pl.effectiveFrom <= today && (!pl.effectiveTo || pl.effectiveTo > today);
  const iEdited = [pl.createdBy, pl.updatedBy, pl.submittedBy].includes(ctx.userId);
  return (
    <>
      <PageHeader
        title={`${pl.code} v${pl.versionNo}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SalesStatus status={effective ? "effective" : pl.status} />
            <span>{pl.name}</span>
          </span>
        }
        actions={<LinkButton href="/sales/price-lists" variant="secondary">All price lists</LinkButton>}
      />
      {saved && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={pl.status === "pending_approval" ? "Saved and sent for approval." : "Draft saved."} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Prices</CardTitle>
            <Table head={["SKU", "Product", "From qty", "Price"]}>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <Td className="font-medium">{l.sku}</Td>
                  <Td>{l.productName}</Td>
                  <Td>{fmtQty(l.minQtyUnits, "pcs", 0)}</Td>
                  <Td className="font-medium">
                    <Money value={l.unitAmount} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <CardTitle>Versions</CardTitle>
            <ul className="flex flex-col gap-1 text-[13px]">
              {d.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <Link className={v.id === pl.id ? "font-semibold" : "text-primary-text hover:underline"} href={`/sales/price-lists/${v.id}`}>
                    v{v.versionNo}
                  </Link>
                  <span className="text-muted">
                    {fmtDate(v.effectiveFrom)}
                    {v.effectiveTo ? ` – ${fmtDate(v.effectiveTo)}` : ""}
                  </span>
                  <SalesStatus status={v.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["For", d.customer ? <Link key="c" className="text-primary-text hover:underline" href={`/sales/customers/${d.customer.id}`}>{d.customer.name}</Link> : "General (customers without their own list)"],
                ["Effective", `${fmtDate(pl.effectiveFrom)}${pl.effectiveTo ? ` to ${fmtDate(pl.effectiveTo)}` : " (open-ended)"}`],
                ["Drafted by", pl.createdByName ?? "—"],
                ["Submitted", pl.submittedAt ? `${fmtDateTime(pl.submittedAt)} · ${pl.submittedByName ?? ""}` : "—"],
                ["Approved", pl.approvedAt ? `${fmtDateTime(pl.approvedAt)} · ${pl.approvedByName ?? ""}` : "—"],
                ...(pl.changeSummary ? ([["What changed", pl.changeSummary]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Next step</CardTitle>
            <div className="flex flex-col gap-3">
              {pl.status === "draft" && ctx.can("sales.price_list.edit") && (
                <>
                  <LinkButton href={`/sales/price-lists/${pl.id}/edit`} variant="secondary">Edit draft</LinkButton>
                  <PriceListCommand priceListId={pl.id} command="submit" label="Send for approval" variant="cta" />
                </>
              )}
              {pl.status === "pending_approval" && (
                <>
                  <p className="text-[13px] text-fg-2">Waiting for {d.approval?.next?.label.toLowerCase() ?? "approval"}.</p>
                  {d.canApprove ? (
                    <>
                      <PriceListCommand priceListId={pl.id} command="approve" label="Approve prices" note variant="cta" />
                      <PriceListCommand priceListId={pl.id} command="return" label="Return to draft" reason />
                      <PriceListCommand priceListId={pl.id} command="reject" label="Reject" reason variant="danger" />
                    </>
                  ) : (
                    <p className="text-[13px] text-muted">{iEdited ? "You prepared this version, so another person approves it." : "Only finance or the owner approves price lists."}</p>
                  )}
                </>
              )}
              {pl.status === "approved" && (
                <>
                  {ctx.can("sales.price_list.edit") && <NewVersionForm priceListId={pl.id} today={today} />}
                  {ctx.can("sales.price_list.approve") && <PriceListCommand priceListId={pl.id} command="retire" label="Retire" reason />}
                </>
              )}
              {(pl.status === "rejected" || pl.status === "retired") && <p className="text-[13px] text-muted">This version is closed. History keeps pointing at it.</p>}
            </div>
          </Card>
          {d.decisions.length > 0 && (
            <Card>
              <CardTitle>Decisions</CardTitle>
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.decisions.map((x) => (
                  <li key={x.id}>
                    Step {x.step}: {x.decision} by {x.decidedByName} · {fmtDateTime(x.decidedAt)}
                    {x.note ? ` · ${x.note}` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
