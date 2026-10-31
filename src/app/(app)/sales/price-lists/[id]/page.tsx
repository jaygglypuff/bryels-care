import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { approverLabel } from "@/lib/auth/self-approval";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getPriceList, manilaToday } from "@/modules/sales";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { Money, SalesStatus } from "../../orders/sales-ui";
import { NewVersionForm, PriceListCommand } from "./commands";
import { DeleteDraftButton } from "../../../delete-draft-button";
import { DoNext, whoDoes } from "../../next-step";

export const metadata = { title: "Prices" };

export default async function PriceListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.view")) return <Forbidden what="prices" />;
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
  const canEdit = ctx.can("sales.price_list.edit");
  const who = d.customer ? d.customer.name : "Everyone";
  const approvedBy = approverLabel(pl.approvedByName, pl.approvedBy, [pl.createdBy, pl.submittedBy, pl.updatedBy]);

  const next =
    pl.status === "draft" ? (
      canEdit ? (
        <DoNext text="Next: check the prices, then send them for approval.">
          <PriceListCommand priceListId={pl.id} command="submit" label="Send for approval" variant="cta" />
        </DoNext>
      ) : (
        <DoNext text="These prices are a draft." waitingFor="Waiting for sales to send them for approval." />
      )
    ) : pl.status === "pending_approval" ? (
      d.canApprove ? (
        <DoNext text={iEdited ? "Next: approve your own prices (as owner it is recorded as your own request), or send them back." : "Next: approve these prices, or send them back."} action={{ label: "Approve now", href: "#approve" }} />
      ) : (
        <DoNext
          text={iEdited ? "You made these prices, so someone else approves them." : "These prices need approval."}
          waitingFor={`Waiting for ${await whoDoes(ctx, "sales.price_list.approve", null, "finance or the owner")} to approve.`}
        />
      )
    ) : pl.status === "approved" ? (
      <DoNext text={effective ? "These prices are in use now. To change a price, start new prices under ⋯ More." : `Approved. Orders use these prices from ${fmtDate(pl.effectiveFrom)}.`} />
    ) : (
      <DoNext text="These prices are no longer used. Earlier orders keep them." />
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Prices for ${who}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href="/sales/price-lists" className="text-primary-text hover:underline">Prices</Link>
            <RecordNo>{`${pl.code} v${pl.versionNo}`}</RecordNo>
            <SalesStatus status={effective ? "effective" : pl.status} />
          </span>
        }
        actions={
          (pl.status === "draft" && canEdit) || (pl.status === "approved" && (canEdit || ctx.can("sales.price_list.approve"))) ? (
            <MoreMenu>
              <div className="flex flex-col gap-3">
                {pl.status === "draft" && canEdit && <LinkButton href={`/sales/price-lists/${pl.id}/edit`} variant="secondary">Change the draft</LinkButton>}
                {pl.status === "draft" && canEdit && <DeleteDraftButton kind="price_list" id={pl.id} what="these draft prices" />}
                {pl.status === "approved" && canEdit && <NewVersionForm priceListId={pl.id} today={today} />}
                {pl.status === "approved" && ctx.can("sales.price_list.approve") && <PriceListCommand priceListId={pl.id} command="retire" label="Stop using these prices" reason />}
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for one set of prices: what each product costs for {d.customer ? "this customer" : "everyone"}, from which day, and who approved it.</PageIntro>
      {saved && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={pl.status === "pending_approval" ? "Saved and sent for approval." : "Draft saved."} />
        </div>
      )}
      {next}

      <div className="flex flex-col gap-4">
        {pl.status === "pending_approval" && d.canApprove && (
          <Card>
            <span id="approve" className="block scroll-mt-24" />
            <CardTitle>Approve</CardTitle>
            <div className="flex flex-col gap-3">
              <PriceListCommand priceListId={pl.id} command="approve" label="Approve prices" note variant="cta" />
              <PriceListCommand priceListId={pl.id} command="return" label="Send back to draft" reason />
              <PriceListCommand priceListId={pl.id} command="reject" label="Say no" reason variant="danger" />
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>Price of each product</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {d.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium">{l.productName}</p>
                  <p className="text-[13px] text-fg-2">
                    {Number(l.minQtyUnits) > 0 ? `When they buy at least ${fmtQty(l.minQtyUnits, "pcs", 0)}` : "Any amount"} <span className="font-mono text-[12px] text-muted">· {l.sku}</span>
                  </p>
                </div>
                <Money className="whitespace-nowrap text-right text-[15px] font-semibold tabular" value={l.unitAmount} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>About these prices</CardTitle>
          <Dl
            items={[
              ["For", d.customer ? <Link key="c" className="text-primary-text hover:underline" href={`/sales/customers/${d.customer.id}`}>{d.customer.name}</Link> : "Everyone without their own prices"],
              ["In use", `${fmtDate(pl.effectiveFrom)}${pl.effectiveTo ? ` to ${fmtDate(pl.effectiveTo)}` : " onwards"}`],
              ["Approved", pl.approvedAt ? `${fmtDateTime(pl.approvedAt)} · ${approvedBy ?? ""}` : "Not yet"],
              ...(pl.changeSummary ? ([["What changed", pl.changeSummary]] as [string, string][]) : []),
            ]}
          />
          <div className="mt-3">
            <MoreDetails>
              <Dl
                items={[
                  ["Name", pl.name],
                  ["Made by", pl.createdByName ?? "—"],
                  ["Sent for approval", pl.submittedAt ? `${fmtDateTime(pl.submittedAt)} · ${pl.submittedByName ?? ""}` : "—"],
                ]}
              />
              {d.decisions.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {d.decisions.map((x) => (
                    <li key={x.id}>
                      Step {x.step}: {x.decision} by {x.decidedByName} · {fmtDateTime(x.decidedAt)}
                      {x.note ? ` · ${x.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[13px] font-medium">Earlier and later versions</p>
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className={v.id === pl.id ? "font-semibold" : "text-primary-text hover:underline"} href={`/sales/price-lists/${v.id}`}>
                      From {fmtDate(v.effectiveFrom)}
                      {v.effectiveTo ? ` to ${fmtDate(v.effectiveTo)}` : ""} <span className="font-mono text-[12px] text-muted">v{v.versionNo}</span>
                    </Link>
                    <SalesStatus status={v.status} />
                  </li>
                ))}
              </ul>
            </MoreDetails>
          </div>
        </Card>
      </div>
    </div>
  );
}
