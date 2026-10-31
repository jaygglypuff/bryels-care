import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime } from "@/lib/qty";
import { EXPIRY_WARN_DAYS, getLotDetail, isPastExpiry, moveDestinations, type LotDetail } from "@/modules/inventory/lots";
import { listContainers } from "@/modules/inventory/containers";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Expiry, LocationKindChip, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { MovementList } from "@/ui/inventory/movement-list";
import { Forbidden } from "../../forbidden";
import { LotMigrationSection } from "../../admin/imports/lot-migration-section";

export const metadata = { title: "Lot" };

/** What the lot's state means for the warehouse, in plain words (no "quarantine", no "issue"). */
function RiskBanner({ lot, qaHref }: { lot: LotDetail; qaHref: string | null }) {
  const qa = qaHref ? <LinkButton href={qaHref} variant="secondary">See the QA decision</LinkButton> : undefined;
  const s = lot.qualityStatus;
  if (s === "quarantine")
    return (
      <Banner tone="q" title="Waiting for QA check: not usable yet" action={qa}>
        It cannot be used in making or sent to a customer until QA says OK. It may only move between the QA areas.
      </Banner>
    );
  if (s === "on_hold")
    return (
      <Banner tone="hold" title="Stopped by QA: not usable" action={qa}>
        QA stopped this lot. It cannot be used or sent out; it may only move between the QA areas until QA decides.
      </Banner>
    );
  if (s === "rejected")
    return (
      <Banner tone="rej" title="Rejected: do not use or send out">
        Keep it in the rejected goods area and do what QA says (throw away or send back).
      </Banner>
    );
  if (s === "recalled")
    return (
      <Banner tone="bad" title="Recalled: do not use or send out">
        Keep every bit of it apart and follow the recall instructions.
      </Banner>
    );
  if (s === "expired" || isPastExpiry(lot.expiresOn))
    return (
      <Banner tone="exp" title={`Expired${lot.expiresOn ? ` on ${fmtDate(lot.expiresOn)}` : ""}: do not use`} action={qa}>
        Expired stock cannot be used in making or sent out. Move it to a QA area or the rejected goods area to be thrown away.
      </Banner>
    );
  return null;
}

export default async function LotPage({ params, searchParams }: { params: Promise<{ lotId: string }>; searchParams: Promise<{ moved?: string; edited?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="lots and stock" />;
  const { lotId } = await params;
  const { moved, edited } = await searchParams;
  let lot: LotDetail;
  try {
    lot = await getLotDetail(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const onHand = lot.balances.reduce((a, b) => a.plus(b.qtyBase), D(0));
  const site = ctx.allowedSites.find((s) => s.id === lot.siteId);
  const destinations = ctx.can("inventory.movement.post") ? await moveDestinations(ctx, lot) : [];
  const expired = lot.qualityStatus === "expired" || isPastExpiry(lot.expiresOn);
  const boxes = ctx.can("inventory.container.view") && lot.siteId === ctx.currentSiteId ? await listContainers(ctx, { q: lot.lotNumber }) : [];
  const usable = lot.qualityStatus === "released" && !expired;
  const here = lot.siteId === ctx.currentSiteId;
  // The item page (every lot of this material / product, totals, suppliers, expiry); a lot of another site opens "All my sites".
  const itemId = lot.itemKind === "product" ? lot.productId : lot.materialId;
  const itemHref = itemId ? `/inventory/items/${lot.itemKind === "product" ? "product" : "material"}/${itemId}${here ? "" : "?all=1"}` : null;
  const qaHref = ctx.can("quality.disposition.view") ? `/quality/lots/${lot.id}` : null;

  const canMovePerm = ctx.can("inventory.movement.post");
  const canMoveSomewhere = lot.balances.some((b) => destinations.some((d) => d.id !== b.locationId));
  const moveBlock = !canMovePerm ? null : onHand.lte(0) ? "No stock left in this lot." : !canMoveSomewhere ? "There is no other shelf this lot may go to at this site." : null;
  const canMove = canMovePerm && !moveBlock;
  const statusWords = expired && lot.qualityStatus === "released" ? "expired" : ({ quarantine: "waiting for the QA check", on_hold: "stopped by QA", rejected: "rejected", expired: "expired", recalled: "recalled" } as Record<string, string>)[lot.qualityStatus] ?? lot.qualityStatus;

  // One next step, by the lot's state (ADR-088).
  const next = (() => {
    if (onHand.lte(0)) return <NextStep text="Nothing left in this lot. All of it was used, sent out or moved away." />;
    if (lot.qualityStatus === "quarantine" || lot.qualityStatus === "on_hold")
      return (
        <NextStep
          text={lot.qualityStatus === "quarantine" ? "Keep it in the QA area. It is not usable yet." : "Keep it apart. QA stopped it."}
          waitingFor="Waiting for the QA person (QA/QC) to check it and say OK or not OK."
          action={qaHref && ctx.can("quality.disposition.approve") ? { label: "Check it now", href: qaHref } : undefined}
        />
      );
    if (!usable) return <NextStep text="Do not use it. Keep it apart and ask QA what to do with it." action={qaHref ? { label: "See the QA decision", href: qaHref } : undefined} />;
    if (canMove) return <NextStep text="Ready to use. If it is not on its shelf yet, move it there." action={{ label: "Move stock", href: `/inventory/move?lot=${lot.id}` }} />;
    return <NextStep text="Ready to use. Nothing to do here." />;
  })();

  // Secondary actions in ⋯ More (ADR-088); each keeps its own checks on the server.
  const more: { key: string; label: string; href: string }[] = [];
  if (canMove && !usable) more.push({ key: "move", label: "Move stock", href: `/inventory/move?lot=${lot.id}` });
  if (itemHref) more.push({ key: "item", label: "All lots of this item", href: itemHref });
  if (ctx.can("inventory.movement.view")) more.push({ key: "card", label: "History of this lot", href: `/inventory/stock-card/${lot.id}` });
  if (ctx.can("inventory.container.create") && here && onHand.gt(0)) more.push({ key: "box", label: "Put into a box or sack", href: `/inventory/containers/new?lot=${lot.id}` });
  if (here) more.push({ key: "fefo", label: ctx.can("inventory.reservation.create") ? "Which one to use first / set aside" : "Which one to use first", href: `/inventory/lots/reservations?lot=${lot.id}` });
  if (ctx.can("inventory.label_job.create")) more.push({ key: "label", label: "Print a label", href: `/labels/new?entityType=inventory_lot&entityId=${lot.id}` });
  if (ctx.can("quality.genealogy.view")) more.push({ key: "trace", label: "Where it came from and where it went", href: `/quality/trace?lot=${encodeURIComponent(lot.lotNumber)}` });
  if (ctx.can("inventory.lot.edit")) more.push({ key: "edit", label: "Fix dates or the supplier's code", href: `/inventory/lots/${lot.id}/edit` });

  return (
    <div className="space-y-4">
      <PageHeader
        title={lot.itemName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>Lot</span> <RecordNo>{lot.lotNumber}</RecordNo> <LotStatusChip status={lot.qualityStatus} expiresOn={lot.expiresOn} className="px-3 py-1 text-[13px]" />
          </span>
        }
        actions={
          more.length > 0 ? (
            <MoreMenu>
              <div className="flex flex-col gap-2">
                {more.map((a) => (
                  <LinkButton key={a.key} href={a.href} variant="secondary" data-testid={a.key === "item" ? "lot-item-link" : undefined}>
                    {a.label}
                  </LinkButton>
                ))}
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for one lot (one delivery or one batch): how much is left, which shelf it is on, if it is OK to use, and everything that happened to it. <Explain term="lot" /></PageIntro>

      {moved && <Banner tone="ok" title={`Stock moved (${moved})`}>Saved to stock. It is in the history below.</Banner>}
      {edited && <Banner tone="ok" title="Lot details fixed">The old and new values are kept in the history of changes.</Banner>}
      <RiskBanner lot={lot} qaHref={qaHref} />
      {!here && <Banner tone="info" title={`This lot belongs to ${site?.name ?? "another site"}`}>Switch site in the top bar to see it in that site's lists.</Banner>}
      {next}
      {canMovePerm && moveBlock && onHand.gt(0) && (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Lock size={14} className="mt-0.5 shrink-0" aria-hidden /> Move stock: {moveBlock}
        </p>
      )}
      {!usable && onHand.gt(0) && (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Lock size={14} className="mt-0.5 shrink-0" aria-hidden /> {lot.itemKind === "product" ? "Setting aside for orders and sending out" : "Using it in making"} is blocked while the lot is {statusWords}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardTitle>How much and where</CardTitle>
          <p className="mb-3 text-[28px] font-semibold tabular leading-none" data-testid="lot-on-hand">{fmtLotQty(onHand.toString(), lot.baseUom)}</p>
          {lot.balances.length === 0 ? (
            <EmptyState title="No stock left">All of this lot was used, sent out or moved away.</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-[12px] border border-line" aria-label="Where it is">
              {lot.balances.map((b) => (
                <li key={b.locationId} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="font-semibold">{b.name}</span> <span className="font-mono text-[12px] text-muted">{b.code}</span>
                    {b.kind !== "storage" && <div className="mt-0.5"><LocationKindChip kind={b.kind} /></div>}
                  </div>
                  <span className="font-semibold tabular">{fmtLotQty(b.qtyBase, lot.baseUom)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>About this lot</CardTitle>
          <Dl
            items={[
              ["Expires", <Expiry key="ex" date={lot.expiresOn} warnDays={EXPIRY_WARN_DAYS} />],
              ["Supplier", lot.supplierName ?? "—"],
              ["Supplier's code on the sack", lot.supplierLotNumber ?? "—"],
              ["Came in", lot.receipt ? <><Link href={`/inventory/receive/${lot.receipt.id}`} className="text-primary-text hover:underline">{fmtDateTime(lot.receipt.receivedAt)}</Link> <span className="font-mono text-[12px] text-muted">{lot.receipt.number}</span></> : lot.batchNumber && lot.sourceBatchId ? <>Made in batch <Link href={`/production/${lot.sourceBatchId}`} className="font-mono text-primary-text hover:underline">{lot.batchNumber}</Link></> : fmtDateTime(lot.createdAt)],
              // Usability test 2026-10-30: no empty "Storage —" row.
              ...(lot.storageConditions ? [["How to store", lot.storageConditions] as [string, string]] : []),
            ]}
          />
          <div className="mt-3">
            <MoreDetails>
              <Dl
                items={[
                  ["Item code", <span key="c" className="font-mono">{lot.itemCode}</span>],
                  ...(lot.inciName ? [["INCI name", lot.inciName] as [string, string]] : []),
                  ["Kind", lot.itemKind === "product" ? "Finished goods" : "Raw material or packaging"],
                  ...(lot.itemKind === "material" ? [["Brand", lot.brand ?? "—"] as [string, string]] : []),
                  ["Made on", fmtDate(lot.manufacturedOn)],
                  ["Batch that made it", lot.batchNumber && lot.sourceBatchId ? <Link key="b" href={`/production/${lot.sourceBatchId}`} className="text-primary-text hover:underline">{lot.batchNumber}</Link> : "—"],
                  ["Counted in", lot.baseUom],
                  ["Site", site?.name ?? "—"],
                  ["Supplier papers (CoA)", lot.receipt ? <Link key="r" href={`/inventory/receive/${lot.receipt.id}`} className="text-primary-text hover:underline">On the receipt page</Link> : "—"],
                ]}
              />
            </MoreDetails>
          </div>
        </Card>
      </div>

      {boxes.length > 0 && (
        <section id="boxes" className="space-y-2">
          <h2 className="text-[16px] font-semibold">In boxes or sacks ({boxes.length})</h2>
          <PlainList label="Boxes and sacks with this lot">
            {boxes.map((b) => (
              <PlainRow key={b.id} href={`/inventory/containers/${b.id}`} title={b.locationName ?? b.locationCode ?? "No shelf yet"} code={b.containerNumber} />
            ))}
          </PlainList>
        </section>
      )}

      {/* W3C (US-2-26): opening-balance origin and scanned legacy BMRs of migrated lots; renders nothing otherwise. */}
      <LotMigrationSection ctx={ctx} lotId={lot.id} />

      <section id="movements" className="space-y-2">
        <h2 className="text-[16px] font-semibold">What happened to it</h2>
        <MovementList
          showItem={false}
          label="Stock changes of this lot"
          rows={lot.movements.map((m) => ({ ...m, postedBy: m.postedBy }))}
          empty={{ title: "No stock changes yet" }}
        />
      </section>
    </div>
  );
}
