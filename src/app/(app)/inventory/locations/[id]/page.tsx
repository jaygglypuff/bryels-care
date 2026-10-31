import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getLocationDetail } from "@/modules/inventory/lots-admin";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Expiry, LocationKindChip, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Shelf" };

/** One shelf or area (grade-5, ADR-088): what is on it, item first, amounts in friendly units; boxes and sacks below. */
export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="shelves" />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getLocationDetail>>;
  try {
    d = await getLocationDetail(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const canMove = ctx.can("inventory.movement.post") && d.siteId === ctx.currentSiteId && d.isActive && !d.frozenBy;
  return (
    <div className="space-y-4">
      <PageHeader
        title={d.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Shelf <RecordNo>{d.code}</RecordNo> {d.kind !== "storage" && <LocationKindChip kind={d.kind} />} {!d.isActive && <Chip>Not used any more</Chip>}
          </span>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <LinkButton href="/inventory/locations" variant="secondary">All shelves</LinkButton>
              <LinkButton href={`/inventory?loc=${d.id}`} variant="secondary">This shelf in the stock list</LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for one shelf or area: which lots are on it, how much, and the boxes or sacks stored here.</PageIntro>
      {d.frozenBy ? (
        <Banner tone="warn" title={`Being counted (${d.frozenBy.countNumber}): no moves`} action={ctx.can("inventory.stock_count.view") ? <LinkButton href={`/inventory/counts/${d.frozenBy.countId}`} variant="secondary">Open the count</LinkButton> : undefined}>
          Nothing can move in or out until the count is finished or cancelled.
        </Banner>
      ) : canMove ? (
        <NextStep text="To bring stock to this shelf, scan or pick the lot." action={{ label: "Move stock here", href: `/inventory/move?to=${d.id}` }} />
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold">On this shelf · {d.lots.length}</h2>
        {d.lots.length === 0 ? (
          <EmptyState title="Nothing here">{ctx.can("inventory.lot.view") ? "No stock is on this shelf. Move stock here when you put something on it." : "Your job cannot see lots. Ask your site manager."}</EmptyState>
        ) : (
          <PlainList label="Lots on this shelf">
            {d.lots.map((l) => (
              <PlainRow
                key={l.id}
                href={`/inventory/${l.id}`}
                title={l.itemName}
                status={<LotStatusChip status={l.qualityStatus} expiresOn={l.expiresOn} />}
                facts={
                  <>
                    <Expiry date={l.expiresOn} compact />
                    {new Decimal(l.boxed).gt(0) ? ` · ${fmtLotQty(l.boxed, l.baseUom)} in boxes` : ""}
                  </>
                }
                code={l.lotNumber}
                aside={<span className="font-semibold tabular text-[15px] text-fg">{fmtLotQty(l.onHand, l.baseUom)}</span>}
              />
            ))}
          </PlainList>
        )}
      </section>
      {ctx.can("inventory.container.view") && (
        <section className="space-y-2">
          <h2 className="text-[16px] font-semibold">Boxes and sacks here · {d.boxes.length}</h2>
          {d.boxes.length === 0 ? (
            <p className="text-[14px] text-fg-2">No boxes or sacks: the stock here is loose.</p>
          ) : (
            <PlainList label="Boxes and sacks here">
              {d.boxes.map((b) => (
                <PlainRow key={b.id} href={`/inventory/containers/${b.id}`} title={b.status === "sealed" ? "Closed box" : "Open box"} code={b.number} />
              ))}
            </PlainList>
          )}
        </section>
      )}
    </div>
  );
}
